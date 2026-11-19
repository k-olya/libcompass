import type { ReadonlyVec3 } from 'gl-matrix';

/** A shared topological vertex with a position in world coordinates. */
export class Vertex {
  /** Copied world-space XYZ coordinates; do not mutate the underlying array. */
  readonly position: ReadonlyVec3;

  /**
   * Create a vertex from world-space coordinates.
   *
   * @param position - Finite XYZ coordinates, copied into a new array.
   * @throws {@link RangeError} if any coordinate is not finite.
   */
  constructor(position: ReadonlyVec3) {
    if (![position[0], position[1], position[2]].every(Number.isFinite)) {
      throw new RangeError('Vertex coordinates must be finite');
    }
    this.position = [position[0], position[1], position[2]];
  }
}
