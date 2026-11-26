import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { SpatialCurve } from '../SpatialCurve.js';
import type { Point } from '../Point.js';
import type { Vertex } from '../Vertex.js';
import { sampleParameter } from './curveSamples.js';
import { solve3 } from './surfaceGeometry.js';
import { ParametricPatch, type PatchTriangle } from './parametricPatch.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';

type Seed = { point: ReadonlyVec3; uv: number[] };
type Bounds = { min: number[]; max: number[] };
type Tree = Bounds & { triangles?: PatchTriangle[]; left?: Tree; right?: Tree };
const subtract = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.subtract([0, 0, 0], a, b);
const overlap = (a: Bounds, b: Bounds, tolerance: number) => a.min.every((x, i) => x <= b.max[i] + tolerance && a.max[i] + tolerance >= b.min[i]);
function tree(triangles: PatchTriangle[]): Tree {
  const min = [0, 1, 2].map(i => triangles.reduce((min, t) => Math.min(min, t.min[i]), Infinity)), max = [0, 1, 2].map(i => triangles.reduce((max, t) => Math.max(max, t.max[i]), -Infinity));
  if (triangles.length <= 8) return { min, max, triangles };
  const axis = [0, 1, 2].sort((a, b) => max[b] - min[b] - max[a] + min[a])[0];
  triangles.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
  const middle = triangles.length >> 1;
  return { min, max, left: tree(triangles.slice(0, middle)), right: tree(triangles.slice(middle)) };
}

/** Plane/triangle segments provide seeds only; every retained point is refined against both equations. */
function triangleIntersection(a: PatchTriangle, b: PatchTriangle, tolerance: number): Seed[] {
  const normal = (t: PatchTriangle) => vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], subtract(t.points[1], t.points[0]), subtract(t.points[2], t.points[0])));
  const na = normal(a), nb = normal(b), direction = vec3.cross([0, 0, 0], na, nb);
  if (vec3.length(direction) < 1e-9) return [];
  vec3.normalize(direction, direction);
  const section = (t: PatchTriangle, n: ReadonlyVec3, origin: ReadonlyVec3) => {
    const values = t.points.map(p => vec3.dot(subtract(p, origin), n));
    if (values.every(x => x > tolerance) || values.every(x => x < -tolerance)) return [];
    const points: { point: ReadonlyVec3; uv: Point }[] = [];
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3;
      if (Math.abs(values[i]) <= tolerance) points.push({ point: t.points[i], uv: t.uv[i] });
      if (values[i] * values[j] < 0 && Math.abs(values[i]) > tolerance && Math.abs(values[j]) > tolerance) {
        const f = values[i] / (values[i] - values[j]);
        points.push({ point: vec3.lerp([0, 0, 0], t.points[i], t.points[j], f),
          uv: { x: t.uv[i].x + (t.uv[j].x - t.uv[i].x) * f, y: t.uv[i].y + (t.uv[j].y - t.uv[i].y) * f } });
      }
    }
    return points.sort((x, y) => vec3.dot(subtract(x.point, y.point), direction));
  };
  const first = section(a, nb, b.points[0]), second = section(b, na, a.points[0]);
  if (first.length < 2 || second.length < 2) return [];
  const origin = first[0].point, position = (p: ReadonlyVec3) => vec3.dot(subtract(p, origin), direction);
  const starts = [position(first[0].point), position(second[0].point)], ends = [position(first.at(-1)!.point), position(second.at(-1)!.point)];
  const low = Math.max(...starts), high = Math.min(...ends);
  if (high - low <= tolerance) return [];
  const uvAt = (points: typeof first, value: number): number[] => {
    const a = points[0], b = points.at(-1)!, t = (value - position(a.point)) / (position(b.point) - position(a.point));
    return [a.uv.x + (b.uv.x - a.uv.x) * t, a.uv.y + (b.uv.y - a.uv.y) * t];
  };
  return [low, high].map(value => ({ point: vec3.scaleAndAdd([0, 0, 0], origin, direction, value), uv: [...uvAt(first, value), ...uvAt(second, value)] }));
}

