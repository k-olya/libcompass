import { vec3, type ReadonlyMat4 } from 'gl-matrix';

/**
 * Transform a contiguous range of XYZ points in place with a 4-by-4 matrix.
 *
 * @remarks
 * Indices and counts refer to points, not individual floats. Coordinates outside
 * the range are untouched. Transformation follows gl-matrix's vec3 transformMat4,
 * including homogeneous division and its fallback to a divisor of one when W is zero.
 *
 * @param points - Packed XYZ coordinates to modify.
 * @param matrix - gl-matrix column-major transformation.
 * @param start - Zero-based point index; defaults to zero.
 * @param n - Number of triplets; defaults to all remaining points. A zero count
 * does nothing. The default requires the array to contain whole XYZ triplets.
 * @returns The original points array after modification.
 * @throws {@link RangeError} before modification if start or n is not a
 * nonnegative integer, or the range extends beyond the array.
 *
 * @example
 * ```ts
 * transformMat4(positions, matrix, 1, 2); // Transform points 1 and 2 only.
 * ```
 */
export function transformMat4(
  points: Float32Array,
  matrix: ReadonlyMat4,
  start = 0,
  n = points.length / 3 - start,
): Float32Array {
  if (
    !Number.isInteger(start) || !Number.isInteger(n) ||
    start < 0 || n < 0 || (start + n) * 3 > points.length
  ) {
    throw new RangeError('start and n must describe a valid range of whole points');
  }

  // gl-matrix treats a zero count as "all remaining points".
  if (n > 0) {
    vec3.forEach(points, 3, start * 3, n, vec3.transformMat4, matrix);
  }
  return points;
}
