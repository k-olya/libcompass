import { vec3 } from 'gl-matrix';
import { Edge } from './Edge.js';
import { Plane } from './Plane.js';
import { Vertex } from './Vertex.js';
import { signedArea, triangulatePolygon } from './util/polygon.js';

/**
 * An oriented planar face with an outer boundary and optional holes.
 *
 * @remarks
 * Boundary arrays are copied while vertex and supplied edge identities are
 * retained. Treat coordinates and topology as immutable: triangulation
 * connectivity is computed during construction.
 */
export class Face {
  /** Ordered outer boundary, without repeating the closing vertex. */
  readonly outer: readonly Vertex[];
  /** Disjoint hole boundaries, each without a repeated closing vertex. */
  readonly holes: readonly (readonly Vertex[])[];
  /** Boundary vertices flattened in outer-then-holes order. */
  readonly vertices: readonly Vertex[];
  /** Boundary edges in the same loop order; excludes triangulation diagonals. */
  readonly edges: readonly Edge[];
  /** Local frame whose normal follows the outer boundary's winding. */
  readonly plane: Plane;
  private readonly triangles: readonly number[];

  /**
   * Create and validate a planar face.
   *
   * @param outer - Simple outer loop containing at least three noncollinear
   * vertices. Its winding determines face orientation.
   * @param holes - Simple, disjoint loops strictly inside the outer loop;
   * their winding does not affect triangulation. Defaults to no holes.
   * @param edges - Optional shared edges matching successive vertex pairs in
   * outer-then-holes order, in either endpoint direction. Omit to create edges.
   * @throws {@link RangeError} if the boundaries are degenerate, nonplanar,
   * intersecting, touching, or incorrectly nested; edges do not match; or
   * triangulation fails at the current numeric tolerance.
   */
  constructor(outer: readonly Vertex[], holes: readonly (readonly Vertex[])[] = [], edges?: readonly Edge[]) {
    if (outer.length < 3) throw new RangeError('A face needs at least three outer vertices');
    this.outer = [...outer];
    this.holes = holes.map((hole) => [...hole]);
    const loops = [this.outer, ...this.holes];
    this.vertices = loops.flat();

    let plane: Plane | undefined;
    for (let i = 1; i + 1 < outer.length; i++) {
      const a = vec3.subtract([0, 0, 0], outer[i].position, outer[0].position);
      const b = vec3.subtract([0, 0, 0], outer[i + 1].position, outer[0].position);
      if (vec3.length(vec3.cross([0, 0, 0], a, b)) > 0) {
        const candidate = new Plane(outer[0], outer[i], outer[i + 1]);
        // A concave boundary can begin with a reflex corner. Orient the frame
        // using the entire loop, rather than just its first noncollinear triple.
        plane = signedArea(outer.map((vertex) => candidate.toLocal(vertex))) > 0
          ? candidate : new Plane(outer[0], outer[i + 1], outer[i]);
        break;
      }
    }
    if (!plane) throw new RangeError('A face needs noncollinear vertices');
    this.plane = plane;
    this.triangles = triangulatePolygon(loops.map((loop) => loop.map((vertex) => this.plane.toLocal(vertex))));

    const boundaries = loops.flatMap((loop) => loop.map((start, i) => [start, loop[(i + 1) % loop.length]] as const));
    if (edges && (edges.length !== boundaries.length || boundaries.some(([a, b], i) =>
      !((edges[i].start === a && edges[i].end === b) || (edges[i].start === b && edges[i].end === a))))) {
      throw new RangeError('Face edges must match its boundary vertices');
    }
    this.edges = edges ? [...edges] : boundaries.map(([a, b]) => new Edge(a, b));
  }

  /**
   * Tessellate this face, excluding its holes.
   *
   * @returns A fresh array of world-space XYZ triangle positions, nine floats
   * per triangle, wound consistently with the face plane's normal.
   */
  triangulate(): Float32Array {
    const positions = new Float32Array(this.triangles.length * 3);
    this.triangles.forEach((index, i) => positions.set(this.vertices[index].position, i * 3));
    return positions;
  }
}
