import { validatePoint, type Point } from './Point.js';
import { curveParameters } from './util/curveSampling.js';
import { TRIANGULATION_RESOLUTION } from './triangulation.js';

/**
 * An exact curve in local XY coordinates with a normalized [0, 1] parameter.
 *
 * @remarks
 * The evaluator defines the parameterization; it need not have constant speed.
 * Geometry remains mathematical until sample() is called. Use
 * {@link SpatialCurve.fromPlanarCurve} to place the curve on a world-space plane.
 */
export class PlanarCurve {
  /** Shared point at parameter zero. */
  readonly start: Point;
  /** Shared point at parameter one; matching endpoint coordinates define a loop. */
  readonly end: Point;
  private readonly evaluate: (t: number) => Point;

  /**
   * Create a parametric planar curve without tessellating it.
   *
   * @param options - Exact evaluator and optional shared endpoint objects.
   * @throws {@link RangeError} if endpoint coordinates are nonfinite or disagree with the evaluator.
   */
  constructor({ at, start, end }: {
    at: (t: number) => Point;
    start?: Point;
    end?: Point;
  }) {
    this.evaluate = at;
    const a = validatePoint(at(0)), b = validatePoint(at(1));
    this.start = validatePoint(start ?? a);
    this.end = validatePoint(end ?? b);
    for (const [actual, expected] of [[a, this.start], [b, this.end]]) {
      if (Math.abs(actual.x - expected.x) > 1e-10 * Math.max(1, Math.abs(actual.x), Math.abs(expected.x)) ||
          Math.abs(actual.y - expected.y) > 1e-10 * Math.max(1, Math.abs(actual.y), Math.abs(expected.y))) {
        throw new RangeError('Curve endpoints must agree with its evaluator');
      }
    }
  }

  /**
   * Evaluate the exact curve, returning shared endpoint objects at zero and one.
   * @param t - Normalized parameter in [0, 1], rather than an angle.
   * @throws {@link RangeError} if t is outside [0, 1] or the result is nonfinite.
   */
  at(t: number): Point {
    if (!Number.isFinite(t) || t < 0 || t > 1) throw new RangeError('Curve parameter must be in [0, 1]');
    return t === 0 ? this.start : t === 1 ? this.end : validatePoint(this.evaluate(t));
  }

  /** Test exact endpoint coordinate equality; no separate Loop class is required. */
  isLoop(): boolean { return this.start.x === this.end.x && this.start.y === this.end.y; }

  /**
   * Choose normalized parameters for a polyline, including zero and one.
   * @param options - Optional positive chord-deviation resolution in model units.
   * @remarks
   * Uses adaptive evaluation by default. Subclasses can provide tighter bounds
   * or a specialized subdivision rule without changing spatial curve code.
   * @throws {@link RangeError} if resolution is invalid or subdivision cannot converge.
   */
  sampleParameters({ resolution = TRIANGULATION_RESOLUTION }: { resolution?: number } = {}): readonly number[] {
    return curveParameters(this, resolution);
  }

  /**
   * Sample local points at the library's 0.001 chord-deviation resolution.
   *
   * @remarks
   * Includes both endpoints, including the repeated closing point of a loop.
   * Subdivision comes from sampleParameters(). Adaptive evaluators use
   * quarter-point probes; arbitrary oscillations between probes cannot be bounded
   * without additional curvature information. Unresolved subdivision throws.
   */
  sample(): Point[] {
    return this.sampleParameters().map(t => this.at(t));
  }
}

/**
 * Create a parametric planar curve without tessellating it.
 *
 * Constructor shorthand for `new PlanarCurve(options)`; returns a new {@link PlanarCurve} instance.
 *
 * @param options - Exact evaluator and optional shared endpoint objects.
 * @throws {@link RangeError} if endpoint coordinates are nonfinite or disagree with the evaluator.
 */
export function planarCurve(options: {
  /** Local XY evaluator on [0, 1]; responsible for the curve's parameterization. */
  at: (t: number) => Point;
  /** Optional shared point at zero; must agree with the evaluator. */
  start?: Point;
  /** Optional shared point at one; use the start object for a closed loop. */
  end?: Point;
}): PlanarCurve { return new PlanarCurve(options); }
