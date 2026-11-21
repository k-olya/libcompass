import type { LineSegment } from '../LineSegment.js';
import { validatePoint, type Point } from '../Point.js';
import { rectangle } from './rectangle.js';

/**
 * Create an axis-aligned rectangle from its center and any corner.
 * @param options.center - Rectangle center in local sketch coordinates.
 * @param options.corner - Any corner, determining the half-width and half-height.
 * @returns Four connected line segments forming a loop, centered on center.
 * @throws {@link RangeError} for nonfinite coordinates or zero width or height.
 * @example
 * ```ts
 * s.add(...centerRectangle({ center: { x: 0, y: 0 }, corner: { x: 10, y: 5 } }));
 * ```
 */
export function centerRectangle({ center, corner }: {
  /** Rectangle center in local sketch coordinates. */
  center: Point;
  /** Any corner; retained by reference as a segment endpoint. */
  corner: Point;
}): LineSegment[] {
  validatePoint(center); validatePoint(corner);
  return rectangle({ start: { x: center.x + (center.x - corner.x), y: center.y + (center.y - corner.y) }, end: corner });
}
