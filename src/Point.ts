/** A point in the local XY coordinates of a sketch. */
export class Point {
  /**
   * Create a finite two-dimensional point.
   *
   * @param x - Local X coordinate in model units.
   * @param y - Local Y coordinate in model units.
   * @throws {@link RangeError} if either coordinate is not finite.
   */
  constructor(
    /** Local X coordinate in model units. */
    public readonly x: number,
    /** Local Y coordinate in model units. */
    public readonly y: number
  ) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError('Point coordinates must be finite');
    }
  }
}
