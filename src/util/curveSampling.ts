import type { SpatialCurve } from '../SpatialCurve.js';
import type { PlanarCurve } from '../PlanarCurve.js';
import { Circle } from '../Circle.js';
import type { Point } from '../Point.js';
import type { Vertex } from '../Vertex.js';
import { circleSegments, TRIANGULATION_RESOLUTION } from '../triangulation.js';

const cache = new WeakMap<PlanarCurve | SpatialCurve, Map<number, readonly number[]>>();
const coordinates = (point: Point | Vertex): readonly number[] => 'position' in point ? Array.from(point.position) : [point.x, point.y];

/** Tessellation parameters shared by standalone sampling and surface meshes. */
export function curveParameters(curve: PlanarCurve | SpatialCurve, resolution = TRIANGULATION_RESOLUTION): readonly number[] {
  const cached = cache.get(curve) ?? new Map<number, readonly number[]>();
  const existing = cached.get(resolution);
  if (existing) return existing;
  let parameters: number[];
  const circle = curve instanceof Circle ? curve : 'circle' in curve ? curve.circle : undefined;
  if (circle) {
    const count = circleSegments(circle.radius, resolution);
    parameters = Array.from({ length: count + 1 }, (_, i) => i / count);
  } else {
    parameters = [0];
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
  }
  cached.set(resolution, parameters);
  cache.set(curve, cached);
  return parameters;
}
