import type { SpatialCurve } from '../SpatialCurve.js';
import { circleSegments, TRIANGULATION_RESOLUTION } from '../triangulation.js';

const cache = new WeakMap<SpatialCurve, Map<number, readonly number[]>>();

/** Tessellation parameters shared by standalone sampling and surface meshes. */
export function curveParameters(curve: SpatialCurve, resolution = TRIANGULATION_RESOLUTION): readonly number[] {
  const cached = cache.get(curve) ?? new Map<number, readonly number[]>();
  const existing = cached.get(resolution);
  if (existing) return existing;
  let parameters: number[];
  if (curve.circle) {
    const count = circleSegments(curve.circle.radius, resolution);
    parameters = Array.from({ length: count + 1 }, (_, i) => i / count);
  } else {
    parameters = [0];
    const refine = (a: number, b: number, depth: number): void => {
      const start = curve.at(a).position, end = curve.at(b).position;
      const error = Math.max(...[0.25, 0.5, 0.75].map(fraction => {
        const point = curve.at(a + (b - a) * fraction).position;
        return Math.hypot(...Array.from(point).map((value, i) => value - (start[i] + (end[i] - start[i]) * fraction)));
      }));
      if (error > resolution) {
        if (depth >= 20) throw new RangeError('Curve cannot be sampled at the triangulation resolution');
        const middle = (a + b) / 2;
        refine(a, middle, depth + 1); refine(middle, b, depth + 1);
      } else parameters.push(b);
    };
    for (let i = 0; i < 8; i++) refine(i / 8, (i + 1) / 8, 0);
  }
  cached.set(resolution, parameters);
  cache.set(curve, cached);
  return parameters;
}
