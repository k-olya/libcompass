/** A point in the local XY coordinates of a sketch. */
export interface Point {
  /** Finite local X coordinate in model units. */
  readonly x: number;
  /** Finite local Y coordinate in model units. */
  readonly y: number;
}

/** Validate coordinates when a geometry operation consumes a plain point. */
export function validatePoint(point: Point): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Point coordinates must be finite');
  }
  return point;
}
