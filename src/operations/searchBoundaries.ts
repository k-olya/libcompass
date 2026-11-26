import { Face } from '../Face.js';
import { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';

/** Test each adjoining planar face (or once without a face); any truthy result selects the boundary. */
export type BoundaryPredicate = (options: {
  /** Solid whose own topology is searched; child nodes are excluded. */
  solid: Solid;
  /** Adjoining planar face; undefined if the boundary adjoins only curved surfaces. */
  face: Face | undefined;
  /** Original shared boundary object. */
  boundary: SpatialBoundary;
}) => unknown;

/** An original boundary index/object, a planar face of the solid, or a predicate. */
export type BoundarySelector = number | SpatialBoundary | Face | BoundaryPredicate;

/**
 * Find unique original boundaries using mixed topology selectors.
 * Accepts a solid directly to select all boundaries, or an options object with selectors.
 *
 * @param options.solid - Solid whose own boundaries and planar faces are searched.
 * @param options.boundaries - Boundary indices, boundary objects, planar Face
 * objects, and predicates, as one selector or a mixed list. Omitted or [] selects all boundaries. Face selectors
 * include outer and hole boundaries. Objects must belong to the input solid.
 * @remarks
 * Each predicate is called for every boundary with each adjoining planar Face.
 * A match on any face includes the boundary. If there is no adjoining planar
 * face, it is called once with face: undefined, including curved-only joins.
 * All predicates run even when another selector already includes the boundary.
 * Predicate results use ordinary JavaScript truthiness, as in an if condition.
 * @returns Original boundary objects, deduplicated by identity in first-match
 * order. A nonempty selection with no matches returns an empty array.
 * @throws {@link TypeError} if solid is invalid.
 * @throws {@link RangeError} if a selector, index, or topology object is invalid.
 * Predicate exceptions propagate unchanged; the helper does not modify geometry.
 * @example
 * ```ts
 * const cap = part.surfaces.find(surface => surface instanceof Face)!;
 * const rims = searchBoundaries({ solid: part, boundaries: [
 *   0, part.boundaries[0], cap,
 *   ({ face }) => face !== undefined && face.plane.normal[2] > 0.9,
 * ] });
 * const rounded = part.round({ radius: 0.5, boundaries: rims });
 * ```
 */
export function searchBoundaries(options: Solid | {
  /** Input solid; never modified. */
  solid: Solid;
  /** One selector or a mixed list; omitted or [] means all boundaries. */
  boundaries?: BoundarySelector | readonly BoundarySelector[];
}): SpatialBoundary[] {
  const { solid, boundaries = [] } = options instanceof Solid ? { solid: options } : options;
  if (!(solid instanceof Solid)) throw new TypeError('Boundary search requires a Solid');
  const selectors: readonly BoundarySelector[] = Array.isArray(boundaries) ? boundaries : [boundaries as BoundarySelector];
  if (!selectors.length) return [...solid.boundaries];
  const available = new Set(solid.boundaries), selected = new Set<SpatialBoundary>();
  const adjoining = new Map<SpatialBoundary, Set<Face>>();
  for (const face of solid.surfaces) if (face instanceof Face) for (const boundary of face.boundaries) {
    if (!adjoining.has(boundary)) adjoining.set(boundary, new Set());
    adjoining.get(boundary)!.add(face);
  }
  for (const selector of selectors) {
    if (typeof selector === 'number') {
      if (!Number.isInteger(selector) || selector < 0 || selector >= solid.boundaries.length) {
        throw new RangeError('Boundary indices must be valid indices in solid.boundaries');
      }
      selected.add(solid.boundaries[selector]);
    } else if (typeof selector === 'function') {
      for (const boundary of solid.boundaries) {
        for (const face of adjoining.get(boundary) ?? [undefined]) {
          const match = selector({ solid, face, boundary });
          if (match) selected.add(boundary);
        }
      }
    } else if (selector instanceof Face) {
      if (!solid.surfaces.includes(selector)) throw new RangeError('Selected faces must belong to solid.surfaces');
      for (const boundary of selector.boundaries) selected.add(boundary);
    } else if (available.has(selector)) {
      selected.add(selector);
    } else {
      throw new RangeError('Boundary selectors must be indices, boundaries or planar faces of the solid, or predicates');
    }
  }
  return [...selected];
}
