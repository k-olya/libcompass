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
   * Create a circle with a positive radius; its center defaults to (0, 0).
   *
   * Accepts a radius directly, or an options object to specify the center.
   *
   * @param options - Positive radius in model units and optional local XY center (default (0, 0)).
   * @throws {@link RangeError} if the center is nonfinite or the radius is not positive and finite.
   */
  constructor(options: number | { center?: Point; radius: number }) {
    const { center = { x: 0, y: 0 }, radius } = typeof options === 'number' ? { radius: options } : options;
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
 * Create a circle with a positive radius; its center defaults to (0, 0).
 *
 * Accepts a radius directly, or an options object to specify the center.
 *
 * Constructor shorthand for `new Circle(options)`; returns a new {@link Circle} instance.
 *
 * @param options - Positive radius in model units and optional local XY center (default (0, 0)).
 * @throws {@link RangeError} if the center is nonfinite or the radius is not positive and finite.
 */
export function circle(options: number | {
  /** Center in sketch coordinates, retained by reference; defaults to (0, 0). */
  center?: Point;
  /** Positive radius in model units. */
  radius: number;
}): Circle { return new Circle(options); }
