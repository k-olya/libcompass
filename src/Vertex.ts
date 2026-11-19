import type { ReadonlyVec3 } from 'gl-matrix';

/** A shared topological vertex with a position in world coordinates. */
export interface Vertex {
  /** Finite world-space XYZ coordinates; do not mutate the underlying array. */
  readonly position: ReadonlyVec3;
}

/** Validate coordinates when a geometry operation consumes a plain vertex. */
export function validateVertex(vertex: Vertex): Vertex {
  if (![vertex.position[0], vertex.position[1], vertex.position[2]].every(Number.isFinite)) {
    throw new RangeError('Vertex coordinates must be finite');
  }
  return vertex;
}
