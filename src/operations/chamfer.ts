import { Edge } from '../Edge.js';
import { Solid } from '../Solid.js';
import { chamferCurves } from '../internal/chamferCurves.js';
import { chamferPlanes, clipChamferPlanes } from '../internal/chamferPlanes.js';
import { validateSweepMesh } from '../internal/validateSweepMesh.js';
import { Surface } from '../Surface.js';
import { degtorad } from '../util/angles.js';
import { searchBoundaries, type BoundarySelector } from './searchBoundaries.js';

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
 * Convex straight edges between planar faces use analytic clipping planes.
 * Bevels meeting at planar corners are intersected together. Open curved corners,
 * concave straight corners, overlapping trims, and unresolved surface intersections
 * currently throw rather than returning invalid geometry. Existing surfaces,
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
  for (const boundary of solid.boundaries) {
    if (solid.surfaces.filter(surface => surface.boundaries.includes(boundary)).length !== 2) {
      throw new RangeError('Chamfer requires a closed manifold solid with two surfaces per boundary');
    }
  }
  if (!selected.length) return new Solid({ surfaces: solid.surfaces }).add(...solid.children);
  const angleRAD = degtorad(angleDEG);
  const straight = selected.filter(boundary => boundary instanceof Edge);
  const cuts = chamferPlanes(solid, straight, length, angleRAD);
  const curved = selected.filter(boundary => !(boundary instanceof Edge));
  const surfaces = clipChamferPlanes(chamferCurves(solid.surfaces, curved, length, angleRAD), cuts, length);
  const result = new Solid({ surfaces });
  for (const boundary of result.boundaries) if (surfaces.filter(surface => surface.boundaries.includes(boundary)).length !== 2) {
    throw new RangeError('Chamfer trim intersections did not produce shared manifold topology');
  }
  try { validateSweepMesh(Surface.triangulateAll(surfaces)); }
  catch (cause) { throw new RangeError(`Chamfer validation failed: ${cause instanceof Error ? cause.message.replaceAll('Sweep', 'Solid') : cause}`, { cause }); }
  return result.add(...solid.children);
}
