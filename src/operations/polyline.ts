import { LineSegment } from '../LineSegment.js';
import { validatePoint, type Point } from '../Point.js';

/**
 * Join consecutive planar points with line segments.
 * @param options.points - Ordered points; retained by reference without changing the array.
 * @param options.loop - Close the last point to the first; defaults to false.
 * A repeated closing point is accepted without creating an extra segment.
 * @returns Connected line segments, sharing endpoint objects at each join.
 * Profile validity, including self-intersections, is checked when extruding.
 * @throws {@link RangeError} for nonfinite points, coincident consecutive points,
 * fewer than two open points, or fewer than three loop points.
 * @example
 * ```ts
 * s.add(...polyline({ points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }], loop: true }));
 * ```
 */
export function polyline({ points, loop = false }: {
  /** Consecutive local XY points; endpoints are retained by reference. */
  points: readonly Point[];
  /** Connect the last point to the first to make a polygon loop; defaults to false. */
  loop?: boolean;
}): LineSegment[] {
  points.forEach(validatePoint);
  const first = points[0], last = points.at(-1);
  const vertices = loop && first && last && first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
  if (vertices.length < (loop ? 3 : 2)) throw new RangeError(loop ? 'A polyline loop needs at least three points' : 'A polyline needs at least two points');
  return Array.from({ length: vertices.length - (loop ? 0 : 1) }, (_, i) =>
    new LineSegment({ start: vertices[i], end: vertices[(i + 1) % vertices.length] }));
}
