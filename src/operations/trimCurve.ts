import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Line } from '../Line.js';
import { LineSegment } from '../LineSegment.js';
import { Plane } from '../Plane.js';
import { PlanarCurve } from '../PlanarCurve.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { Point } from '../Point.js';
import type { Vertex } from '../Vertex.js';
import { planarIntersections, scalarIntersections, uniqueParameters, type PlanarBoundary } from '../internal/curveIntersections.js';
import { slicePlanarCurve, sliceSpatialCurve } from '../internal/curveTrimming.js';

/**
 * Trim a curve at cutting geometry, retaining the piece containing keep.
 * @param options.curve - A planar curve/segment or spatial curve/edge; never mutated.
 * @param options.cutters - Planar curves, segments or infinite lines for a planar input;
 * world-space planes for a spatial input. Planes can also cut planar inputs on XY.
 * @param options.keep - Parameter on the original curve in [0, 1] identifying the retained piece.
 * Must not lie on a cut. A loop's retained piece can cross its parameter seam.
 * @returns An exact curve reparameterized to [0, 1]; straight inputs remain straight.
 * @remarks Samples locate intersections, then the original equations refine them.
 * Source sampling overrides remain authoritative. Unseen oscillations between
 * supplied samples cannot be certified. A missed cutter leaves a fresh copy of
 * the entire curve; coincident geometry or unresolved intersections throw.
 * @throws {@link RangeError} for invalid keep, empty cutters, ambiguous cuts or unresolved intersections.
 * @example
 * ```ts
 * const arc = trimCurve({ curve: circle({ center: { x: 0, y: 0 }, radius: 5 }),
 *   cutters: [line({ point: { x: 0, y: 0 }, direction: [0, 1] })], keep: 0 });
 * ```
 */
export function trimCurve<C extends PlanarCurve | LineSegment | SpatialCurve | Edge>({ curve, cutters, keep }: {
  /** Input curve, retained without mutation. */
  curve: C;
  /** Cutting curves/lines in local XY, or world-space cutting planes. */
  cutters: readonly (PlanarCurve | LineSegment | Line | Plane)[];
  /** Original normalized parameter identifying the piece to retain. */
  keep: number;
}): C extends PlanarCurve ? PlanarCurve : C extends LineSegment ? LineSegment : C extends Edge ? Edge : SpatialCurve {
  if (!(curve instanceof PlanarCurve || curve instanceof LineSegment || curve instanceof SpatialCurve || curve instanceof Edge)) throw new TypeError('Trim requires a bounded curve');
  if (!Number.isFinite(keep) || keep < 0 || keep > 1) throw new RangeError('Trim keep must be a parameter in [0, 1]');
  if (!Array.isArray(cutters) || !cutters.length) throw new RangeError('Trim requires at least one cutter');
  const planar = curve instanceof PlanarCurve || curve instanceof LineSegment;
  const cuts = uniqueParameters(cutters.flatMap(cutter => {
    if (cutter instanceof Plane) {
      const samples: { t: number; point: Point | Vertex }[] = 'sampleWithParameters' in curve ? curve.sampleWithParameters()
        : [{ t: 0, point: curve.start }, { t: 1, point: curve.end }];
      return scalarIntersections<Point | Vertex>({ at: t => curve.at(t), sample: () => samples.map(sample => sample.point) }, point => {
        const position = 'position' in point ? point.position : [point.x, point.y, 0] as const;
        return vec3.dot(vec3.subtract([0, 0, 0], position, cutter.origin), cutter.normal);
      }, samples);
    }
    if (!planar || !(cutter instanceof PlanarCurve || cutter instanceof LineSegment || cutter instanceof Line)) throw new TypeError('Spatial curve trimming requires cutting planes');
    return planarIntersections(curve as PlanarBoundary, cutter).map(hit => hit.a);
  }));
  if (cuts.some(t => Math.abs(t - keep) < 1e-9 || (keep === 1 && t === 0))) throw new RangeError('Trim keep lies on a cut');
  const loop = 'isLoop' in curve && curve.isLoop();
  const before = cuts.filter(t => t < keep), after = cuts.filter(t => t > keep);
  let start = before.at(-1) ?? 0, end = after[0] ?? 1;
  if (loop && cuts.length) {
    start = before.at(-1) ?? cuts.at(-1)! - 1;
    end = after[0] ?? cuts[0] + 1;
    if (start < 0) { start++; end++; }
    if (end - start <= 1e-9) throw new RangeError('Trim does not retain a nonzero curve interval');
  }
  const result = planar ? slicePlanarCurve(curve as PlanarBoundary, start, end) : sliceSpatialCurve(curve as SpatialCurve | Edge, start, end);
  // The conditional return preserves the dimensionality and straightness of the input.
  return result as C extends PlanarCurve ? PlanarCurve : C extends LineSegment ? LineSegment : C extends Edge ? Edge : SpatialCurve;
}
