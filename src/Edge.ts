import type { SpatialLine } from './SpatialLine.js';
import { rotate } from './operations/rotate.js';
import { displace } from './operations/displace.js';
import { vec3, type ReadonlyVec3 } from 'gl-matrix';
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
   * Return a new rotated edge; leave this object unchanged.
   * @param options.axis - Spatial line defining the rotation origin and direction.
   * @param options.angle - Signed right-hand rotation in degrees.
   * @see {@link rotate}
   */
  rotate(options: {
    /** Rotation axis, including its origin. */
    axis: SpatialLine;
    /** Signed rotation in degrees. */
    angle: number;
  }): this { return rotate({ ...options, object: this }); }

  /**
   * Return a new displaced edge; leave this object unchanged.
   * @param options.vector - XYZ displacement in model units, without normalization.
   * @see {@link displace}
   */
  displace(options: {
    /** Finite XYZ displacement in model units. */
    vector: ReadonlyVec3;
  }): this { return displace({ ...options, object: this }); }

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
