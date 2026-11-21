import { vec3 } from 'gl-matrix';
import type { Point } from '../Point.js';
import type { SurfaceRegion, SurfaceTrim } from '../SurfaceRegion.js';
import type { Vertex } from '../Vertex.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import { triangulatePolygon } from './polygon.js';
import type { Tessellation } from './Tessellation.js';
import { legalizeTriangles } from './legalizeTriangles.js';
import { surfaceFrame } from './surfaceGeometry.js';

/** Conforming adaptive tessellation of retained UV polygons; no topological facets. */
export function regionMesh(region: SurfaceRegion, context: Tessellation): Float32Array {
  const output: number[] = [];
  for (const chart of region.regions) {
    const uses = [chart.outer, ...(chart.holes ?? [])];
    for (const loop of uses) for (const trim of loop) context.request(trim.boundary, [trim.start ?? 0, trim.end ?? 1]);
    const points: { uv: Point; point: Vertex }[] = [];
    const polygon = (loop: readonly SurfaceTrim[]): Point[] => {
      const segments = loop.map(trim => {
        const parameters = context.parameters(trim.boundary), samples = context.vertices(trim.boundary);
        let entries = parameters.flatMap((t, i) => t >= (trim.start ?? 0) - 1e-10 && t <= (trim.end ?? 1) + 1e-10
          ? [{ uv: trim.at(t), point: samples[i] }] : []);
        if (trim.reversed) entries = entries.reverse();
        const seam = (['x', 'y'] as const).some((axis, i) => (i ? region.surface.periodicV : region.surface.periodicU)
          && entries.length > 0 && [0, 1].some(value => entries.every(entry => entry.uv[axis] === value)));
        return { trim, entries, seam };
      });
      // Chart seams and physical trims meet at the same mathematical point.
      // Use the shared physical sample at that corner, including across seams;
      // reevaluation can differ by roundoff (for example cos(PI / 2) versus 0).
      return segments.flatMap(({ trim, entries }, i) => {
        const previous = segments[(i + segments.length - 1) % segments.length];
        if (trim.physical === false && (previous.trim.physical !== false || previous.seam) && entries.length) entries[0].point = previous.entries.at(-1)!.point;
        const retained = entries.slice(0, -1);
        points.push(...retained); return retained.map(entry => entry.uv);
      });
    };
    const polygons = uses.map(polygon);
    let triangles: number[];
    try { triangles = triangulatePolygon(polygons, 1e-14); }
    catch (cause) { throw new RangeError('Retained surface trim could not be triangulated', { cause }); }
    const boundary = new Set<string>();
    const key = (a: number, b: number) => a < b ? `${a},${b}` : `${b},${a}`;
    let offset = 0;
    for (const loop of polygons) {
      for (let i = 0; i < loop.length; i++) boundary.add(key(offset + i, offset + (i + 1) % loop.length));
      offset += loop.length;
    }
    const evaluated = (uv: Point) => region.at(uv.x, uv.y);
    const { du, dv, normal } = surfaceFrame(region.surface, { x: 0.5, y: 0.5 });
    const uScale = vec3.length(du), shear = vec3.dot(du, dv) / uScale;
    let metric: [number, number, number] = [uScale, shear, vec3.length(vec3.cross([0, 0, 0], du, dv)) / uScale];
    // Optimize normal deviation, allowing long triangles along straight surface
    // directions. A world-length metric still over-refines cylinders axially.
    const h = 1e-3, center = evaluated({ x: 0.5, y: 0.5 }).position;
    const height = (u: number, v: number) => vec3.dot(vec3.subtract([0, 0, 0], region.at(u, v).position, center), normal);
    const e = (height(0.5 + h, 0.5) + height(0.5 - h, 0.5)) / (h * h);
    const g = (height(0.5, 0.5 + h) + height(0.5, 0.5 - h)) / (h * h);
    const f = (height(0.5 + h, 0.5 + h) - height(0.5 + h, 0.5 - h) - height(0.5 - h, 0.5 + h) + height(0.5 - h, 0.5 - h)) / (4 * h * h);
    const spread = Math.hypot(e - g, 2 * f), eigenvalues = [(e + g + spread) / 2, (e + g - spread) / 2].map(Math.abs);
    const maximum = Math.max(...eigenvalues);
    if (maximum > Math.max(vec3.length(du), vec3.length(dv)) * 1e-7) {
      // Bound the metric's condition number where a principal curvature is zero.
      const [first, second] = eigenvalues.map(value => Math.max(value, maximum * 1e-4));
      const rotationRAD = Math.atan2(2 * f, e - g) / 2, c = Math.cos(rotationRAD), s = Math.sin(rotationRAD);
      const a = first * c * c + second * s * s, b = (first - second) * c * s, d = first * s * s + second * c * c;
      metric = [Math.sqrt(a), b / Math.sqrt(a), Math.sqrt(Math.max(0, d - b * b / a))];
    }
    let converged = false;
    for (let pass = 0; pass < 24; pass++) {
      legalizeTriangles(triangles, points, metric);
      if (triangles.length > 3_000_000) throw new RangeError('Trimmed surface exceeds the tessellation budget');
      const split = new Map<string, number>(), centers = new Map<number, number>();
      const middle = (a: number, b: number): number => {
        const k = key(a, b), previous = split.get(k);
        if (previous !== undefined) return previous;
        const uv = { x: (points[a].uv.x + points[b].uv.x) / 2, y: (points[a].uv.y + points[b].uv.y) / 2 };
        const index = points.length; points.push({ uv, point: evaluated(uv) }); split.set(k, index); return index;
      };
      for (let i = 0; i < triangles.length; i += 3) {
        const ids = triangles.slice(i, i + 3);
        for (let j = 0; j < 3; j++) {
          const a = ids[j], b = ids[(j + 1) % 3];
          if (boundary.has(key(a, b))) continue;
          const uv = { x: (points[a].uv.x + points[b].uv.x) / 2, y: (points[a].uv.y + points[b].uv.y) / 2 };
          if (vec3.distance(evaluated(uv).position, vec3.lerp([0, 0, 0], points[a].point.position, points[b].point.position, 0.5)) > TRIANGULATION_RESOLUTION) middle(a, b);
        }
        const uv = { x: ids.reduce((sum, id) => sum + points[id].uv.x, 0) / 3, y: ids.reduce((sum, id) => sum + points[id].uv.y, 0) / 3 };
        const center = evaluated(uv), average = vec3.scale([0, 0, 0], ids.reduce((sum, id) => vec3.add(sum, sum, points[id].point.position), [0, 0, 0] as vec3), 1 / 3);
        if (vec3.distance(center.position, average) > TRIANGULATION_RESOLUTION) {
          const index = points.length; points.push({ uv, point: center }); centers.set(i, index);
        }
      }
      if (!split.size && !centers.size) { converged = true; break; }
      const next: number[] = [];
      for (let i = 0; i < triangles.length; i += 3) {
        const [a, b, c] = triangles.slice(i, i + 3), ab = split.get(key(a, b)), bc = split.get(key(b, c)), ca = split.get(key(c, a));
        const ring = [a, ...(ab === undefined ? [] : [ab]), b, ...(bc === undefined ? [] : [bc]), c, ...(ca === undefined ? [] : [ca])];
        let center = centers.get(i);
        if (ring.length === 3 && center === undefined) { next.push(a, b, c); continue; }
        if (ring.length === 4 && center === undefined) {
          // Split from the inserted midpoint to the opposite corner.
          if (ab !== undefined) next.push(a, ab, c, ab, b, c);
          else if (bc !== undefined) next.push(b, bc, a, bc, c, a);
          else next.push(c, ca!, b, ca!, a, b);
          continue;
        }
        if (center === undefined) {
          const uv = { x: (points[a].uv.x + points[b].uv.x + points[c].uv.x) / 3, y: (points[a].uv.y + points[b].uv.y + points[c].uv.y) / 3 };
          center = points.length; points.push({ uv, point: evaluated(uv) });
        }
        for (let j = 0; j < ring.length; j++) next.push(ring[j], ring[(j + 1) % ring.length], center);
      }
      triangles = next;
    }
    if (!converged) throw new RangeError('Trimmed surface tessellation did not converge');
    for (let i = 0; i < triangles.length; i += 3) {
      const ids = triangles.slice(i, i + 3), [a, b, c] = ids.map(id => points[id].uv);
      if (((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) !== region.reversed) [ids[1], ids[2]] = [ids[2], ids[1]];
      for (const id of ids) output.push(...Array.from(points[id].point.position));
    }
  }
  return new Float32Array(output);
}
