import type { PlanarCurve } from '../PlanarCurve.js';
import type { Plane } from '../Plane.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { Vertex } from '../Vertex.js';

/**
 * Lift any planar curve into world space without sampling it.
 *
 * Shorthand for {@link SpatialCurve.fromPlanarCurve}. The placement frame is
 * copied; the curve retains its evaluator and sampling overrides. Treat captured
 * geometry as immutable. Plain objects implementing at(t) are also accepted.
 * @param options.curve - Planar curve with a normalized [0, 1] evaluator.
 * @param options.plane - Placement plane; defaults to world XY.
 * @param options.start - Optional shared world-space vertex at zero.
 * @param options.end - Optional shared world-space vertex at one.
 * @returns An exact spatial curve with the same parameterization. Loops share
 * one endpoint vertex unless explicit endpoints are supplied.
 * @throws {@link TypeError} if the curve has no at(t) evaluator.
 * @throws {@link RangeError} if endpoints are nonfinite or disagree with the evaluator.
 * @example
 * ```ts
 * const path = spatialCurveFromPlanar({
 *   curve: circle({ center: { x: 0, y: 0 }, radius: 10 }),
 *   plane: ZX,
 * });
 * ```
 */
export function spatialCurveFromPlanar(options: {
  /** Planar curve or an object implementing at(t) on [0, 1]. */
  curve: Pick<PlanarCurve, 'at'>;
  /** Placement plane; defaults to world XY. The frame is copied. */
  plane?: Plane;
  /** Shared world-space vertex at zero; must agree with the evaluator. */
  start?: Vertex;
  /** Shared world-space vertex at one; must agree with the evaluator. */
  end?: Vertex;
}): SpatialCurve { return SpatialCurve.fromPlanarCurve(options); }
