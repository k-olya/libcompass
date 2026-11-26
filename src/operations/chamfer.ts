import { Edge } from '../Edge.js';
import { Solid } from '../Solid.js';
import { Face } from '../Face.js';
import { chamferCurves } from '../internal/chamferCurves.js';
import { chamferPlanar } from '../internal/chamferPlanes.js';
import { validateSweepMesh } from '../internal/validateSweepMesh.js';
import { Surface } from '../Surface.js';
import { degtorad } from '../util/angles.js';
import { searchBoundaries, type BoundarySelector } from './searchBoundaries.js';
import { SurfaceGraph } from '../internal/surfaceGraph.js';
import { retainSolidMesh } from '../internal/solidMesh.js';

/**
 * Return a new solid with bevels on selected boundaries, without mutating the input.
 *
 * Accepts a solid directly for default chamfer settings, or an options object.
 *
 * @param options - Input solid, setback length, angle, and boundary selectors.
 * @param options.solid - Solid whose own surfaces are chamfered; child nodes are retained unchanged.
 * @param options.length - Positive setback distance on the first adjoining surface
 * in solid.surfaces order; defaults to 0.5. On curved surfaces this is a chord distance.
 * @param options.angle - Angle in degrees from that surface, into material for a convex
 * rim or into the adjoining void for a concave rim;
 * strictly between 0 and 90, default 45.
 * @param options.boundaries - Mixed original boundary indices/objects, planar
 * faces of the solid, and predicates accepted by {@link searchBoundaries}, as one selector or a list.
 * Omit or pass [] to chamfer all boundaries. Matches are unique by identity.
 * @remarks
 * Smooth closed rims retain their evaluators and trim the adjoining surface charts,
 * including rims combining tangent straight and curved sections. Convex bevels
 * remove material; concave bevels add it at corners such as pocket floors.
 * Closed rims on boolean-trimmed surface regions retain the original surface
 * equations and all unrelated trims, including oblique planar cut rims.
 * Straight planar bevels use local plane arrangements, including concave edges;
 * unrelated components and remote surfaces are preserved. Open curved strips
 * intersect planar or curved end surfaces and share exact closing boundaries.
 * Connected strips meet along shared exact intersections. Three bevels at a
 * regular three-support corner meet at one shared point; two-strip junctions
 * trim any remaining end portion against its adjoining support.
 * At the setback limit, consumed walls disappear and the bevel shares the
 * unchanged opposite boundary. Setbacks beyond convergence still throw.
 * Mixed corner arrangements, overlapping trims, and unresolved surface intersections
 * throw rather than returning invalid geometry. Existing surfaces,
 * topology, coordinates, child lists, and memoized triangulations are unchanged.
 * @throws {@link RangeError} for invalid parameters or indices, nonmanifold input,
 * oversized bevels, or unsupported/unresolved trim intersections.
 * @example
 * ```ts
 * const beveled = chamfer({ solid: part, length: 0.5, angle: 45, boundaries: [0] });
 * scene.add(beveled);
 * ```
 */
export function chamfer(options: Solid | {
  /** Input solid; never mutated. Child nodes are retained unchanged. */
  solid: Solid;
  /** Positive setback on the first adjoining surface; defaults to 0.5. */
  length?: number;
  /** Angle from that surface in degrees, into material/void for convex/concave rims; defaults to 45. */
  angle?: number;
  /** One selector or a mixed list resolved by searchBoundaries; omitted or [] means all. */
  boundaries?: BoundarySelector | readonly BoundarySelector[];
}): Solid {
  const { solid, length = 0.5, angle: angleDEG = 45, boundaries = [] } = options instanceof Solid ? { solid: options } : options;
  if (!(solid instanceof Solid)) throw new TypeError('Chamfer requires a Solid');
  if (!Number.isFinite(length) || length <= 0) throw new RangeError('Chamfer length must be finite and positive');
  if (!Number.isFinite(angleDEG) || angleDEG <= 0 || angleDEG >= 90) throw new RangeError('Chamfer angle must be between 0 and 90 degrees');
  const selected = searchBoundaries({ solid, boundaries });
  const graph = new SurfaceGraph(solid.surfaces);
  graph.validate('Chamfer');
  if (!selected.length) return new Solid({ surfaces: solid.surfaces }).add(solid.children);
  const angleRAD = degtorad(angleDEG);
  const straight = selected.filter((boundary): boundary is Edge => boundary instanceof Edge
    && [boundary.start, boundary.end].every(vertex => graph.atVertex(vertex).length === 3
      && graph.atVertex(vertex).every(surface => surface instanceof Face
        && surface.boundaries.filter(edge => edge.start === vertex || edge.end === vertex).every(edge => edge instanceof Edge))));
  const curved = selected.filter(boundary => !(boundary instanceof Edge && straight.includes(boundary)));
  const surfaces = chamferCurves(chamferPlanar(solid, straight, length, angleRAD), curved, length, angleRAD);
  const result = new Solid({ surfaces });
  new SurfaceGraph(surfaces).validate('Chamfer result');
  try {
    const positions = Surface.triangulateAll(surfaces);
    validateSweepMesh(positions); retainSolidMesh(result, positions);
  }
  catch (cause) { throw new RangeError(`Chamfer validation failed: ${cause instanceof Error ? cause.message.replaceAll('Sweep', 'Solid') : cause}`, { cause }); }
  return result.add(solid.children);
}