/** Shared exact intersection, with independent continuous UV lifts on the two surfaces. */
export class SurfaceIntersection extends SpatialCurve {
  readonly parameters: (t: number) => number[];
  constructor(a: ParametricPatch, b: ParametricPatch, stations: number[][], closed: boolean, tolerance: number) {
    const periodic = [a.surface.periodicU, a.surface.periodicV, b.surface.periodicU, b.surface.periodicV];
    for (let i = 1; i < stations.length; i++) for (let k = 0; k < 4; k++) if (periodic[k]) stations[i][k] += Math.round(stations[i - 1][k] - stations[i][k]);
    const refine = (seed: number[]): number[] => {
      const q = [...seed];
      const fixed = q.map((x, k) => !periodic[k] && (Math.abs(x) < 1e-9 || Math.abs(x - 1) < 1e-9));
      for (let step = 0; step < 30; step++) {
        const x = { x: q[0], y: q[1] }, y = { x: q[2], y: q[3] };
        const residual = subtract(b.at(y).position, a.at(x).position);
        if (vec3.length(residual) <= tolerance * 0.0001) return q;
        const columns = [...a.derivatives(x), ...b.derivatives(y).map(d => vec3.negate([0, 0, 0], d))].map((d, k) => fixed[k] ? [0, 0, 0] as ReadonlyVec3 : d);
        // Minimum-norm correction in the normal space of the intersection.
        const gram = [0, 1, 2].map(i => [0, 1, 2].map(j => columns.reduce((sum, d) => sum + d[i] * d[j], 0)) as [number, number, number]);
        // At a domain edge, one residual equation can already be identically
        // satisfied. Damping solves that redundant constrained system too.
        const damping = Math.max(...gram.map((row, i) => row[i])) * 1e-9;
        for (let i = 0; i < 3; i++) gram[i][i] += damping;
        let correction: number[];
        try { correction = solve3(gram[0], gram[1], gram[2], residual); }
        catch { throw new RangeError('Surface intersection is tangent, coincident or numerically unresolved'); }
        let change = 0;
        for (let k = 0; k < 4; k++) {
          const delta = vec3.dot(columns[k], correction as [number, number, number]);
          q[k] += Math.max(-0.1, Math.min(0.1, delta));
          if (!periodic[k]) q[k] = Math.max(0, Math.min(1, q[k]));
          change += Math.abs(delta);
        }
        if (!Number.isFinite(change) || change < 1e-14) break;
      }
      throw new RangeError('Surface intersection refinement did not converge');
    };
    stations = stations.map(refine);
    // At a pole, one chart coordinate is arbitrary. Use the limiting value
    // from this branch rather than the discovery triangle's arbitrary longitude.
    for (const index of [0, stations.length - 1]) {
      const neighbor = stations[index === 0 ? 1 : index - 1];
      for (const [patch, offset] of [[a, 0], [b, 2]] as const) {
        const q = stations[index], uv = { x: q[offset], y: q[offset + 1] };
        if (!patch.surface.poles.some(pole => vec3.distance(pole.position, patch.at(uv).position) <= tolerance)) continue;
        const derivatives = patch.derivatives(uv), lengths = derivatives.map(vec3.length);
        for (let axis = 0; axis < 2; axis++) if (lengths[axis] <= Math.max(...lengths) * 1e-8) q[offset + axis] = neighbor[offset + axis];
      }
    }
    const lengths = [0];
    for (let i = 1; i < stations.length; i++) {
      const [first, last] = [stations[i - 1], stations[i]].map(q => a.at({ x: q[0], y: q[1] }).position);
      lengths.push(lengths.at(-1)! + vec3.distance(first, last));
    }
    const total = lengths.at(-1)!;
    if (total <= tolerance) throw new RangeError('Surface intersection has no resolvable length');
    const stationParameters = lengths.map(length => length / total);
    const cached = new Map<number, number[]>();
    const parameters = (t: number): number[] => {
      let q = cached.get(t);
      if (!q) {
        let low = 0, high = stationParameters.length - 1;
        while (low + 1 < high) { const middle = (low + high) >> 1; if (stationParameters[middle] <= t) low = middle; else high = middle; }
        const i = low, fraction = (t - stationParameters[i]) / (stationParameters[i + 1] - stationParameters[i]);
        q = refine(stations[i].map((x, k) => x + (stations[i + 1][k] - x) * fraction)); cached.set(t, q);
      }
      return q;
    };
    const at = (t: number): Vertex => { const q = parameters(t); return a.at({ x: q[0], y: q[1] }); };
    const first = at(0);
    super({ at: t => closed && t === 1 ? first : at(t), start: first, end: closed ? first : at(1) });
    this.parameters = parameters;
    this.stations = stationParameters;
  }
  private readonly stations: readonly number[];
  override sample(options: { resolution?: number } = {}): Vertex[] {
    const samples = super.sample(options);
    const values = samples.map((point, i) => sampleParameter(this, point, i, samples.length)!);
    const result = [0], resolution = options.resolution ?? TRIANGULATION_RESOLUTION;
    const refine = (start: number, end: number, depth: number): void => {
      const a = this.at(start).position, b = this.at(end).position;
      let worst = (start + end) / 2, deviation = 0;
      // Discovery stations can expose oscillations missed by midpoint probes.
      // Retain a station only when it violates the requested chord deviation.
      for (const t of [worst, ...this.stations.filter(t => t > start && t < end)]) {
        const error = vec3.distance(this.at(t).position, vec3.lerp([0, 0, 0], a, b, (t - start) / (end - start)));
        if (error > deviation) { deviation = error; worst = t; }
      }
      if (deviation <= resolution) { result.push(end); return; }
      if (depth >= 20) throw new RangeError('Surface intersection cannot be sampled at the triangulation resolution');
      refine(start, worst, depth + 1); refine(worst, end, depth + 1);
    };
    for (let i = 1; i < values.length; i++) refine(values[i - 1], values[i], 0);
    return result.map(t => this.at(t));
  }
}

