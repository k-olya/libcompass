import { Edge } from './Edge.js';
import { Face } from './Face.js';
import { Memo } from './Memo.js';
import type { Vertex } from './Vertex.js';

/**
 * A memoized scene node with boundary topology, potentially containing disconnected components.
 *
 * @remarks
 * Vertices and edges are collected by object identity, preserving shared
 * topology between faces. Coordinate equality does not merge distinct objects.
 * Construction does not validate shell closure or manifoldness; extrusion
 * supplies consistently oriented boundary faces.
 *
 * Add solids directly to scenes and transform nodes. Triangulation includes
 * this solid's faces followed by its children and is cached until refresh().
 * Topology properties describe this solid's own faces, excluding children.
 */
export class Solid extends Memo {
  /** Faces in construction order, retaining their identities. */
  readonly faces: readonly Face[];
  /** Unique vertex objects in first-encounter order across faces. */
  readonly vertices: readonly Vertex[];
  /** Unique boundary edge objects in first-encounter order across faces. */
  readonly edges: readonly Edge[];

  /**
   * Collect faces and their shared boundary topology.
   *
   * @param options - Faces to retain; the input array is shallow-copied.
   */
  constructor({ faces }: { faces: readonly Face[] }) {
    super();
    this.faces = [...faces];
    this.vertices = [...new Set(faces.flatMap((face) => face.vertices))];
    this.edges = [...new Set(faces.flatMap((face) => face.edges))];
  }

  /**
   * Concatenate this solid's faces in order, followed by child triangulations.
   *
   * @returns A fresh non-indexed array of world-space XYZ triangle positions;
   * an empty solid without children returns an empty array. Face winding is
   * preserved. Memo.triangulate() caches the result until refresh() is called.
   */
  protected override triangulateUncached(): Float32Array {
    const meshes = [...this.faces.map((face) => face.triangulate()), super.triangulateUncached()];
    const positions = new Float32Array(meshes.reduce((length, mesh) => length + mesh.length, 0));
    let offset = 0;
    for (const mesh of meshes) {
      positions.set(mesh, offset);
      offset += mesh.length;
    }
    return positions;
  }
}

/**
 * Collect faces and their shared boundary topology.
 *
 * Constructor shorthand for `new Solid(options)`; returns a new {@link Solid} instance.
 *
 * @param options - Faces to retain; the input array is shallow-copied.
 */
export function solid(options: {
  /** Faces in construction order, retaining their identities. */
  faces: readonly Face[];
}): Solid { return new Solid(options); }
