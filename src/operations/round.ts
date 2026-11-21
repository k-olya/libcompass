import { Edge } from '../Edge.js';
import { Solid } from '../Solid.js';
import { Surface } from '../Surface.js';
import { roundCurves } from '../internal/roundCurves.js';
import { roundPlanes } from '../internal/roundPlanes.js';
import { RoundTopology } from '../internal/roundTopology.js';
import { validateSweepMesh } from '../internal/validateSweepMesh.js';

/**
 * Return a new solid with constant-radius tangent rounds on selected boundaries.
 * @param options.solid - Input solid; its geometry, children and cached mesh are unchanged.
 * @param options.radius - Positive rolling-ball radius in model units; defaults to 0.5.
 * @param options.boundaries - Original solid.boundaries indices; omitted or [] selects all.
 * @remarks
 * Rounds retain mathematical surfaces and shared exact contact curves. Three rounded
 * planar edges meet in a spherical corner. At the radius limit, consumed faces and
 * edges disappear: a cylinder can become a sphere, and a hollow cylinder a torus.
 * Convex planar edges and smooth closed curved rims are supported. Open curved corners,
 * nonconvex edges, two-edge corner junctions and unresolved offset intersections throw.
 * @returns A new solid retaining the input child nodes in a fresh child array.
 * @throws {@link RangeError} for invalid radii/indices or unsupported, oversized or unresolved rounds.
 * @example
 * ```ts
 * const rounded = round({ solid: part, radius: 0.5, boundaries: [0] });
 * scene.add(rounded);
 * ```
 */
export function round({ solid, radius = 0.5, boundaries = [] }: {
  /** Solid to round; never modified. */
  solid: Solid;
  /** Positive radius in model units; defaults to 0.5. */
  radius?: number;
  /** Input boundary indices; omitted or empty selects every boundary. */
  boundaries?: readonly number[];
}): Solid {
  if (!(solid instanceof Solid)) throw new TypeError('Round requires a Solid');
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Round radius must be finite and positive');
  if (!Array.isArray(boundaries) || boundaries.some(index => !Number.isInteger(index) || index < 0 || index >= solid.boundaries.length)) {
    throw new RangeError('Round boundaries must be valid indices in solid.boundaries');
  }
  for (const boundary of solid.boundaries) if (solid.surfaces.filter(surface => surface.boundaries.includes(boundary)).length !== 2) {
    throw new RangeError('Round requires a closed manifold solid with two surfaces per boundary');
  }
  const selected = (boundaries.length ? [...new Set(boundaries)] : solid.boundaries.map((_, index) => index)).map(index => solid.boundaries[index]);
  if (!selected.length) return new Solid({ surfaces: solid.surfaces }).add(solid.children);
  const topology = new RoundTopology(radius), straight = selected.filter(boundary => boundary instanceof Edge);
  const surfaces = roundCurves(roundPlanes(solid, straight, radius, topology), selected.filter(boundary => !(boundary instanceof Edge)), radius, topology);
  const result = new Solid({ surfaces });
  for (const boundary of result.boundaries) if (surfaces.filter(surface => surface.boundaries.includes(boundary)).length !== 2) {
    throw new RangeError('Round contact trims could not be sewn into shared manifold topology');
  }
  try { validateSweepMesh(Surface.triangulateAll(surfaces)); }
  catch (cause) { throw new RangeError(`Round validation failed: ${cause instanceof Error ? cause.message.replaceAll('Sweep', 'Solid') : cause}`, { cause }); }
  return result.add(solid.children);
}
