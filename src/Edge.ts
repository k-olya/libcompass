import { vec3 } from 'gl-matrix';
import { Vertex } from './Vertex.js';

/**
 * A straight boundary edge referencing two world-space vertices.
 *
 * @remarks
 * Extruded solids share each edge object between its incident faces. Face loop
 * order supplies orientation; the edge's own endpoint order need not match it.
 */
export class Edge {
  /**
   * Create an edge, retaining both vertex identities.
   *
   * @param start - Vertex at parameter zero.
   * @param end - Vertex at parameter one.
   * @throws {@link RangeError} if the endpoints have identical positions.
   */
  constructor(
    /** Vertex at parameter zero. */
    public readonly start: Vertex,
    /** Vertex at parameter one. */
    public readonly end: Vertex
  ) {
    if (vec3.exactEquals(start.position, end.position)) {
      throw new RangeError('An edge needs distinct endpoints');
    }
  }

  /**
   * Interpolate between the endpoints, or extrapolate beyond them.
   *
   * @param t - Fraction along the edge: zero is start and one is end;
   * values are not clamped.
   * @returns A new vertex, distinct from the edge's endpoint objects.
   * @throws {@link RangeError} if the resulting coordinates are not finite.
   */
  at(t: number): Vertex {
    return new Vertex(vec3.lerp([0, 0, 0], this.start.position, this.end.position, t));
  }
}
