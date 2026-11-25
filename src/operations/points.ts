import { Circle } from '../Circle.js';
import { Line } from '../Line.js';
import { LineSegment } from '../LineSegment.js';
import { PlanarCurve } from '../PlanarCurve.js';
import { validatePoint, type Point } from '../Point.js';
import type { PointsTarget } from '../PointsTarget.js';
import { Sketch } from '../Sketch.js';

/**
 * Collect the anchor points of local 2D geometry into a flat array.
 * @param geometry - Individual geometry and arbitrarily nested readonly arrays,
 * visited in argument order and depth-first array order. Sketches visit their elements.
 * @returns Points themselves, line origins, segment starts and ends, curve at(0)
 * and at(1), and circle centers. Circles contribute only their center.
 * Anchors with exactly equal XY coordinates are deduplicated, retaining the first
 * occurrence and its original identity. Positive and negative zero compare equal.
 * Sketch coordinates remain local, regardless of the sketch's placement plane.
 * Empty input returns an empty array. Inputs are never modified or sampled.
 * @throws {@link TypeError} for unsupported geometry.
 * @throws {@link RangeError} for nonfinite anchor coordinates.
 * @example
 * ```ts
 * const anchors = points(rectangle({ width: 10, height: 5 }), [circle(2)]);
 * ```
 */
export function points(...geometry: readonly PointsTarget[]): Point[] {
  const result: Point[] = [];
  const seen = new Set<string>();
  const append = (point: Point): void => {
    validatePoint(point);
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(point);
  };
  const visit = (item: PointsTarget): void => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
    } else if (item instanceof Sketch) {
      for (const element of item.elements) visit(element);
    } else if (item instanceof Circle) {
      append(item.center);
    } else if (item instanceof PlanarCurve) {
      append(item.at(0)); append(item.at(1));
    } else if (item instanceof LineSegment) {
      append(item.start); append(item.end);
    } else if (item instanceof Line) {
      append(item.point);
    } else if (item && typeof item === 'object' && 'x' in item && 'y' in item) {
      append(item);
    } else {
      throw new TypeError('Points requires local 2D geometry or arrays of it');
    }
  };
  for (const item of geometry) visit(item);
  return result;
}
