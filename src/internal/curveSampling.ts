import type { Point } from '../Point.js';
import type { Vertex } from '../Vertex.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';

type ParametricCurve = { at(t: number): Point | Vertex };
const cache = new WeakMap<ParametricCurve, Map<number, readonly number[]>>();
const coordinates = (point: Point | Vertex): readonly number[] => 'position' in point ? Array.from(point.position) : [point.x, point.y];

/** Adaptive parameters for any local or world-space at(t) evaluator. */
export function curveParameters(curve: ParametricCurve, resolution = TRIANGULATION_RESOLUTION): readonly number[] {
  if (!Number.isFinite(resolution) || resolution <= 0) throw new RangeError('Triangulation resolution must be positive and finite');
  const cached = cache.get(curve) ?? new Map<number, readonly number[]>();
  const existing = cached.get(resolution);
  if (existing) return existing;
  // ponytail: midpoint probes can miss oscillations; stronger bounds belong in a specialized sampler.
  const parameters = [0];
  const start = coordinates(curve.at(0)), end = coordinates(curve.at(1));
  const closed = start.every((value, i) => value === end[i]);
  const refine = (a: number, b: number, depth: number): void => {
    const start = coordinates(curve.at(a)), end = coordinates(curve.at(b));
    const middle = coordinates(curve.at((a + b) / 2));
    const error = Math.hypot(...middle.map((value, i) => value - (start[i] + end[i]) / 2));
    // Keep four segments in a closed curve even at coarse tolerances, so
    // its analysis polyline does not collapse to a back-and-forth line.
    if (error > resolution || (closed && depth === 0)) {
      if (depth >= 20) throw new RangeError('Curve cannot be sampled at the triangulation resolution');
      const middle = (a + b) / 2;
      refine(a, middle, depth + 1); refine(middle, b, depth + 1);
    } else parameters.push(b);
  };
  refine(0, 0.5, 0);
  refine(0.5, 1, 0);
  cached.set(resolution, parameters);
  cache.set(curve, cached);
  return parameters;
}
