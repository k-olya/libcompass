import { Circle } from './Circle.js';
import { Plane } from './Plane.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { validateVertex, type Vertex } from './Vertex.js';
import { curveParameters } from './util/curveSampling.js';

/**
 * A mathematically evaluated world-space curve with a normalized [0, 1] parameter.
 *
 * @remarks
 * The evaluator defines the parameterization; it need not have constant speed.
 * Circular curves made with fromCircle traverse a fraction of the circumference.
 * Geometry is retained analytically; sample() alone produces a polyline.
 */
export class SpatialCurve implements SpatialBoundary {
  readonly start: Vertex;
  readonly end: Vertex;
  private readonly evaluate: (t: number) => Vertex;
  private circular?: { circle: Circle; plane: Plane };

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

  /** Circular definition, when constructed with fromCircle; absent for procedural curves. */
  get circle(): Circle | undefined { return this.circular?.circle; }
  /** Frame of the circular definition; this does not make the curve a sketch plane. */
  get plane(): Plane | undefined { return this.circular?.plane; }

  /**
   * Lift an analytic circle into world space, preserving its exact radius.
   *
   * @param options - Circle and placement plane; defaults to world XY.
   * @returns A closed curve whose endpoints are the same vertex object.
   */
  static fromCircle({ circle, plane = new Plane() }: { circle: Circle; plane?: Plane }): SpatialCurve {
    const definition = new Circle({ center: { ...circle.center }, radius: circle.radius });
    const frame = new Plane({ a: [...plane.origin] as [number, number, number],
      b: Array.from(plane.origin).map((value, i) => value + plane.xAxis[i]) as [number, number, number],
      c: Array.from(plane.origin).map((value, i) => value + plane.yAxis[i]) as [number, number, number] });
    const at = (t: number) => frame.toWorld(definition.at((t === 1 ? 0 : t) * 2 * Math.PI));
    const start = at(0);
    const curve = new SpatialCurve({ at, start, end: start });
    curve.circular = { circle: definition, plane: frame };
    return curve;
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
   * Sample a polyline at the library's 0.001 chord-deviation resolution.
   *
   * @remarks
   * Includes both endpoints, including the closing endpoint of a loop. Circular
   * subdivision is computed from radius. Procedural evaluators are adaptively
   * checked at quarter points; arbitrary oscillations between probes cannot be
   * bounded without additional curvature information. An unresolved interval
   * throws instead of silently exceeding the subdivision limit.
   */
  sample(): Vertex[] { return curveParameters(this).map(t => this.at(t)); }
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
