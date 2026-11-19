import { Point } from './Point.js';

/**
 * An analytic circle in sketch coordinates, parameterized by angle in radians.
 *
 * @remarks
 * The circle remains analytic in a sketch. Extrusion samples it into a polygon
 * at the requested resolution.
 */
export class Circle {
  /**
   * Create a circle with a positive radius.
   *
   * @param center - Local XY center, retained by reference.
   * @param radius - Positive, finite radius in model units.
   * @throws {@link RangeError} if the radius is not positive and finite.
   */
  constructor(
    /** Center in sketch coordinates. */
    public readonly center: Point,
    /** Radius in model units. */
    public readonly radius: number
  ) {
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new RangeError('Circle radius must be positive and finite');
    }
  }

  /**
   * Evaluate a point on the circle.
   *
   * @param angle - Angle in radians, measured counterclockwise from local +X.
   * @returns A new point in sketch coordinates.
   * @throws {@link RangeError} if the resulting coordinates are not finite.
   */
  at(angle: number): Point {
    return new Point(
      this.center.x + this.radius * Math.cos(angle),
      this.center.y + this.radius * Math.sin(angle),
    );
  }

  /**
   * Sample one counterclockwise polygonal boundary.
   *
   * @param segments - Number of evenly spaced points; defaults to 64.
   * @returns New points starting at angle zero, without repeating the closing point.
   * @throws {@link RangeError} if segments is not an integer of at least three,
   * or a sampled coordinate is not finite.
   */
  sample(segments = 64): Point[] {
    if (!Number.isInteger(segments) || segments < 3) {
      throw new RangeError('A circle needs at least three segments');
    }
    return Array.from({ length: segments }, (_, i) => this.at(2 * Math.PI * i / segments));
  }
}
