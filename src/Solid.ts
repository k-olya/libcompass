import { Memo } from './Memo.js';
import { chamfer } from './operations/chamfer.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { Surface } from './Surface.js';
import type { Vertex } from './Vertex.js';

/**
 * A memoized scene node retaining exact planar and spatial surfaces.
 *
 * @remarks
 * Surfaces share boundaries, endpoints, and singular apex vertices. Tessellation never changes
 * this topology. Shell closure and manifoldness are not validated by this
 * constructor; extrusion builds closed, consistently oriented solids.
 * Triangulation includes own surfaces followed by child nodes and is cached
 * until refresh(). Topology properties exclude children.
 */
export class Solid extends Memo {
  readonly surfaces: readonly Surface[];
  readonly boundaries: readonly SpatialBoundary[];
  readonly vertices: readonly Vertex[];

  /**
   * Collect surfaces and their shared analytic boundary topology.
   * @param options - Surfaces to retain; the input array is shallow-copied.
   */
  constructor({ surfaces }: { surfaces: readonly Surface[] }) {
    super();
    this.surfaces = [...surfaces];
    this.boundaries = [...new Set(surfaces.flatMap(surface => surface.boundaries))];
    this.vertices = [...new Set(surfaces.flatMap(surface => surface.vertices))];
  }

  /**
   * Return a new chamfered solid, leaving this solid and its cached mesh unchanged.
   * @param options - Setback, angle, and indices in this solid's boundaries array.
   * @param options.length - Positive setback on the first adjoining surface in
   * surfaces order; defaults to 0.5 (a chord distance on curved surfaces).
   * @param options.angle - Angle in degrees from that surface toward the material;
   * strictly between 0 and 90, default 45.
   * @param options.boundaries - Boundary indices; omitted or empty means all.
   * @returns A new solid retaining the original child nodes in a new child array.
   * @throws {@link RangeError} for invalid options, oversized bevels, or unresolved intersections.
   * @see {@link chamfer}
   */
  chamfer(options: {
    /** Positive setback on the first adjoining surface; defaults to 0.5. */
    length?: number;
    /** Angle in degrees; defaults to 45. */
    angle?: number;
    /** Indices in this.boundaries; omitted or empty selects all boundaries. */
    boundaries?: readonly number[];
  } = {}): Solid { return chamfer({ ...options, solid: this }); }

  protected override triangulateUncached(): Float32Array {
    const own = Surface.triangulateAll(this.surfaces), children = super.triangulateUncached();
    const positions = new Float32Array(own.length + children.length);
    positions.set(own); positions.set(children, own.length);
    return positions;
  }
}

/**
 * Collect surfaces and their shared analytic boundary topology.
 *
 * Constructor shorthand for `new Solid(options)`; returns a new {@link Solid} instance.
 *
 * @param options - Surfaces to retain; the input array is shallow-copied.
 */
export function solid(options: {
  /** Planar faces and spatial surfaces, retaining their identities. */
  surfaces: readonly Surface[];
}): Solid { return new Solid(options); }
