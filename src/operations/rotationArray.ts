import type { SpatialLine } from '../SpatialLine.js';
import type { ArrayTarget, ArrayCopy } from '../ArrayTarget.js';
import { arrayPattern, copyArrayTarget } from '../internal/arrayPattern.js';
import { rotate } from './rotate.js';

/**
 * Create an ordinary JavaScript array of rotated copies of world-space geometry.
 * @param options.object - Geometry accepted by rotate, or nested arrays of it; never mutated.
 * @param options.axis - Spatial line defining rotation origin and direction; normalized internally.
 * @param options.N - Positive integer repetition count, including fresh copies at angle zero.
 * @param options.offset - Signed right-hand angular spacing in degrees.
 * @param options.width - Signed angular pitch extent in degrees, N * offset, excluding the endpoint.
 * @returns A flat array of independent geometry copies at i * offset degrees, starting at i = 0.
 * Each repetition visits target leaves in depth-first order. Nested arrays are fully flattened;
 * geometry types, including array-like SpatialLine objects, are retained.
 * @remarks Specify two of N, offset and width. With only N or offset, width defaults to a
 * full turn (360 degrees, or -360 for negative offset). The final endpoint is excluded, avoiding
 * a duplicate at 360 degrees. A computed N is floor(width / offset), allowing roundoff at integer ratios.
 * Opposite rotation uses a negative offset or width; when both are given they must share a sign.
 * @throws {@link RangeError} for invalid counts, nonfinite/zero spacing or axis, or an invalid parameter combination.
 * @throws {@link TypeError} for unsupported geometry or an axis that is not a SpatialLine.
 * @example
 * ```ts
 * const ring = rotationArray({ object: part, axis: Z, N: 8 });
 * scene.add(...ring);
 * ```
 */
export function rotationArray<T extends ArrayTarget>({ object, axis, N, offset: offsetDEG, width: widthDEG }: {
  /** Geometry or nested arrays of geometry; never modified. */
  object: T;
  /** Rotation axis including its world-space origin. */
  axis: SpatialLine;
  /** Positive integer number of repetitions; alone, distributes copies over a full turn. */
  N?: number;
  /** Signed angular spacing in degrees; alone, uses a full turn. */
  offset?: number;
  /** Signed angular pitch extent in degrees, N * offset; the endpoint is excluded. */
  width?: number;
}): ArrayCopy<T>[] {
  const { N: count, offset: stepDEG } = arrayPattern({ N, offset: offsetDEG, width: widthDEG }, 360);
  return Array.from({ length: count }, (_, i) => copyArrayTarget(object, item => rotate({ object: item, axis, angle: i * stepDEG }))).flat() as ArrayCopy<T>[];
}
