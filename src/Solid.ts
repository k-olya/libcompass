import { Memo } from './Memo.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { Surface } from './Surface.js';
import type { Vertex } from './Vertex.js';

/**
 * A memoized scene node retaining exact planar and spatial surfaces.
 *
 * @remarks
 * Surfaces share boundary and endpoint objects. Tessellation never changes
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
    this.vertices = [...new Set(this.boundaries.flatMap(boundary => [boundary.start, boundary.end]))];
  }

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
