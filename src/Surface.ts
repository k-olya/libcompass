import type { SpatialBoundary } from './SpatialBoundary.js';
import type { Vertex } from './Vertex.js';
import { orientLoop } from './internal/boundaryLoops.js';
import { Tessellation } from './internal/Tessellation.js';

/** Shared topological base for planar faces and curved spatial surfaces. */
export abstract class Surface {
  /** Ordered outer trim; boundary objects are shared with neighboring surfaces. */
  readonly outer: readonly SpatialBoundary[];
  /** Ordered inner trims. On a periodic wall this contains its opposite rim. */
  readonly holes: readonly (readonly SpatialBoundary[])[];

  protected constructor({ outer, holes = [] }: { outer: readonly SpatialBoundary[]; holes?: readonly (readonly SpatialBoundary[])[] }) {
    this.outer = [...outer];
    this.holes = holes.map(loop => [...loop]);
    for (const loop of [this.outer, ...this.holes]) orientLoop(loop);
  }

  /** Boundary objects in outer-then-holes order, including shared identities. */
  get boundaries(): readonly SpatialBoundary[] { return [this.outer, ...this.holes].flat(); }
  /** Unique topological endpoints; tessellation vertices are never added here. */
  get vertices(): readonly Vertex[] { return [...new Set(this.boundaries.flatMap(boundary => [boundary.start, boundary.end]))]; }

  /** Tessellate this surface at the library-wide 0.001 resolution. */
  triangulate(): Float32Array { return Surface.triangulateAll([this]); }

  /**
   * Mesh surfaces together, synchronizing subdivisions of shared boundaries.
   * @param surfaces - Surfaces to tessellate in order, without changing topology.
   * @returns Fresh non-indexed world-space XYZ triangle positions.
   */
  static triangulateAll(surfaces: readonly Surface[]): Float32Array {
    const context = new Tessellation();
    surfaces.forEach(surface => surface.prepare(context));
    const meshes = surfaces.map(surface => surface.mesh(context));
    const positions = new Float32Array(meshes.reduce((length, mesh) => length + mesh.length, 0));
    let offset = 0;
    for (const mesh of meshes) { positions.set(mesh, offset); offset += mesh.length; }
    return positions;
  }

  protected prepare(_context: Tessellation): void {}
  protected abstract mesh(context: Tessellation): Float32Array;
}
