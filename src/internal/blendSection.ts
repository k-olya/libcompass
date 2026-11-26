import { vec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { Vertex } from '../Vertex.js';
import { atSurface, checkedUV, solve3, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';
import { boundaryPlacement, moveSurfaceUV } from './surfaceRails.js';
import { spherical, sub, unit } from './roundTopology.js';

export type BlendSettings = { kind: 'round'; radius: number } | { kind: 'chamfer'; length: number; angleRAD: number };
type Placement = ReturnType<typeof boundaryPlacement>;
export type BlendSection = { uv: Point[]; points: Vertex[]; center?: vec3; at(v: number): Vertex; normal(v: number): vec3 };

/** Pivoted double-precision solve for the four contact parameters. */
export function solveBlendSystem(matrix: number[][], rhs: number[]): number[] {
  const rows = matrix.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < rows.length; i++) {
    let pivot = i;
    for (let j = i + 1; j < rows.length; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    if (Math.abs(rows[i][i]) < 1e-14) throw new RangeError('Blend contact intersection is singular or unresolved');
    const divisor = rows[i][i];
    for (let k = i; k <= rows.length; k++) rows[i][k] /= divisor;
    for (let j = 0; j < rows.length; j++) if (j !== i) {
      const factor = rows[j][i];
      for (let k = i; k <= rows.length; k++) rows[j][k] -= factor * rows[i][k];
    }
  }
  return rows.map(row => row[rows.length]);
}

/**
 * Solve exact source contacts, independently of curve type. Cached stations seed
 * nearby solves; no sampled polyline replaces either surface or the blend.
 */
export function blendSection(source: ParametricFace[], placements: Placement[], boundary: SpatialBoundary,
  settings: BlendSettings, topologyTolerance: number): (t: number) => BlendSection {
  const size = settings.kind === 'round' ? settings.radius : settings.length;
  const cache = new Map<number, BlendSection>();
  const stations: number[] = [];
  const firstCache = new Map<number, { uv: Point; point: Vertex }>();
  const firstAt = (t: number) => {
    const cached = firstCache.get(t);
    if (cached) return cached;
    const origin = boundary.at(t), tangent = tangentAt(t), initial = placements[0].uv(t);
    let uv = moveSurfaceUV(source[0], initial, vec3.scale([0, 0, 0], unit(placements[0].inward(initial, tangent)), size));
    const tolerance = Math.max(1e-10, size * 1e-9);
    for (let iteration = 0; ; iteration++) {
      const point = atSurface(source[0], uv), delta = sub(point.position, origin.position);
      const f = vec3.dot(delta, tangent), g = (vec3.squaredLength(delta) - size * size) / (2 * size);
      if (Math.hypot(f, g) <= tolerance) {
        const result = { uv, point }; firstCache.set(t, result); return result;
      }
      if (iteration >= 30) throw new RangeError('Chamfer setback intersection did not converge');
      const { du, dv } = surfaceFrame(source[0], uv);
      const a = vec3.dot(du, tangent), b = vec3.dot(dv, tangent);
      const c = vec3.dot(du, delta) / size, d = vec3.dot(dv, delta) / size, determinant = a * d - b * c;
      if (Math.abs(determinant) < 1e-14) throw new RangeError('Chamfer setback intersection is singular');
      uv = checkedUV(source[0], { x: uv.x + (b * g - d * f) / determinant, y: uv.y + (c * f - a * g) / determinant });
    }
  };
  const tangentAt = (t: number) => boundary instanceof SpatialCurve ? boundary.tangent(t) : unit(sub(boundary.end.position, boundary.start.position));

  return (t: number) => {
    const cached = cache.get(t);
    if (cached) return cached;
    const origin = boundary.at(t), tangent = tangentAt(t), initial = placements.map(placement => placement.uv(t));
    const initialNormals = source.map((surface, i) => surfaceFrame(surface, initial[i]).normal);
    const cosine = vec3.dot(initialNormals[0], initialNormals[1]);
    if (cosine < -1 + 1e-8 || cosine > 1 - 1e-8) throw new RangeError('Blend requires a sharp regular boundary');
    const sense = vec3.dot(placements[0].inward(initial[0], tangent), initialNormals[1]) < 0 ? 1 : -1;
    let uv: Point[], points: Vertex[], normal: (v: number) => vec3, at: (v: number) => Vertex, ballCenter: vec3 | undefined;

    if (settings.kind === 'chamfer') {
      const first = firstAt(t), inward = unit(placements[1].inward(initial[1], tangent));
      const firstNormal = surfaceFrame(source[0], first.uv).normal;
      let railTangent = tangent;
      if (!(source[0] instanceof Face)) {
        const low = boundary.isLoop() ? (t - 1e-5 + 1) % 1 : Math.max(0, t - 1e-5);
        const high = boundary.isLoop() ? (t + 1e-5) % 1 : Math.min(1, t + 1e-5);
        railTangent = unit(sub(firstAt(high).point.position, firstAt(low).point.position));
      }
      let across = unit(vec3.cross([0, 0, 0], firstNormal, railTangent));
      if (vec3.dot(across, sub(first.point.position, origin.position)) < 0) across = vec3.negate([0, 0, 0], across);
      const direction = vec3.scaleAndAdd([0, 0, 0], vec3.scale([0, 0, 0], across, -Math.cos(settings.angleRAD)), firstNormal, -sense * Math.sin(settings.angleRAD));
      let secondUV = moveSurfaceUV(source[1], initial[1], vec3.scale([0, 0, 0], inward, size * Math.tan(settings.angleRAD)));
      let distance = size / Math.cos(settings.angleRAD);
      const tolerance = Math.max(1e-10, size * 1e-9);
      for (let iteration = 0; ; iteration++) {
        const delta = sub(vec3.scaleAndAdd([0, 0, 0], first.point.position, direction, distance), atSurface(source[1], secondUV).position);
        if (vec3.length(delta) <= tolerance) break;
        if (iteration >= 30) throw new RangeError('Chamfer angle intersection did not converge');
        const { du, dv } = surfaceFrame(source[1], secondUV);
        const step = solve3(du, dv, vec3.negate([0, 0, 0], direction), delta);
        secondUV = checkedUV(source[1], { x: secondUV.x + step[0], y: secondUV.y + step[1] }); distance += step[2];
      }
      const second = atSurface(source[1], secondUV);
      if (distance <= tolerance || vec3.dot(sub(second.position, origin.position), inward) <= tolerance) throw new RangeError('Chamfer contacts leave the retained surfaces or require a different angle');
      uv = [first.uv, secondUV]; points = [first.point, second];
      at = v => ({ position: vec3.lerp([0, 0, 0], points[0].position, points[1].position, v) });
      const outward = vec3.add([0, 0, 0], initialNormals[0], initialNormals[1]);
      normal = () => outward;
    } else {
      const radius = settings.radius;
      const tolerance = Math.max(1e-11, radius * 1e-10,
        Math.min(radius * 1e-7, Math.max(radius, ...Array.from(origin.position, Math.abs)) * Number.EPSILON * 64 / 1e-5));
      const setback = radius * Math.sqrt((1 - cosine) / (1 + cosine));
      let center: vec3, normals: vec3[];
      if (source.every(surface => surface instanceof Face)) {
        center = vec3.scaleAndAdd([0, 0, 0], origin.position, vec3.add([0, 0, 0], initialNormals[0], initialNormals[1]), -radius * sense / (1 + cosine));
        points = initialNormals.map(n => ({ position: vec3.scaleAndAdd([0, 0, 0], center, n, radius * sense) }));
        normals = initialNormals; uv = source.map((surface, i) => (surface as Face).plane.toLocal(points[i]));
      } else {
        uv = initial.map((point, i) => moveSurfaceUV(source[i], point, vec3.scale([0, 0, 0], unit(placements[i].inward(point, tangent)), setback)));
        const constrain = source[1] instanceof Face ? 0 : 1;
        const contact = (i: number, value: Point) => {
          const point = atSurface(source[i], value), frame = surfaceFrame(source[i], value);
          return { point, frame, center: vec3.scaleAndAdd([0, 0, 0], point.position, frame.normal, -radius * sense) };
        };
        const residualAt = (values: Point[]) => {
          const contacts = values.map((point, i) => contact(i, point));
          return [...sub(contacts[0].center, contacts[1].center), vec3.dot(sub(contacts[constrain].point.position, origin.position), tangent)];
        };
        const inDomain = (values: Point[]) => values.every((value, i) => Number.isFinite(value.x) && Number.isFinite(value.y)
          && (source[i] instanceof Face || ((source[i].periodicU || value.x >= 0 && value.x <= 1) && (source[i].periodicV || value.y >= 0 && value.y <= 1))));
        let low = 0, high = stations.length;
        while (low < high) { const middle = (low + high) >> 1; if (stations[middle] < t) low = middle + 1; else high = middle; }
        const nearby = stations.slice(Math.max(0, low - 1), low + 1).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
        for (let iteration = 0; ; iteration++) {
          const contacts = uv.map((point, i) => contact(i, point));
          const residual = [...sub(contacts[0].center, contacts[1].center), vec3.dot(sub(contacts[constrain].point.position, origin.position), tangent)];
          const error = Math.hypot(...residual);
          if (error <= Math.max(1e-11, radius * 1e-10) || (iteration >= 20 && error <= tolerance)) {
            points = contacts.map(c => c.point); normals = contacts.map(c => c.frame.normal); center = contacts[0].center; break;
          }
          if (iteration >= 30) throw new RangeError('Round offset-surface intersection did not converge');
          if (iteration === 0 && nearby !== undefined && Math.abs(nearby - t) < 0.1) {
            const previous = cache.get(nearby)!;
            const prediction = previous.uv.map((value, i) => {
              const old = placements[i].uv(nearby);
              return { x: value.x + initial[i].x - old.x, y: value.y + initial[i].y - old.y };
            });
            if (inDomain(prediction) && Math.hypot(...residualAt(prediction)) < error) { uv = prediction; continue; }
          }
          // Each column changes only one contact; do not recompute the other surface.
          const columns = [0, 1, 2, 3].map(index => {
            const i = index >> 1, axis = index % 2 ? 'y' : 'x', surface = source[i], frame = contacts[i].frame;
            if (surface instanceof Face) {
              const derivative = axis === 'x' ? frame.du : frame.dv;
              return [...Array.from(derivative, value => value * (i ? -1 : 1)), i === constrain ? vec3.dot(derivative, tangent) : 0];
            }
            const h = iteration < 10 ? 1e-5 : Math.max(1e-10, Math.min(1e-5, error * 0.01 / vec3.length(axis === 'x' ? frame.du : frame.dv)));
            const bounded = !(surface instanceof Face) && !(axis === 'x' ? surface.periodicU : surface.periodicV);
            const a = checkedUV(surface, { ...uv[i], [axis]: uv[i][axis] - (bounded && uv[i][axis] < h ? 0 : h) });
            const b = checkedUV(surface, { ...uv[i], [axis]: uv[i][axis] + (bounded && uv[i][axis] > 1 - h ? 0 : h) });
            const first = contact(i, a), second = contact(i, b), delta = b[axis] - a[axis];
            const derivative = Array.from(sub(second.center, first.center), value => value * (i ? -1 : 1) / delta);
            return [...derivative, i === constrain ? vec3.dot(sub(second.point.position, first.point.position), tangent) / delta : 0];
          });
          const step = solveBlendSystem([0, 1, 2, 3].map(row => columns.map(column => column[row])), residual.map(value => -value));
          let next: Point[] | undefined;
          for (let reduction = 0; reduction < 12; reduction++) {
            const scale = 2 ** -reduction;
            const candidate = uv.map((point, i) => ({ x: point.x + scale * step[2 * i], y: point.y + scale * step[2 * i + 1] }));
            if (!inDomain(candidate)) continue;
            if (Math.hypot(...residualAt(candidate)) < error || error <= tolerance) { next = candidate; break; }
          }
          if (!next) throw new RangeError('Round offset-surface intersection cannot advance within its parameter domain');
          uv = next;
        }
      }
      for (let i = 0; i < 2; i++) if (vec3.dot(sub(points[i].position, origin.position), placements[i].inward(initial[i], tangent)) < -topologyTolerance) throw new RangeError('Round contacts leave the retained surfaces');
      const chord = sub(points[1].position, points[0].position), length = vec3.length(chord);
      if (length === 0 || length > 2 * radius + tolerance) throw new RangeError('Round contact circle is singular or exceeds the ball diameter');
      const middle = vec3.lerp([0, 0, 0], points[0].position, points[1].position, 0.5), across = sub(center, middle);
      vec3.scaleAndAdd(across, across, chord, -vec3.dot(across, chord) / (length * length));
      center = vec3.scaleAndAdd([0, 0, 0], middle, unit(across), Math.sqrt(Math.max(0, radius * radius - length * length / 4)));
      normals = points.map(point => vec3.scale([0, 0, 0], unit(sub(point.position, center)), sense));
      ballCenter = center;
      normal = v => spherical(normals[0], normals[1], v);
      at = v => ({ position: vec3.scaleAndAdd([0, 0, 0], center, normal(v), radius * sense) });
    }
    const result = { uv, points, normal, at, center: ballCenter }; cache.set(t, result);
    let low = 0, high = stations.length;
    while (low < high) { const middle = (low + high) >> 1; if (stations[middle] < t) low = middle + 1; else high = middle; }
    stations.splice(low, 0, t);
    return result;
  };
}
