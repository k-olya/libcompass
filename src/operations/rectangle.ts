import type { LineSegment } from '../LineSegment.js';
import { validatePoint, type Point } from '../Point.js';
import { polyline } from './polyline.js';

/**
 * Create a rectangle aligned with the sketch's local X and Y axes.
 * @param options.start - First corner in local XY coordinates.
 * @param options.end - Diagonally opposite corner; either coordinate order is accepted.
 * @returns Four connected line segments forming a loop. Supplied corners are retained by reference.
 * @throws {@link RangeError} for nonfinite corners or zero width or height.
 * @example
 * ```ts
 * s.add(...rectangle({ start: { x: 0, y: 0 }, end: { x: 20, y: 10 } }));
 * ```
 */
export function rectangle({ start, end }: {
  /** First corner in sketch coordinates, retained by reference. */
  start: Point;
  /** Diagonally opposite corner, retained by reference. */
  end: Point;
}): LineSegment[] {
  validatePoint(start); validatePoint(end);
  return polyline({ points: [start, { x: end.x, y: start.y }, end, { x: start.x, y: end.y }], loop: true });
}
