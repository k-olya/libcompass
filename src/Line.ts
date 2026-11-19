import type { ReadonlyVec2 } from 'gl-matrix';
import { validatePoint, type Point } from './Point.js';

/**
 * An infinite construction line defined by a point and a direction vector.
 *
 * @remarks
 * Lines do not bound an extruded profile. The direction is copied without
 * normalization; its magnitude determines the spacing of parameter values.
 */
export class Line {
  /** Point at parameter zero, retained by reference. */
  readonly point: Point;
  /** Copied local XY direction vector. */
  readonly direction: ReadonlyVec2;

  /**
   * Create an infinite line in sketch coordinates.
   *
   * @param options - Point at parameter zero and a finite, nonzero local XY direction.
   * @throws {@link RangeError} if the point or direction is nonfinite, or the direction is zero.
   */
  constructor({ point, direction }: { point: Point; direction: ReadonlyVec2 }) {
    this.point = validatePoint(point);
    if (![direction[0], direction[1]].every(Number.isFinite) || Math.hypot(direction[0], direction[1]) === 0) {
      throw new RangeError('Line direction must be finite and nonzero');
    }
    this.direction = [direction[0], direction[1]];
  }

  /**
   * Evaluate `point + t * direction`.
   *
   * @param t - Unbounded line parameter; negative values are allowed.
   * @returns A new point in sketch coordinates.
   * @throws {@link RangeError} if the resulting coordinates are not finite.
   */
  at(t: number): Point {
    return validatePoint({ x: this.point.x + t * this.direction[0], y: this.point.y + t * this.direction[1] });
  }
}

/**
 * Create an infinite line in sketch coordinates.
 *
 * Constructor shorthand for `new Line(options)`; returns a new {@link Line} instance.
 *
 * @param options - Point at parameter zero and a finite, nonzero local XY direction.
 * @throws {@link RangeError} if the point or direction is nonfinite, or the direction is zero.
 */
export function line(options: {
  /** Point at parameter zero, retained by reference. */
  point: Point;
  /** Copied local XY direction vector. */
  direction: ReadonlyVec2;
}): Line { return new Line(options); }
