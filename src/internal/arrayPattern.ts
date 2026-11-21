import { SpatialLine } from '../SpatialLine.js';
import type { SpatialObject } from '../SpatialObject.js';
import type { ArrayTarget } from '../ArrayTarget.js';

/** Solve pitch/count/extent in the caller's units (model lengths or degrees). */
export function arrayPattern({ N, offset, width }: { N?: number; offset?: number; width?: number }, defaultWidth?: number): { N: number; offset: number } {
  const specified = [N, offset, width].filter(value => value !== undefined).length;
  if (specified === 1 && width === undefined && defaultWidth !== undefined) width = offset !== undefined && offset < 0 ? -defaultWidth : defaultWidth;
  else if (specified !== 2) throw new RangeError('Specify exactly two of N, offset and width (rotation also accepts N or offset alone)');
  if (N !== undefined && (!Number.isSafeInteger(N) || N < 1 || N > 0xffffffff)) throw new RangeError('Array N must be a positive array-sized integer');
  if ([offset, width].some(value => value !== undefined && (!Number.isFinite(value) || value === 0))) throw new RangeError('Array offset and width must be finite and nonzero');
  if (N === undefined) {
    const ratio = width! / offset!;
    const nearest = Math.round(ratio);
    N = Math.floor(Math.abs(ratio - nearest) <= 8 * Number.EPSILON * Math.max(1, Math.abs(ratio)) ? nearest : ratio);
    if (!Number.isSafeInteger(N) || N < 1 || N > 0xffffffff) throw new RangeError('Array width and offset must have matching signs and fit at least one item');
  }
  offset ??= width! / N;
  if (!Number.isFinite(offset) || offset === 0 || !Number.isFinite(N * offset)) throw new RangeError('Array spacing or extent is outside the finite number range');
  return { N, offset };
}

/** SpatialLine is an Array subclass, but represents one geometry object here. */
export function copyArrayTarget(object: ArrayTarget, transform: (object: SpatialObject) => SpatialObject): SpatialObject[] {
  return object instanceof SpatialLine || !Array.isArray(object)
    ? [transform(object as SpatialObject)]
    : object.flatMap(item => copyArrayTarget(item, transform));
}