export function surfaceIntersections(a: ParametricPatch, b: ParametricPatch, tolerance: number): SurfaceIntersection[] {
  const segments: Seed[][] = [];
  const visit = (first: Tree, second: Tree): void => {
    if (!overlap(first, second, tolerance)) return;
    if (first.triangles && second.triangles) {
      for (const x of first.triangles) for (const y of second.triangles) if (overlap(x, y, tolerance)) {
        const segment = triangleIntersection(x, y, tolerance);
        if (segment.length) segments.push(segment);
      }
    } else if (first.left) { visit(first.left, second); visit(first.right!, second); }
    else { visit(first, second.left!); visit(first, second.right!); }
  };
  visit(tree([...a.triangles]), tree([...b.triangles]));
  const nodes: (Seed & { edges: Set<number>; id: number })[] = [], buckets = new Map<string, typeof nodes>();
  const node = (seed: Seed) => {
    const cell = Array.from(seed.point, x => Math.floor(x / tolerance));
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const found = buckets.get([cell[0] + i, cell[1] + j, cell[2] + k].join(','))?.find(n => vec3.distance(n.point, seed.point) <= tolerance);
      if (found) return found;
    }
    const result = { ...seed, edges: new Set<number>(), id: nodes.length }, key = cell.join(',');
    nodes.push(result); buckets.set(key, [...buckets.get(key) ?? [], result]); return result;
  };
  const keys = new Set<string>(), edges: [number, number][] = [];
  for (const [a, b] of segments) {
    const x = node(a), y = node(b); if (x === y) continue;
    const key = [x.id, y.id].sort((a, b) => a - b).join(','); if (keys.has(key)) continue;
    keys.add(key); x.edges.add(edges.length); y.edges.add(edges.length); edges.push([x.id, y.id]);
  }
  if (nodes.some(node => node.edges.size > 2)) throw new RangeError('Surface intersection branches or has unresolved tangency');
  const unused = new Set(edges.map((_, i) => i)), output: SurfaceIntersection[] = [];
  const atPole = (index: number) => [...a.surface.poles, ...b.surface.poles].some(pole => vec3.distance(pole.position, nodes[index].point) <= tolerance);
  while (unused.size) {
    const firstEdge = unused.values().next().value!;
    let first = edges[firstEdge][0];
    // Find an endpoint before tracing an open component.
    const seen = new Set<number>(); let cursor = first;
    while (nodes[cursor].edges.size === 2 && !atPole(cursor) && !seen.has(cursor)) {
      seen.add(cursor); const next = [...nodes[cursor].edges].map(i => edges[i].find(n => n !== cursor)!).find(n => !seen.has(n));
      if (next === undefined) break; cursor = next;
    }
    if (nodes[cursor].edges.size === 1 || atPole(cursor)) first = cursor;
    const stations = [nodes[first].uv]; cursor = first;
    while (true) {
      const edge = [...nodes[cursor].edges].find(i => unused.has(i)); if (edge === undefined) break;
      unused.delete(edge); cursor = edges[edge].find(n => n !== cursor)!; stations.push(nodes[cursor].uv);
      if (cursor === first || atPole(cursor)) break;
    }
    if (stations.length > 1) {
      const curve = new SurfaceIntersection(a, b, stations.map(q => [...q]), cursor === first, tolerance);
      // Coincident walls and tangential contacts do not partition a regularized
      // solid. Their finite region boundaries are supplied by adjacent surfaces.
      const transverse = curve.sampleWithParameters().some(({ t }) => {
        const q = curve.parameters(t), [au, av] = a.derivatives({ x: q[0], y: q[1] }), [bu, bv] = b.derivatives({ x: q[2], y: q[3] });
        const na = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], au, av)), nb = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], bu, bv));
        return vec3.length(vec3.cross([0, 0, 0], na, nb)) > 1e-9;
      });
      if (transverse) output.push(curve);
    }
  }
  return output;
}
