import { validatePoint, type Point } from './Point.js';
import { PlanarCurve } from './PlanarCurve.js';

/**
 * An analytic planar curve tracing one counterclockwise circle on [0, 1].
 *
 * @remarks
 * The circle remains analytic through extrusion. Triangulation samples it at
 * the configured library-wide chord-deviation resolution.
 * at(0) and at(1) share the point at local +X; at(0.25) is a quarter turn.
 * To evaluate degrees, use at(angleDEG / 360); for radians use at(angleRAD / (2 * PI)).
 */
export class Circle extends PlanarCurve {
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
    validatePoint(center);
    if (!Number.isFinite(radius) || radius <= 0) {
      throw new RangeError('Circle radius must be positive and finite');
    }
    const at = (t: number): Point => {
      const angleRAD = t === 1 ? 0 : t * 2 * Math.PI;
      return { x: center.x + radius * Math.cos(angleRAD), y: center.y + radius * Math.sin(angleRAD) };
    };
    const start = at(0);
    super({ at, tangent: t => [-Math.sin(t * 2 * Math.PI), Math.cos(t * 2 * Math.PI)], start, end: start });
    this.center = center;
    this.radius = radius;
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
