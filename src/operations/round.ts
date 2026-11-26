import { Edge } from '../Edge.js';
import { Solid } from '../Solid.js';
import { Surface } from '../Surface.js';
import { roundCurves } from '../internal/roundCurves.js';
import { roundPlanes } from '../internal/roundPlanes.js';
import { RoundTopology } from '../internal/roundTopology.js';
import { validateSweepMesh } from '../internal/validateSweepMesh.js';
import { searchBoundaries, type BoundarySelector } from './searchBoundaries.js';
import { UnsupportedRoundError } from '../internal/roundUnsupported.js';
import { SurfaceGraph } from '../internal/surfaceGraph.js';
import { retainSolidMesh } from '../internal/solidMesh.js';

/**
 * Return a new solid with constant-radius tangent rounds on selected boundaries.
 * Accepts a solid directly for the default radius and all boundaries, or an options object.
 *
 * @param options.solid - Input solid; its geometry, children and cached mesh are unchanged.
 * @param options.radius - Positive rolling-ball radius in model units; defaults to 0.5.
 * @param options.boundaries - Mixed original boundary indices/objects, planar
 * faces of the solid, and predicates accepted by {@link searchBoundaries}, as one selector or a list.
 * Omitted or [] selects all. Matches are unique by identity.
 * @remarks
 * Rounds retain mathematical surfaces and shared exact contact curves. Three rounded
 * planar edges meet in a spherical corner. At the radius limit, consumed faces and
 * edges disappear: a cylinder can become a sphere, and a hollow cylinder a torus.
 * Opposing rims can also meet along part of their contact curves, sharing exact
 * boundaries and splitting the remaining planar face into disconnected patches.
 * Convex and concave edges between planar faces and smooth curved rims are supported.
 * Planar-edge rounds preserve unrelated curved surfaces and distant hole trims;
 * both kinds of round can be selected together on the same solid. The numerical
 * solver also handles regular curved corner supports. Interference with other trims throws.
 * Rims may combine tangent straight and curved sections, including pocket lips and floors.
 * Closed, noncollapsing rims on boolean-trimmed surface regions are supported,
 * including oblique planar cuts; source equations and unrelated trims are retained.
 * Unsupported analytic configurations retry the numerical surface-offset solver,
 * including open boundaries between planar/curved surfaces with planar end caps.
 * Planar strips intersect oblique end planes analytically. Two selected edges at
 * an equal-support-angle planar corner meet along a shared exact cylindrical
 * intersection. Isolated numerical strips may end on regular curved surfaces,
 * retaining the cap's native chart and sharing their closing curves.
 * Three selected boundaries on three regular supports can solve one common
 * tangent ball and share a spherical corner, including curved support surfaces.
 * Two selected strips meet along their exact intersection, including unequal
 * support angles; a remaining end portion intersects the adjoining support.
 * Mixed convex/concave three-edge junctions, higher-valence corners,
 * insufficient source charts and unresolved offset intersections still throw. Invalid geometry never
 * triggers an unconditional fallback.
 * @returns A new solid retaining the input child nodes in a fresh child array.
 * @throws {@link RangeError} for invalid radii/indices or unsupported, oversized or unresolved rounds.
 * @example
 * ```ts
 * const rounded = round({ solid: part, radius: 0.5, boundaries: [0] });
 * scene.add(rounded);
 * ```
 */
export function round(options: Solid | {
  /** Solid to round; never modified. */
  solid: Solid;
  /** Positive radius in model units; defaults to 0.5. */
  radius?: number;
  /** One selector or a mixed list resolved by searchBoundaries; omitted or [] means all. */
  boundaries?: BoundarySelector | readonly BoundarySelector[];
}): Solid {
  const { solid, radius = 0.5, boundaries = [] } = options instanceof Solid ? { solid: options } : options;
  if (!(solid instanceof Solid)) throw new TypeError('Round requires a Solid');
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Round radius must be finite and positive');
  const selected = searchBoundaries({ solid, boundaries });
  new SurfaceGraph(solid.surfaces).validate('Round');
  if (!selected.length) return new Solid({ surfaces: solid.surfaces }).add(solid.children);
  let topology = new RoundTopology(radius, solid.vertices);
  const straight = selected.filter(boundary => boundary instanceof Edge);
  let surfaces: Surface[];
  try {
    surfaces = roundCurves(roundPlanes(solid, straight, radius, topology), selected.filter(boundary => !(boundary instanceof Edge)), radius, topology);
  } catch (error) {
    if (!(error instanceof UnsupportedRoundError)) throw error;
    // Retry source topology, never the partially constructed analytic result.
    topology = new RoundTopology(radius, solid.vertices);
    try { surfaces = roundCurves(solid.surfaces, selected, radius, topology); }
    catch (fallbackError) {
      if (fallbackError instanceof UnsupportedRoundError) throw new UnsupportedRoundError(`${error.message}. ${fallbackError.message}`, { cause: fallbackError });
      throw fallbackError;
    }
  }
  const result = new Solid({ surfaces });
  new SurfaceGraph(surfaces).validate('Round result');
  try {
    const positions = Surface.triangulateAll(surfaces);
    validateSweepMesh(positions); retainSolidMesh(result, positions);
  }
  catch (cause) { throw new RangeError(`Round validation failed: ${cause instanceof Error ? cause.message.replaceAll('Sweep', 'Solid') : cause}`, { cause }); }
  return result.add(solid.children);
}
