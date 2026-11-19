import { validatePoint, type Point } from './Point.js';

/**
 * An analytic circle in sketch coordinates, parameterized by angle in radians.
 *
 * @remarks
 * The circle remains analytic in a sketch. Extrusion samples it into a polygon
 * at the requested resolution.
 */
export class Circle {
  /** Center in sketch coordinates, retained by reference. */
  readonly center: Point;
  /** Positive radius in model units. */
  readonly radius: number;
  /**
   * Create a circle with a positive radius.
   *
   * @param options - Local XY center and positive radius in model units.
   * @throws {@link RangeError} if the center is nonfinite or the radius is not positive and finite.
   */
  constructor({ center, radius }: { center: Point; radius: number }) {
    this.center = validatePoint(center);
    this.radius = radius;
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
    return validatePoint({ x: this.center.x + this.radius * Math.cos(angle), y: this.center.y + this.radius * Math.sin(angle) });
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

/**
 * Create a circle with a positive radius.
 *
 * Constructor shorthand for `new Circle(options)`; returns a new {@link Circle} instance.
 *
 * @param options - Local XY center and positive radius in model units.
 * @throws {@link RangeError} if the center is nonfinite or the radius is not positive and finite.
 */
export function circle(options: {
  /** Center in sketch coordinates, retained by reference. */
  center: Point;
  /** Positive radius in model units. */
  radius: number;
}): Circle { return new Circle(options); }
