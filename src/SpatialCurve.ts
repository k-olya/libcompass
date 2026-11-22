import type { SpatialLine } from './SpatialLine.js';
import { rotate } from './operations/rotate.js';
import { displace } from './operations/displace.js';
import { rememberSample, sampleParameter, parameterizedSamples } from './internal/curveSamples.js';
import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Plane } from './Plane.js';
import { PlanarCurve } from './PlanarCurve.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { validateVertex, type Vertex } from './Vertex.js';
import { curveParameters } from './internal/curveSampling.js';
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
  private readonly evaluateTangent?: (t: number) => ReadonlyVec3;
  private planar?: { curve: PlanarCurve; plane: Plane };

  /**
   * Create a parametric curve without tessellating it.
   *
   * Accepts the evaluator function directly, or an options object for tangent and endpoint settings.
   *
   * @param options - Exact evaluator, optional tangent evaluator, and shared endpoint objects.
   * @throws {@link RangeError} if endpoint coordinates are nonfinite or disagree with the evaluator.
   */
  constructor(options: ((t: number) => Vertex) | {
    at: (t: number) => Vertex;
    tangent?: (t: number) => ReadonlyVec3;
    start?: Vertex;
    end?: Vertex;
  }) {
    const { at, tangent, start, end } = typeof options === 'function' ? { at: options } : options;
    this.evaluate = at;
    this.evaluateTangent = tangent;
    const a = validateVertex(at(0)), b = validateVertex(at(1));
    this.start = validateVertex(start ?? a);
    this.end = validateVertex(end ?? b);
    for (const [actual, expected] of [[a, this.start], [b, this.end]]) {
      if (Array.from(actual.position).some((value, i) => Math.abs(value - expected.position[i]) > 1e-10 * Math.max(1, Math.abs(value), Math.abs(expected.position[i])))) {
        throw new RangeError('Curve endpoints must agree with its evaluator');
      }
    }
  }

  /**
   * Return a new rotated spatial curve; leave this object unchanged.
   * @param options.axis - Spatial line defining the rotation origin and direction.
   * @param options.angle - Signed right-hand rotation in degrees.
   * @see {@link rotate}
   */
  rotate(options: {
    /** Rotation axis, including its origin. */
    axis: SpatialLine;
    /** Signed rotation in degrees. */
    angle: number;
  }): this { return rotate({ ...options, object: this }); }

  /**
   * Return a new displaced spatial curve; leave this object unchanged.
   *
   * Accepts a displacement vector directly, or an options object containing vector.
   *
   * @param options.vector - XYZ displacement in model units, without normalization.
   * @see {@link displace}
   */
  displace(options: ReadonlyVec3 | {
    /** Finite XYZ displacement in model units. */
    vector: ReadonlyVec3;
  }): this { return displace({ object: this, vector: 'vector' in options ? options.vector : options }); }

  /** Local definition, when constructed with fromPlanarCurve. */
  get planarCurve(): PlanarCurve | undefined { return this.planar?.curve; }
  /** Frame of the planar definition; this does not make the curve a sketch plane. */
  get plane(): Plane | undefined { return this.planar?.plane; }

  /**
   * Lift any planar curve into world space without sampling it.
   *
   * Accepts a planar curve directly, or an options object for placement and shared endpoints.
   *
   * @remarks
   * The placement frame is copied. Curves retain their evaluator; treat its
   * captured geometry as immutable. A plain object implementing at(t) is accepted.
   * Planar tangent evaluators and sampling overrides are lifted through the frame.
   * @param options - Planar curve and placement plane; defaults to world XY.
   * @returns An exact curve with the same [0, 1] parameterization. Loops share
   * one endpoint vertex; open curves retain distinct endpoints.
   * @throws {@link TypeError} if curve has no at(t) evaluator.
   */
  static fromPlanarCurve(options: Pick<PlanarCurve, 'at'> | {
    curve: Pick<PlanarCurve, 'at'>;
    plane?: Plane;
    /** Optional shared world-space vertex at zero; must agree with the evaluator. */
    start?: Vertex;
    /** Optional shared world-space vertex at one; must agree with the evaluator. */
    end?: Vertex;
  }): SpatialCurve {
    const { curve, plane = new Plane(), start, end } = 'curve' in options ? options : { curve: options };
    if (typeof curve?.at !== 'function') throw new TypeError('A planar curve needs an at(t) evaluator');
    const definition = curve instanceof PlanarCurve ? curve : new PlanarCurve({ at: t => curve.at(t) });
    const frame = new Plane({ a: [...plane.origin] as [number, number, number],
      b: Array.from(plane.origin).map((value, i) => value + plane.xAxis[i]) as [number, number, number],
      c: Array.from(plane.origin).map((value, i) => value + plane.yAxis[i]) as [number, number, number] });
    const at = (t: number) => frame.toWorld(definition.at(t));
    const first = start ?? at(0);
    const spatial = new SpatialCurve({ at, start: first, end: end ?? (definition.isLoop() ? first : at(1)),
      tangent: t => {
        const tangent = definition.tangent(t);
        return vec3.scaleAndAdd([0, 0, 0], vec3.scale([0, 0, 0], frame.xAxis, tangent[0]), frame.yAxis, tangent[1]);
      },
    });
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
    return rememberSample(this, t === 0 ? this.start : t === 1 ? this.end : validateVertex(this.evaluate(t)), t);
  }

  /**
   * Unit tangent toward increasing t; defaults to finite differences of at().
   * @param t - Normalized parameter in [0, 1].
   * @throws {@link RangeError} if the tangent is zero or nonfinite.
   */
  tangent(t: number): ReadonlyVec3 {
    this.at(t);
    let direction = this.evaluateTangent?.(t);
    if (!direction) {
      const h = 1e-4;
      const at = (u: number) => this.at(this.isLoop() ? (u % 1 + 1) % 1 : u).position;
      if (this.isLoop() || (t >= 2 * h && t <= 1 - 2 * h)) {
        const a = at(t - 2 * h), b = at(t - h), c = at(t + h), d = at(t + 2 * h);
        direction = [0, 1, 2].map(i => 8 * (c[i] - b[i]) - (d[i] - a[i])) as [number, number, number];
      } else {
        const sign = t < 0.5 ? 1 : -1;
        const a = at(t), b = at(t + sign * h), c = at(t + sign * 2 * h);
        direction = [0, 1, 2].map(i => sign * (4 * (b[i] - a[i]) - (c[i] - a[i]))) as [number, number, number];
      }
    }
    const scale = Math.max(...Array.from(direction, Math.abs));
    if (!Number.isFinite(scale) || scale === 0) throw new RangeError('A curve tangent must be finite and nonzero');
    return vec3.normalize([0, 0, 0], Array.from(direction, x => x / scale) as [number, number, number]);
  }

  /**
   * Sample through sample(), preserving each point's normalized parameter.
   * @remarks Sampling overrides must return points obtained from this.at(t).
   * @throws {@link RangeError} if sample parameters are unavailable or unordered.
   */
  sampleWithParameters(options: { resolution?: number } = {}): { t: number; point: Vertex }[] { return parameterizedSamples(this, options); }

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
   * Sample a polyline at the library's configured chord-deviation resolution.
   * @param options - Optional positive resolution; sweeps may request finer source samples.
   *
   * @remarks
   * Includes both endpoints, including the closing endpoint of a loop. Subdivision
   * defaults to sampleParameters(). Lifted curves delegate to their planar
   * definition's sample(), including overrides. Adaptive evaluators compare
   * curve and chord midpoints; arbitrary oscillations between probes cannot be
   * bounded without additional curvature information. An unresolved interval
   * throws instead of silently exceeding the subdivision limit.
   */
  sample({ resolution = TRIANGULATION_RESOLUTION }: { resolution?: number } = {}): Vertex[] {
    if (!this.planar) return this.sampleParameters({ resolution }).map(t => this.at(t));
    const { curve, plane } = this.planar;
    const points = curve.sample({ resolution });
    return points.map((point, i) => {
      const vertex = i === 0 ? this.start : i === points.length - 1 ? this.end : plane.toWorld(point);
      const t = sampleParameter(curve, point, i, points.length);
      return t === undefined ? vertex : rememberSample(this, vertex, t);
    });
  }
}

/**
 * Create a parametric curve without tessellating it.
 *
 * Accepts the evaluator function directly, or an options object for tangent and endpoint settings.
 *
 * Constructor shorthand for `new SpatialCurve(options)`; returns a new {@link SpatialCurve} instance.
 *
 * @param options - Exact evaluator, optional tangent evaluator, and shared endpoint objects.
 * @throws {@link RangeError} if endpoint coordinates are nonfinite or disagree with the evaluator.
 */
export function spatialCurve(options: ((t: number) => Vertex) | {
  /** Optional exact tangent evaluator; otherwise finite differences are used. */
  tangent?: (t: number) => ReadonlyVec3;
  /** World-space evaluator on [0, 1]; responsible for the curve's parameterization. */
  at: (t: number) => Vertex;
  /** Optional shared vertex at zero; must agree with the evaluator. */
  start?: Vertex;
  /** Optional shared vertex at one; use the start object for a closed loop. */
  end?: Vertex;
}): SpatialCurve { return new SpatialCurve(options); }
