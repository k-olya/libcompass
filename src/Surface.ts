import type { SpatialBoundary } from './SpatialBoundary.js';
import type { Vertex } from './Vertex.js';
import { orientLoop } from './internal/boundaryLoops.js';
import { Tessellation } from './internal/Tessellation.js';

/** Shared topological base for planar faces and curved spatial surfaces. */
export abstract class Surface {
  /** Physical trim loops; a closed periodic surface can have no boundaries. */
  readonly boundaryLoops: readonly (readonly SpatialBoundary[])[];

  protected constructor({ boundaryLoops }: { boundaryLoops: readonly (readonly SpatialBoundary[])[] }) {
    this.boundaryLoops = boundaryLoops.map(loop => [...loop]);
    for (const loop of this.boundaryLoops) orientLoop(loop);
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
