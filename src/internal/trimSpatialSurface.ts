import { vec3 } from 'gl-matrix';
import { Plane } from '../Plane.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { SpatialSurface, type SurfaceSides } from '../SpatialSurface.js';
import { TrimmedSurface } from '../TrimmedSurface.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import { parameterizedSamples, sampleParameter } from './curveSamples.js';
import { scalarIntersections, uniqueParameters } from './curveIntersections.js';
import { sliceSpatialCurve } from './curveTrimming.js';
import { surfaceFrame } from './surfaceGeometry.js';

/** New rails keep source stations and refine their own equations through normal curve sampling. */
class SurfaceRail extends SpatialCurve {
  constructor(at: (t: number) => Vertex, private readonly seeds: (options: { resolution?: number }) => readonly number[],
    start?: Vertex, end?: Vertex) { super({ at, start, end }); }
  override sample(options: { resolution?: number } = {}): Vertex[] {
    const own = super.sample(options).map((point, i, points) => sampleParameter(this, point, i, points.length)!);
    return uniqueParameters([...own, ...this.seeds(options)]).map(t => this.at(t));
  }
}

/** A single transverse intersection rail can be retained as the same chart used by chamfers. */
export function trimSpatialSurface(surface: SpatialSurface, cutter: Plane, keep: string): TrimmedSurface[] {
  const grid = surface.sample();
  const distance = (point: Vertex) => vec3.dot(vec3.subtract([0, 0, 0], point.position, cutter.origin), cutter.normal);
  const distances = grid.vertices.flat().map(distance), tolerance = 1e-10 * Math.max(1, ...distances.map(Math.abs));
  if (distances.every(value => Math.abs(value) <= tolerance)) throw new RangeError('A coincident cutting plane does not select a side');
  if (distances.every(value => value > tolerance) || distances.every(value => value < -tolerance)) {
    return (distances[0] > 0) === (keep === 'positive') ? [new TrimmedSurface({ surface,
      at: (u, v) => ({ x: u, y: v }), boundaryLoops: surface.boundaryLoops, sides: surface.sides })] : [];
  }
  let cause: unknown;
  for (const swapped of [false, true]) {
    try {
      // The root direction must be open. A periodic circle generally has two cuts.
      if (swapped ? surface.periodicU : surface.periodicV) continue;
      const at = (p: number, q: number) => swapped ? surface.at(q, p) : surface.at(p, q);
      const stations = swapped ? grid.v : grid.u, crossStations = swapped ? grid.u : grid.v;
      const bottomSide = swapped ? 'u0' : 'v0', topSide = swapped ? 'u1' : 'v1';
      const leftSide = swapped ? 'v0' : 'u0', rightSide = swapped ? 'v1' : 'u1';
      const periodic = swapped ? surface.periodicV : surface.periodicU;
      const seeds = (options: { resolution?: number }) => uniqueParameters([...stations,
        ...[surface.sides[bottomSide], surface.sides[topSide]].flatMap(side => side ? parameterizedSamples(side, options).map(sample => sample.t) : [])]);
      const roots = new Map<number, number>();
      const root = (p: number): number => {
        const cached = roots.get(p);
        if (cached !== undefined) return cached;
        const profile = new SurfaceRail(q => at(p, q), () => crossStations);
        const values = scalarIntersections(profile, distance);
        if (values.length !== 1 || values[0] <= 1e-9 || values[0] >= 1 - 1e-9) {
          throw new RangeError('The cutting plane must cross each parameter line once, away from its endpoints');
        }
        roots.set(p, values[0]); return values[0];
      };
      for (const p of seeds({})) root(p);
      const high = (distance(at(0, 1)) > 0) === (keep === 'positive');
      for (const p of seeds({})) {
        if (((distance(at(p, 1)) > 0) === (keep === 'positive')) !== high) throw new RangeError('Cut side changes across the surface chart');
      }
      const cutAt = (p: number) => at(p, root(p));
      const first = cutAt(0), last = periodic ? first : cutAt(1);
      const rail = new SurfaceRail(cutAt, seeds, first, last);
      // Evaluating the rail's full sampler detects unresolved folds between source stations.
      for (const { t } of rail.sampleWithParameters()) {
        const r = root(t);
        surfaceFrame(surface, swapped ? { x: r, y: t } : { x: t, y: r });
      }
      const far = high ? 1 : 0;
      const fixedAt = (p: number) => at(p, far);
      const fixedStart = fixedAt(0);
      const fixed = surface.sides[high ? topSide : bottomSide]
        ?? new SurfaceRail(fixedAt, seeds, fixedStart, periodic ? fixedStart : fixedAt(1));
      const bottom = high ? rail : fixed, top = high ? fixed : rail;
      const sides: SurfaceSides = { [bottomSide]: bottom, [topSide]: top };
      const makeSide = (p: number, original: SpatialBoundary | undefined, start: Vertex, end: Vertex): SpatialBoundary => {
        const a = high ? root(p) : 0, b = high ? 1 : root(p);
        return original ? sliceSpatialCurve(original, a, b, start, end)
          : new SurfaceRail(t => at(p, a + (b - a) * t), () => crossStations.filter(q => q > a && q < b).map(q => (q - a) / (b - a)), start, end);
      };
      if (!periodic) {
        sides[leftSide] = makeSide(0, surface.sides[leftSide], bottom.start, top.start);
        sides[rightSide] = makeSide(1, surface.sides[rightSide], bottom.end, top.end);
      }
      const boundaryLoops = periodic ? [[bottom], [top]] : [[bottom, sides[rightSide]!, top, sides[leftSide]!]];
      const result = new TrimmedSurface({ surface, sides, boundaryLoops, at: (u, v) => {
        const p = swapped ? v : u, q = swapped ? u : v, r = root(p);
        const next = high ? r + (1 - r) * q : r * q;
        return swapped ? { x: next, y: p } : { x: p, y: next };
      } });
      // Resolve the chart now rather than returning an object that fails only during rendering.
      const retained = result.sample();
      for (const u of retained.u) for (const v of retained.v) surfaceFrame(result, { x: u, y: v });
      return [result];
    } catch (error) { cause = error; }
  }
  throw new RangeError(`This curved-surface cut requires multiple charts or unresolved intersection trimming${cause instanceof Error ? `: ${cause.message}` : ''}`, { cause });
}
