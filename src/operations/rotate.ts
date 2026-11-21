import { mat4, vec3 } from 'gl-matrix';
import { SpatialLine } from '../SpatialLine.js';
import type { SpatialObject } from '../SpatialObject.js';
import { validateVertex } from '../Vertex.js';
import { degtorad } from '../util/angles.js';
import { rigidTransform } from '../internal/rigidTransform.js';

/**
 * Rotate world-space geometry around an infinite spatial line, returning a new object.
 * @param options.object - Plane, spatial curve/line, edge, surface, or solid; never mutated.
 * @param options.axis - Rotation axis, including its world-space origin. Direction is normalized internally.
 * @param options.angle - Signed right-hand rotation in degrees about the axis direction.
 * @returns New geometry of the same built-in kind, retaining mathematical evaluators,
 * shared topology, trim charts, and sampling overrides. Solid children are retained
 * under new lazy transform nodes; source child nodes and caches are unchanged.
 * @remarks Treat captured source geometry as immutable. Rotation does not tessellate surfaces.
 * @throws {@link TypeError} for an unsupported object or an axis that is not a SpatialLine.
 * @throws {@link RangeError} for nonfinite coordinates/angle or a zero axis direction.
 * @example
 * ```ts
 * const turned = rotate({ object: part, axis: Z, angle: 45 });
 * ```
 */
export function rotate<T extends SpatialObject>({ object, axis, angle: angleDEG }: {
  /** Source world-space geometry; never modified. */
  object: T;
  /** Spatial line defining both direction and origin; e.g. X, Y or Z. */
  axis: SpatialLine;
  /** Signed right-hand rotation in degrees. */
  angle: number;
}): T {
  if (!(axis instanceof SpatialLine)) throw new TypeError('Rotation axis must be a SpatialLine');
  validateVertex({ position: axis }); validateVertex({ position: axis.origin });
  if (!Number.isFinite(angleDEG)) throw new RangeError('Rotation angle must be finite');
  const scale = Math.max(Math.abs(axis[0]), Math.abs(axis[1]), Math.abs(axis[2]));
  if (scale === 0) throw new RangeError('Rotation axis must have a nonzero direction');
  const unit = vec3.normalize([0, 0, 0], [axis[0] / scale, axis[1] / scale, axis[2] / scale]);
  const matrix = mat4.fromRotation([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], degtorad(angleDEG % 360), unit)!;
  for (let i = 0; i < 3; i++) matrix[12 + i] = axis.origin[i] - (matrix[i] * axis.origin[0] + matrix[4 + i] * axis.origin[1] + matrix[8 + i] * axis.origin[2]);
  return rigidTransform(object, matrix);
}
