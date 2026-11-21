import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import type { ArrayTarget, ArrayCopy } from '../ArrayTarget.js';
import { validateVertex } from '../Vertex.js';
import { arrayPattern, copyArrayTarget } from '../internal/arrayPattern.js';
import { displace } from './displace.js';

/**
 * Create an ordinary JavaScript array of displaced copies of world-space geometry.
 * @param options.object - Geometry accepted by displace, or nested arrays of it; never mutated.
 * @param options.vector - Finite nonzero direction; normalized internally. A SpatialLine's origin is ignored.
 * @param options.N - Positive integer repetition count, including fresh copies at displacement zero.
 * @param options.offset - Signed distance between copies in model units.
 * @param options.width - Signed total pitch extent, N * offset, excluding the endpoint.
 * @returns A flat array of independent geometry copies at i * offset, starting at i = 0.
 * Each repetition visits target leaves in depth-first order. Nested arrays are fully flattened;
 * geometry types, including array-like SpatialLine objects, are retained.
 * @remarks Specify exactly two of N, offset and width. A computed N is floor(width / offset),
 * allowing floating-point roundoff at integer ratios. For width 10 and offset 5, copies are at 0 and 5.
 * Opposite directions use a negative offset or width; when both are given they must share a sign.
 * Geometry remains mathematical and retains the ordinary displace operation's topology and sampling behavior.
 * @throws {@link RangeError} for invalid counts, zero/nonfinite vectors or spacing, or an invalid parameter combination.
 * @throws {@link TypeError} for unsupported target geometry.
 * @example
 * ```ts
 * const row = displacementArray({ object: part, vector: X, N: 4, offset: 10 });
 * const grid = displacementArray({ object: row, vector: Y, N: 3, offset: 10 });
 * scene.add(...grid);
 * ```
 */
export function displacementArray<T extends ArrayTarget>({ object, vector, N, offset, width }: {
  /** Geometry or nested arrays of geometry; never modified. */
  object: T;
  /** Finite nonzero XYZ direction; normalized internally. */
  vector: ReadonlyVec3;
  /** Positive integer number of repetitions; specify exactly two of N, offset and width. */
  N?: number;
  /** Signed spacing in model units. */
  offset?: number;
  /** Signed pitch extent, N * offset; the endpoint is excluded. */
  width?: number;
}): ArrayCopy<T>[] {
  const pattern = arrayPattern({ N, offset, width });
  validateVertex({ position: vector });
  const scale = Math.max(Math.abs(vector[0]), Math.abs(vector[1]), Math.abs(vector[2]));
  if (scale === 0) throw new RangeError('Displacement array vector must have a nonzero direction');
  const direction = vec3.normalize([0, 0, 0], [vector[0] / scale, vector[1] / scale, vector[2] / scale]);
  return Array.from({ length: pattern.N }, (_, i) => {
    const vector = vec3.scale([0, 0, 0], direction, i * pattern.offset);
    return copyArrayTarget(object, item => displace({ object: item, vector }));
  }).flat() as ArrayCopy<T>[];
}
