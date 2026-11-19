import type { ReadonlyVec2 } from 'gl-matrix';
import { Point } from './Point.js';

/**
 * An infinite construction line defined by a point and a direction vector.
 *
 * @remarks
 * Lines do not bound an extruded profile. The direction is copied without
 * normalization; its magnitude determines the spacing of parameter values.
 */
export class Line {
  /** Copied local XY direction vector. */
  readonly direction: ReadonlyVec2;

  /**
   * Create an infinite line in sketch coordinates.
   *
   * @param point - Point at parameter zero.
   * @param direction - Finite, nonzero local XY vector.
   * @throws {@link RangeError} if the direction is zero or not finite.
   */
  constructor(
    /** Point at parameter zero. */
    public readonly point: Point,
    direction: ReadonlyVec2
  ) {
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
    return new Point(this.point.x + t * this.direction[0], this.point.y + t * this.direction[1]);
  }
}
