import { validatePoint, type Point } from './Point.js';
import { circleSegments } from './triangulation.js';

/**
 * An analytic circle in sketch coordinates, parameterized by angle in radians.
 *
 * @remarks
 * The circle remains analytic through extrusion. Triangulation samples it at
 * the library-wide 0.001 chord-deviation resolution.
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
   * @returns New points at the library resolution, starting at angle zero,
   * without repeating the closing point. Segment count is derived from radius.
   * @throws {@link RangeError} if sampled coordinates are not finite.
   */
  sample(): Point[] {
    const segments = circleSegments(this.radius);
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
