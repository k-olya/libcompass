import { Plane } from './Plane.js';
import { PlanarCurve } from './PlanarCurve.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { validateVertex, type Vertex } from './Vertex.js';
import { curveParameters } from './util/curveSampling.js';
import { TRIANGULATION_RESOLUTION } from './triangulation.js';

/**
 * A mathematically evaluated world-space curve with a normalized [0, 1] parameter.
 *
 * @remarks
 * The evaluator defines the parameterization; it need not have constant speed.
 * Geometry is retained analytically; sample() alone produces a polyline.
 */
export class SpatialCurve implements SpatialBoundary {
  readonly start: Vertex;
  readonly end: Vertex;
  private readonly evaluate: (t: number) => Vertex;
  private planar?: { curve: PlanarCurve; plane: Plane };

  /**
   * Create a parametric curve without tessellating it.
   *
   * @param options - Exact evaluator and optional shared endpoint objects.
   * @throws {@link RangeError} if endpoint coordinates are nonfinite or disagree with the evaluator.
   */
  constructor({ at, start, end }: {
    at: (t: number) => Vertex;
    start?: Vertex;
    end?: Vertex;
  }) {
    this.evaluate = at;
    const a = validateVertex(at(0)), b = validateVertex(at(1));
    this.start = validateVertex(start ?? a);
    this.end = validateVertex(end ?? b);
    for (const [actual, expected] of [[a, this.start], [b, this.end]]) {
      if (Array.from(actual.position).some((value, i) => Math.abs(value - expected.position[i]) > 1e-10 * Math.max(1, Math.abs(value), Math.abs(expected.position[i])))) {
        throw new RangeError('Curve endpoints must agree with its evaluator');
      }
    }
  }

  /** Local definition, when constructed with fromPlanarCurve. */
  get planarCurve(): PlanarCurve | undefined { return this.planar?.curve; }
  /** Frame of the planar definition; this does not make the curve a sketch plane. */
  get plane(): Plane | undefined { return this.planar?.plane; }

  /**
   * Lift any planar curve into world space without sampling it.
   *
   * @remarks
   * The placement frame is copied. Curves retain their evaluator; treat its
   * captured geometry as immutable. A plain object implementing at(t) is accepted.
   * @param options - Planar curve and placement plane; defaults to world XY.
   * @returns An exact curve with the same [0, 1] parameterization. Loops share
   * one endpoint vertex; open curves retain distinct endpoints.
   * @throws {@link TypeError} if curve has no at(t) evaluator.
   */
  static fromPlanarCurve({ curve, plane = new Plane(), start, end }: {
    curve: Pick<PlanarCurve, 'at'>;
    plane?: Plane;
    /** Optional shared world-space vertex at zero; must agree with the evaluator. */
    start?: Vertex;
    /** Optional shared world-space vertex at one; must agree with the evaluator. */
    end?: Vertex;
  }): SpatialCurve {
    if (typeof curve?.at !== 'function') throw new TypeError('A planar curve needs an at(t) evaluator');
    const definition = curve instanceof PlanarCurve ? curve : new PlanarCurve({ at: t => curve.at(t) });
    const frame = new Plane({ a: [...plane.origin] as [number, number, number],
      b: Array.from(plane.origin).map((value, i) => value + plane.xAxis[i]) as [number, number, number],
      c: Array.from(plane.origin).map((value, i) => value + plane.yAxis[i]) as [number, number, number] });
    const at = (t: number) => frame.toWorld(definition.at(t));
    const first = start ?? at(0);
    const spatial = new SpatialCurve({ at, start: first, end: end ?? (definition.isLoop() ? first : at(1)) });
    spatial.planar = { curve: definition, plane: frame };
    return spatial;
  }

  /**
   * Evaluate the analytic curve, returning shared endpoint objects at zero and one.
   * @param t - Normalized parameter in [0, 1], rather than an angle.
   * @throws {@link RangeError} if t is outside [0, 1] or the result is nonfinite.
   */
  at(t: number): Vertex {
    if (!Number.isFinite(t) || t < 0 || t > 1) throw new RangeError('Curve parameter must be in [0, 1]');
    return t === 0 ? this.start : t === 1 ? this.end : validateVertex(this.evaluate(t));
  }

  /** Test endpoint coordinate equality; no separate Loop class is required. */
  isLoop(): boolean { return Array.from(this.start.position).every((value, i) => value === this.end.position[i]); }

  /**
   * Choose normalized parameters for a polyline, including zero and one.
   * @param options - Optional positive chord-deviation resolution in model units.
   * @remarks
   * Lifted curves delegate to their planar definition; other curves use adaptive
   * evaluation. This is a parameter-selection utility; consumers use sample() for polylines.
   * @throws {@link RangeError} if resolution is invalid or subdivision cannot converge.
   */
  sampleParameters({ resolution = TRIANGULATION_RESOLUTION }: { resolution?: number } = {}): readonly number[] {
    return this.planar ? this.planar.curve.sampleParameters({ resolution }) : curveParameters(this, resolution);
  }

  /**
   * Sample a polyline at the library's 0.001 chord-deviation resolution.
   *
   * @remarks
   * Includes both endpoints, including the closing endpoint of a loop. Subdivision
   * defaults to sampleParameters(). Lifted curves delegate to their planar
   * definition's sample(), including overrides. Adaptive evaluators compare
   * curve and chord midpoints; arbitrary oscillations between probes cannot be
   * bounded without additional curvature information. An unresolved interval
   * throws instead of silently exceeding the subdivision limit.
   */
  sample(): Vertex[] {
    if (!this.planar) return this.sampleParameters().map(t => this.at(t));
    const { curve, plane } = this.planar;
    const points = curve.sample();
    return points.map((point, i) => i === 0 ? this.start : i === points.length - 1 ? this.end : plane.toWorld(point));
  }
}

/**
 * Create a parametric curve without tessellating it.
 *
 * Constructor shorthand for `new SpatialCurve(options)`; returns a new {@link SpatialCurve} instance.
 *
 * @param options - Exact evaluator and optional shared endpoint objects.
 * @throws {@link RangeError} if endpoint coordinates are nonfinite or disagree with the evaluator.
 */
export function spatialCurve(options: {
  /** World-space evaluator on [0, 1]; responsible for the curve's parameterization. */
  at: (t: number) => Vertex;
  /** Optional shared vertex at zero; must agree with the evaluator. */
  start?: Vertex;
  /** Optional shared vertex at one; use the start object for a closed loop. */
  end?: Vertex;
}): SpatialCurve { return new SpatialCurve(options); }
