import { vec3 } from 'gl-matrix';
import { Plane } from './Plane.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { Surface } from './Surface.js';
import type { Vertex } from './Vertex.js';
import { orientLoop, sampleLoop } from './util/boundaryLoops.js';
import { signedArea, triangulatePolygon, validateLoops } from './util/polygon.js';
import type { Tessellation } from './util/Tessellation.js';

/**
 * A planar surface trimmed by exact edges and spatial curves.
 *
 * @remarks
 * Trim objects retain their identities. Sampled polylines validate the plane
 * and boundaries; constructing a face does not create triangle connectivity.
 * Only Face, rather than SpatialSurface, can supply a sketch plane.
 */
export class Face extends Surface {
  /** Oriented local frame; triangle winding follows its normal. */
  readonly plane: Plane;

  /**
   * Create a planar face from ordered, closed boundary loops.
   *
   * @param options - Outer trim, optional holes, and optional oriented plane.
   * Without a plane, orientation follows the outer trim's traversal.
   * @throws {@link RangeError} if trims are open, degenerate, or nonplanar.
   * Trim separation is checked on sampled polylines; tessellation is checked
   * when triangulating.
   */
  constructor({ outer, holes = [], plane }: {
    outer: readonly SpatialBoundary[];
    holes?: readonly (readonly SpatialBoundary[])[];
    plane?: Plane;
  }) {
    super({ outer, holes });
    const anchors = (loop: readonly SpatialBoundary[]) => orientLoop(loop).flatMap(({ boundary, reversed }) => {
      const points = boundary.sample();
      return (reversed ? [...points].reverse() : points).slice(0, -1);
    });
    const loops = [this.outer, ...this.holes].map(anchors);
    const points = loops[0];
    if (!plane) {
      for (let i = 1; i + 1 < points.length; i++) {
        const a = vec3.subtract([0, 0, 0], points[i].position, points[0].position);
        const b = vec3.subtract([0, 0, 0], points[i + 1].position, points[0].position);
        if (vec3.length(vec3.cross([0, 0, 0], a, b)) > 0) {
          const frame = new Plane({ a: points[0], b: points[i], c: points[i + 1] });
          plane = signedArea(points.map(point => frame.toLocal(point))) > 0
            ? frame : new Plane({ a: points[0], b: points[i + 1], c: points[i] });
          break;
        }
      }
    }
    if (!plane) throw new RangeError('A face needs a nondegenerate planar boundary');
    this.plane = plane;
    validateLoops(loops.map(loop => loop.map(vertex => this.plane.toLocal(vertex))));
  }

  protected override mesh(context: Tessellation): Float32Array {
    const loops = [this.outer, ...this.holes].map(loop => sampleLoop(loop, context));
    const polygons = loops.map(loop => loop.map(vertex => this.plane.toLocal(vertex)));
    const triangles = triangulatePolygon(polygons);
    const points = loops.flat();
    // The supplied plane controls orientation even if a shared loop runs backwards.
    if (signedArea(polygons[0]) < 0) {
      for (let i = 0; i < triangles.length; i += 3) [triangles[i + 1], triangles[i + 2]] = [triangles[i + 2], triangles[i + 1]];
    }
    const positions = new Float32Array(triangles.length * 3);
    triangles.forEach((index, i) => positions.set(points[index].position, i * 3));
    return positions;
  }
}

/**
 * Create a planar face from ordered, closed boundary loops.
 *
 * Constructor shorthand for `new Face(options)`; returns a new {@link Face} instance.
 *
 * @param options - Outer trim, optional holes, and optional oriented plane.
 * Without a plane, orientation follows the outer trim's traversal.
 * @throws {@link RangeError} if trims are open, degenerate, or nonplanar.
 * Trim separation is checked on sampled polylines; tessellation is checked
 * when triangulating.
 */
export function face(options: {
  /** Ordered, closed outer loop of shared edges and spatial curves. */
  outer: readonly SpatialBoundary[];
  /** Ordered, closed hole loops; defaults to none. */
  holes?: readonly (readonly SpatialBoundary[])[];
  /** Optional oriented frame; inferred from the outer loop when omitted. */
  plane?: Plane;
}): Face { return new Face(options); }
