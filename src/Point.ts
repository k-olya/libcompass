import type { Vertex } from './Vertex.js';

/** A point in the local XY coordinates of a sketch. */
export interface Point {
  /** Finite local X coordinate in model units. */
  readonly x: number;
  /** Finite local Y coordinate in model units. */
  readonly y: number;
}

/**
 * Create a fresh XY point from two numbers, a coordinate array, or a vertex.
 * Arrays (including typed arrays) and vertex positions supply their first two
 * coordinates; remaining coordinates are ignored, without plane projection.
 *
 * @throws RangeError if either selected coordinate is missing or nonfinite.
 */
export function p(...coordinates: [source: ArrayLike<number> | Vertex] | [x: number, y: number]): Point {
  if (coordinates.length === 2) return validatePoint({ x: coordinates[0], y: coordinates[1] });
  const [source] = coordinates;
  const values = 'position' in source ? source.position : source;
  return validatePoint({ x: values[0], y: values[1] });
}

/** Validate coordinates when a geometry operation consumes a plain point. */
export function validatePoint(point: Point): Point {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new RangeError('Point coordinates must be finite');
  }
  return point;
}
