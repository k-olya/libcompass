import { validatePoint, type Point } from './Point.js';

/** A bounded line between two sketch points. */
export class LineSegment {
  /** Endpoint at parameter zero, retained by reference. */
  readonly start: Point;
  /** Endpoint at parameter one, retained by reference. */
  readonly end: Point;
  /**
   * Create a segment between two distinct sketch points.
   *
   * @param options - Start and end points, retained by reference.
   * @throws {@link RangeError} if the endpoints are nonfinite or have identical coordinates.
   */
  constructor({ start, end }: { start: Point; end: Point }) {
    this.start = validatePoint(start);
    this.end = validatePoint(end);
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
    return validatePoint({ x: this.start.x + t * (this.end.x - this.start.x), y: this.start.y + t * (this.end.y - this.start.y) });
  }
}

/**
 * Create a segment between two distinct sketch points.
 *
 * Constructor shorthand for `new LineSegment(options)`; returns a new {@link LineSegment} instance.
 *
 * @param options - Start and end points, retained by reference.
 * @throws {@link RangeError} if the endpoints are nonfinite or have identical coordinates.
 */
export function lineSegment(options: {
  /** Endpoint at parameter zero, retained by reference. */
  start: Point;
  /** Endpoint at parameter one, retained by reference. */
  end: Point;
}): LineSegment { return new LineSegment(options); }
