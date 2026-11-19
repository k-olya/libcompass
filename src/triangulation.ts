/** Maximum chord deviation in model units when tessellating curved geometry. */
export const TRIANGULATION_RESOLUTION = 0.001;

/** Number of chords needed to approximate a full circle at the library resolution. */
export function circleSegments(radius: number, resolution = TRIANGULATION_RESOLUTION): number {
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('Circle radius must be positive and finite');
  if (!Number.isFinite(resolution) || resolution <= 0) throw new RangeError('Triangulation resolution must be positive and finite');
  const angle = 2 * Math.asin(Math.sqrt(Math.min(1, resolution / (2 * radius))));
  const count = Math.max(3, Math.ceil(Math.PI / angle));
  if (!Number.isSafeInteger(count)) throw new RangeError('Circle is too large to triangulate at this resolution');
  return count;
}
