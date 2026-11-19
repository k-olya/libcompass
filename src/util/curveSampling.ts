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
  const parameters = [0];
  const refine = (a: number, b: number, depth: number): void => {
    const start = coordinates(curve.at(a)), end = coordinates(curve.at(b));
    const error = Math.max(...[0.25, 0.5, 0.75].map(fraction => {
      const point = coordinates(curve.at(a + (b - a) * fraction));
      return Math.hypot(...point.map((value, i) => value - (start[i] + (end[i] - start[i]) * fraction)));
    }));
    if (error > resolution) {
      if (depth >= 20) throw new RangeError('Curve cannot be sampled at the triangulation resolution');
      const middle = (a + b) / 2;
      refine(a, middle, depth + 1); refine(middle, b, depth + 1);
    } else parameters.push(b);
  };
  for (let i = 0; i < 8; i++) refine(i / 8, (i + 1) / 8, 0);
  cached.set(resolution, parameters);
  cache.set(curve, cached);
  return parameters;
}
