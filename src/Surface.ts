import type { SpatialBoundary } from './SpatialBoundary.js';
import type { Vertex } from './Vertex.js';
import { orientLoop } from './internal/boundaryLoops.js';
import { Tessellation } from './internal/Tessellation.js';
import type { ReadonlyVec3 } from 'gl-matrix';
import type { SpatialLine } from './SpatialLine.js';
import type { RigidContext } from './internal/rigidContext.js';
import { rotate } from './operations/rotate.js';
import { displace } from './operations/displace.js';

/** Internal bridge to the protected surface copy hook, without importing derived classes into the operation. */
export let transformSurface: (surface: Surface, context: RigidContext) => Surface;

/** Shared topological base for planar faces and curved spatial surfaces. */
export abstract class Surface {
  static { transformSurface = (surface, context) => surface.copyTransformed(context); }
  /** Physical trim loops; a closed periodic surface can have no boundaries. */
  readonly boundaryLoops: readonly (readonly SpatialBoundary[])[];

  protected constructor({ boundaryLoops }: { boundaryLoops: readonly (readonly SpatialBoundary[])[] }) {
    this.boundaryLoops = boundaryLoops.map(loop => [...loop]);
    for (const loop of this.boundaryLoops) orientLoop(loop);
  }

  /**
   * Return a new rotated surface, retaining its built-in kind, trims and topology.
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
   * Return a new displaced surface, retaining its built-in kind, trims and topology.
   * Accepts a displacement vector directly, or an options object containing vector.
   *
   * @param options.vector - XYZ displacement in model units, without normalization.
   * @see {@link displace}
   */
  displace(options: ReadonlyVec3 | {
    /** Finite XYZ displacement in model units. */
    vector: ReadonlyVec3;
  }): this { return displace({ object: this, vector: 'vector' in options ? options.vector : options }); }

  protected copyTransformed(_context: RigidContext): Surface {
    throw new TypeError('Transform requires a supported mathematical surface');
  }

  /** Shared physical boundary objects; parameter seams are not topology. */
  get boundaries(): readonly SpatialBoundary[] { return this.boundaryLoops.flat(); }
  /** Unique topological endpoints; tessellation vertices are never added here. */
  get vertices(): readonly Vertex[] { return [...new Set(this.boundaries.flatMap(boundary => [boundary.start, boundary.end]))]; }

  /** Tessellate this surface at the configured library-wide resolution. */
  triangulate(): Float32Array { return Surface.triangulateAll([this]); }

  /**
   * Mesh surfaces together, synchronizing subdivisions of shared boundaries.
   * @param surfaces - Surfaces to tessellate in order, without changing topology.
   * @returns Fresh non-indexed world-space XYZ triangle positions.
   */
  static triangulateAll(surfaces: readonly Surface[]): Float32Array {
    const context = new Tessellation();
    for (let pass = 0; ; pass++) {
      const revision = context.revision;
      surfaces.forEach(surface => surface.prepare(context));
      if (context.revision === revision) break;
      if (pass >= 20) throw new RangeError('Shared surface sampling did not converge');
    }
    const meshes = surfaces.map(surface => surface.mesh(context));
    const positions = new Float32Array(meshes.reduce((length, mesh) => length + mesh.length, 0));
    let offset = 0;
    for (const mesh of meshes) { positions.set(mesh, offset); offset += mesh.length; }
    return positions;
  }

  protected prepare(_context: Tessellation): void {}
  protected abstract mesh(context: Tessellation): Float32Array;
}
