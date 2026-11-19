import { Point } from './Point.js';

/** A bounded line between two sketch points. */
export class LineSegment {
  /**
   * Create a segment between two distinct sketch points.
   *
   * @param start - Endpoint at parameter zero, retained by reference.
   * @param end - Endpoint at parameter one, retained by reference.
   * @throws {@link RangeError} if the endpoints have identical coordinates.
   */
  constructor(
    /** Endpoint at parameter zero. */
    public readonly start: Point,
    /** Endpoint at parameter one. */
    public readonly end: Point
  ) {
    if (start.x === end.x && start.y === end.y) {
      throw new RangeError('A line segment needs distinct endpoints');
    }
  }

  /**
   * Interpolate between the endpoints, or extrapolate beyond them.
   *
   * @param t - Fraction along the segment: zero is start and one is end;
   * values are not clamped.
   * @returns A new point, including when evaluating either endpoint.
   * @throws {@link RangeError} if the resulting coordinates are not finite.
   */
  at(t: number): Point {
    return new Point(
      this.start.x + t * (this.end.x - this.start.x),
      this.start.y + t * (this.end.y - this.start.y),
    );
  }
}
