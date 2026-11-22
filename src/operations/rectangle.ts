import type { LineSegment } from '../LineSegment.js';
import { validatePoint, type Point } from '../Point.js';
import { degtorad } from '../util/angles.js';
import { polyline } from './polyline.js';

/**
 * Create a rectangle from opposite corners, a center and a corner, or side lengths.
 * Choose exactly one construction:
 * - corner1 and corner2, in either coordinate order;
 * - center and either corner;
 * - width and height, optionally anchored by center or one corner. Without an
 * anchor, the center defaults to (0, 0). With sizes, corner1 is the rotated local
 * upper-left corner and corner2 the rotated local lower-right corner.
 * Extra defining points or sizes throw instead of being ignored.
 *
 * @param options.center - Center in sketch coordinates; pair with a corner or both sizes.
 * @param options.corner1 - Actual first corner in sketch coordinates, after rotation.
 * @param options.corner2 - Actual diagonally opposite corner, after rotation.
 * @param options.width - Positive side length along the rotated local X axis, not bounding-box width.
 * @param options.height - Positive side length along the rotated local Y axis, not bounding-box height.
 * @param options.rotation - Counterclockwise orientation in degrees about the center; defaults to zero.
 * Supplied corners stay fixed; their separation is projected onto the rotated axes to derive sizes.
 * @returns Four connected line segments forming a loop, retaining supplied corner objects.
 * No source points are modified. Segments traverse from corner1 along local X to
 * the adjacent corner, then corner2, then the remaining corner.
 * @throws {@link RangeError} for ambiguous/incomplete options, nonfinite geometry,
 * nonpositive sizes, or dimensions collapsed at numerical precision.
 * @example
 * ```ts
 * s.add(rectangle({ center: { x: 0, y: 0 }, width: 20, height: 10, rotation: 30 }));
 * s.add(rectangle({ corner1: { x: 0, y: 10 }, corner2: { x: 20, y: 0 } }));
 * s.add(rectangle({ center: { x: 5, y: 3 }, corner2: { x: 10, y: 6 } }));
 * ```
 */
export function rectangle({ center, corner1, corner2, width, height, rotation: rotationDEG = 0 }: {
  /** Center in sketch coordinates. With sizes alone, defaults to (0, 0). */
  center?: Point;
  /** Actual first corner. With width/height, anchors the rotated local upper-left corner. */
  corner1?: Point;
  /** Actual opposite corner. With width/height, anchors the rotated local lower-right corner. */
  corner2?: Point;
  /** Positive actual side length along rotated local X; supply together with height. */
  width?: number;
  /** Positive actual side length along rotated local Y; supply together with width. */
  height?: number;
  /** Counterclockwise orientation in degrees about the center; defaults to zero. */
  rotation?: number;
}): LineSegment[] {
  for (const point of [center, corner1, corner2]) if (point !== undefined) validatePoint(point);
  if (!Number.isFinite(rotationDEG)) throw new RangeError('Rectangle rotation must be finite');
  for (const size of [width, height]) if (size !== undefined && (!Number.isFinite(size) || size <= 0)) {
    throw new RangeError('Rectangle width and height must be positive and finite');
  }
  const pointCount = [center, corner1, corner2].filter(point => point !== undefined).length;
  const sizeCount = Number(width !== undefined) + Number(height !== undefined);
  if (pointCount > 2 || (sizeCount > 0 && pointCount > 1)) {
    throw new RangeError('Ambiguous rectangle parameters: choose opposite corners, center and one corner, or width/height with at most one anchor');
  }
  if (sizeCount !== 2 && !(sizeCount === 0 && pointCount === 2)) {
    throw new RangeError('A rectangle needs opposite corners, center and one corner, or both width and height');
  }
  const rotationRAD = degtorad(rotationDEG % 360);
  // Exact quarter turns avoid spurious sliver dimensions for axis-aligned diagonals.
  const cos = rotationDEG % 90 === 0 ? Math.round(Math.cos(rotationRAD)) || 0 : Math.cos(rotationRAD);
  const sin = rotationDEG % 90 === 0 ? Math.round(Math.sin(rotationRAD)) || 0 : Math.sin(rotationRAD);
  let start: Point, end: Point, sizeX: number;
  if (width !== undefined && height !== undefined) {
    sizeX = width;
    const dx = width * cos + height * sin, dy = width * sin - height * cos;
    if (corner1 !== undefined) {
      start = corner1; end = { x: start.x + dx, y: start.y + dy };
    } else if (corner2 !== undefined) {
      end = corner2; start = { x: end.x - dx, y: end.y - dy };
    } else {
      const midpoint = center ?? { x: 0, y: 0 };
      start = { x: midpoint.x - dx / 2, y: midpoint.y - dy / 2 };
      end = { x: midpoint.x + dx / 2, y: midpoint.y + dy / 2 };
    }
  } else {
    start = corner1 ?? { x: center!.x + (center!.x - corner2!.x), y: center!.y + (center!.y - corner2!.y) };
    end = corner2 ?? { x: center!.x + (center!.x - start.x), y: center!.y + (center!.y - start.y) };
    const dx = end.x - start.x, dy = end.y - start.y;
    sizeX = dx * cos + dy * sin;
    const sizeY = -dx * sin + dy * cos;
    const tolerance = rotationDEG % 90 === 0 ? 0 : 16 * Number.EPSILON * Math.hypot(dx, dy);
    if (!Number.isFinite(sizeX) || !Number.isFinite(sizeY) || Math.abs(sizeX) <= tolerance || Math.abs(sizeY) <= tolerance) {
      throw new RangeError('Rectangle corners must define nonzero finite width and height along its rotated axes');
    }
  }
  const stepX = sizeX * cos, stepY = sizeX * sin;
  return polyline({ points: [start, { x: start.x + stepX, y: start.y + stepY }, end,
    { x: end.x - stepX, y: end.y - stepY }], loop: true });
}
