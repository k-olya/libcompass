import { vec3 } from 'gl-matrix';
import { Plane } from '../Plane.js';
import { Solid } from '../Solid.js';
import { validateVertex } from '../Vertex.js';
import { rigidTransform } from '../internal/rigidTransform.js';

/**
 * Reflect a solid across an infinite plane, returning a new mathematical solid.
 * @param options.solid - Solid to reflect; geometry, child nodes and caches are never modified.
 * @param options.plane - Reflection plane in world space; its normal's sign does not affect the result.
 * @returns A new solid with outward orientation, exact surfaces, shared topology and sampling overrides.
 * Child geometry is retained under fresh lazy transform nodes.
 * @throws {@link TypeError} if solid or plane has the wrong type.
 * @throws {@link RangeError} if the plane has nonfinite coordinates or a zero normal.
 * @example
 * ```ts
 * const reflected = mirror({ solid: part, plane: YZ });
 * ```
 */
export function mirror({ solid, plane }: {
  /** Source solid; never modified. */
  solid: Solid;
  /** World-space reflection plane, including its origin. */
  plane: Plane;
}): Solid {
  if (!(solid instanceof Solid)) throw new TypeError('Mirror requires a Solid');
  if (!(plane instanceof Plane)) throw new TypeError('Mirror requires a Plane');
  validateVertex({ position: plane.origin });
  validateVertex({ position: plane.normal });
  const scale = Math.max(Math.abs(plane.normal[0]), Math.abs(plane.normal[1]), Math.abs(plane.normal[2]));
  if (scale === 0) throw new RangeError('Mirror plane must have a nonzero normal');
  const normal = vec3.normalize([0, 0, 0], [plane.normal[0] / scale, plane.normal[1] / scale, plane.normal[2] / scale]);
  const distance = vec3.dot(normal, plane.origin);
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) matrix[column * 4 + row] -= 2 * normal[row] * normal[column];
    matrix[12 + row] = 2 * normal[row] * distance;
  }
  return rigidTransform(solid, matrix);
}
