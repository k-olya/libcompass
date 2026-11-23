import { vec3, type ReadonlyMat4 } from 'gl-matrix';
import type { ArrayTarget, ArrayCopy } from '../ArrayTarget.js';
import { Plane } from '../Plane.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { arrayPattern, copyArrayTarget } from '../internal/arrayPattern.js';
import { rigidTransform } from '../internal/rigidTransform.js';
import { sweepFrames } from '../internal/sweepFrames.js';

/**
 * Create an ordinary JavaScript array of copies placed along a spatial curve.
 * @param options.object - World-space geometry or nested arrays of it; never mutated.
 * @param options.curve - Spatial path on which each copy's world origin is placed.
 * @param options.follow - Rotate local Z onto the travel tangent with minimally twisting X/Y frames.
 * Defaults to false, preserving the original orientation; true requires a smooth regular path.
 * @param options.N - Positive integer repetition count, including a fresh copy at the path start.
 * @param options.offset - Signed distance between copies in model units; negative travels from end to start.
 * @param options.width - Signed pitch extent in model units, N * offset, excluding the endpoint.
 * @returns A flat array of independent mathematical geometry copies in repetition-major, depth-first order.
 * @remarks Specify two of N, offset and width. With only N or offset, width defaults to the
 * sampled path length. Distances use source sample() polylines at the current triangulation resolution;
 * positions and tangents use the original curve evaluator. The width must fit on the path.
 * A computed N is floor(width / offset), allowing roundoff at integer ratios. Closed paths do not
 * duplicate the starting copy at the endpoint; transported frames correct residual loop twist.
 * Objects are interpreted relative to the world origin, with no automatic centering.
 * By default tangents are not required and corners are allowed. Set follow: true to orient copies.
 * @throws {@link RangeError} for invalid array parameters, an extent beyond the path,
 * or detected stationary intervals, corners, cusps or unresolved frames.
 * @throws {@link TypeError} for unsupported geometry or a curve that is not a SpatialCurve.
 * @example
 * ```ts
 * const path = spatialCurveFromPlanar(circle(20));
 * const copies = curveArray({ object: part, curve: path, N: 12 });
 * scene.add(copies);
 * ```
 */
export function curveArray<T extends ArrayTarget>({ object, curve, follow = false, N, offset, width }: {
  /** Geometry or nested arrays of geometry; never modified. */
  object: T;
  /** Spatial path on which to place each copy's world origin. */
  curve: SpatialCurve;
  /** Rotate copies to follow the tangent, default false. True requires a smooth regular path. */
  follow?: boolean;
  /** Positive integer count; alone, distributes copies over the full path. */
  N?: number;
  /** Signed spacing in model units; alone, uses the full path. Negative reverses travel. */
  offset?: number;
  /** Signed pitch extent, N * offset, excluding the endpoint; must fit on the path. */
  width?: number;
}): ArrayCopy<T>[] {
  if (!(curve instanceof SpatialCurve)) throw new TypeError('Curve array requires a SpatialCurve');
  let path = curve;
  if ((offset ?? width ?? 1) < 0) {
    path = new SpatialCurve({ at: t => curve.at(1 - t), tangent: t => vec3.negate([0, 0, 0], curve.tangent(1 - t)) });
    path.sample = options => curve.sampleWithParameters(options).reverse().map(({ t }) => path.at(1 - t));
  }
  const sweep = follow ? sweepFrames(path, new Plane(), 0) : undefined;
  const samples = sweep ? [] : path.sampleWithParameters();
  const parameters = sweep?.parameters ?? samples.map(sample => sample.t);
  const lengths = sweep?.lengths ?? [0];
  for (let i = 1; i < samples.length; i++) {
    lengths.push(lengths[i - 1] + vec3.distance(samples[i - 1].point.position, samples[i].point.position));
  }
  const total = lengths[lengths.length - 1];
  if (!Number.isFinite(total) || total <= 0) throw new RangeError('Curve array path must have a finite nonzero length');
  const pattern = arrayPattern({ N, offset, width }, total);
  if (Math.abs(width ?? pattern.N * pattern.offset) > total + 8 * Number.EPSILON * Math.max(1, total)) {
    throw new RangeError('Curve array width must fit within the sampled path length');
  }
  return Array.from({ length: pattern.N }, (_, i) => {
    const distance = i * Math.abs(pattern.offset);
    let low = 0, high = lengths.length - 1;
    while (low + 1 < high) {
      const middle = (low + high) >> 1;
      if (lengths[middle] <= distance) low = middle; else high = middle;
    }
    const fraction = (distance - lengths[low]) / (lengths[high] - lengths[low]);
    const t = parameters[low] + fraction * (parameters[high] - parameters[low]);
    const { origin, xAxis, yAxis, normal } = sweep?.frame(t) ?? {
      origin: path.at(t).position, xAxis: [1, 0, 0], yAxis: [0, 1, 0], normal: [0, 0, 1],
    };
    const matrix: ReadonlyMat4 = [
      xAxis[0], xAxis[1], xAxis[2], 0,
      yAxis[0], yAxis[1], yAxis[2], 0,
      normal[0], normal[1], normal[2], 0,
      origin[0], origin[1], origin[2], 1,
    ];
    return copyArrayTarget(object, item => rigidTransform(item, matrix));
  }).flat() as ArrayCopy<T>[];
}
