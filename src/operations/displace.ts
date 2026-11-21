import { mat4, type ReadonlyVec3 } from 'gl-matrix';
import type { SpatialObject } from '../SpatialObject.js';
import { validateVertex } from '../Vertex.js';
import { rigidTransform } from '../internal/rigidTransform.js';

/**
 * Translate world-space geometry by a vector, returning a new object.
 * @param options.object - Plane, spatial curve/line, edge, surface, or solid; never mutated.
 * @param options.vector - XYZ displacement in model units; used as-is, without normalization.
 * @returns New geometry of the same built-in kind, retaining mathematical evaluators,
 * shared topology, trim charts, and sampling overrides. Solid children are retained
 * under new lazy transform nodes; source child nodes and caches are unchanged.
 * @remarks Treat captured source geometry as immutable. Translation does not tessellate surfaces.
 * A SpatialLine's origin moves and its direction stays unchanged.
 * @throws {@link TypeError} for unsupported geometry.
 * @throws {@link RangeError} for nonfinite displacement coordinates.
 * @example
 * ```ts
 * const moved = displace({ object: part, vector: [10, 0, 0] });
 * ```
 */
export function displace<T extends SpatialObject>({ object, vector }: {
  /** Source world-space geometry; never modified. */
  object: T;
  /** Finite XYZ displacement in model units; copied without normalization. */
  vector: ReadonlyVec3;
}): T {
  validateVertex({ position: vector });
  return rigidTransform(object, mat4.fromTranslation([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], vector));
}
