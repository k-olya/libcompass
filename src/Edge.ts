import { vec3 } from 'gl-matrix';
import { validateVertex, type Vertex } from './Vertex.js';
import type { SpatialBoundary } from './SpatialBoundary.js';

/**
 * A straight boundary edge referencing two world-space vertices.
 *
 * @remarks
 * Extruded solids share each edge object between its incident faces. Face loop
 * order supplies orientation; the edge's own endpoint order need not match it.
 */
export class Edge implements SpatialBoundary {
  /** Vertex at parameter zero, retained by reference. */
  readonly start: Vertex;
  /** Vertex at parameter one, retained by reference. */
  readonly end: Vertex;
  /**
   * Create an edge, retaining both vertex identities.
   *
   * @param options - Start and end vertices, retained by reference.
   * @throws {@link RangeError} if the endpoints are nonfinite or have identical positions.
   */
  constructor({ start, end }: { start: Vertex; end: Vertex }) {
    this.start = validateVertex(start);
    this.end = validateVertex(end);
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
    return validateVertex({ position: vec3.lerp([0, 0, 0], this.start.position, this.end.position, t) });
  }

  /** Straight edges have distinct endpoints and therefore are never loops. */
  isLoop(): boolean { return false; }

  /** Sample the exact straight boundary; only its shared endpoints are needed. */
  sample(): Vertex[] { return [this.start, this.end]; }
}

/**
 * Create an edge, retaining both vertex identities.
 *
 * Constructor shorthand for `new Edge(options)`; returns a new {@link Edge} instance.
 *
 * @param options - Start and end vertices, retained by reference.
 * @throws {@link RangeError} if the endpoints are nonfinite or have identical positions.
 */
export function edge(options: {
  /** Vertex at parameter zero, retained by reference. */
  start: Vertex;
  /** Vertex at parameter one, retained by reference. */
  end: Vertex;
}): Edge { return new Edge(options); }
