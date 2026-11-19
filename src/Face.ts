import { vec3 } from 'gl-matrix';
import { Edge } from './Edge.js';
import { Circle } from './Circle.js';
import { Plane } from './Plane.js';
import { SpatialCurve } from './SpatialCurve.js';
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
 * Trim objects retain their identities. Curves are sampled only during
 * triangulation; constructing a face does not create triangle connectivity.
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
   * Curved trim separation and tessellation are checked when triangulating.
   */
  constructor({ outer, holes = [], plane }: {
    outer: readonly SpatialBoundary[];
    holes?: readonly (readonly SpatialBoundary[])[];
    plane?: Plane;
  }) {
    super({ outer, holes });
    const anchors = (loop: readonly SpatialBoundary[]) => orientLoop(loop).flatMap(({ boundary, reversed }) => {
      const parameters = boundary instanceof SpatialCurve ? [0, 0.25, 0.5, 0.75] : [0];
      return parameters.map(t => boundary.at(reversed ? 1 - t : t));
    });
    const points = anchors(this.outer);
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
    const loops = [this.outer, ...this.holes];
    for (const loop of loops) anchors(loop).forEach(vertex => this.plane.toLocal(vertex));
    if (this.boundaries.every(boundary => boundary instanceof Edge)) {
      const polygons = loops.map(loop => anchors(loop).map(vertex => this.plane.toLocal(vertex)));
      validateLoops(polygons);
    }
  }

  protected override prepare(context: Tessellation): void {
    // Exact circular clearances prevent a valid narrow gap from being crossed by chords.
    for (const boundary of this.boundaries) {
      if (!(boundary instanceof SpatialCurve) || !(boundary.planarCurve instanceof Circle) || !boundary.plane) continue;
      const center = this.plane.toLocal(boundary.plane.toWorld(boundary.planarCurve.center));
      const radius = boundary.planarCurve.radius;
      for (const other of this.boundaries) {
        if (other === boundary) continue;
        let gap: number | undefined;
        if (other instanceof SpatialCurve && other.planarCurve instanceof Circle && other.plane) {
          const otherCenter = this.plane.toLocal(other.plane.toWorld(other.planarCurve.center));
          const distance = Math.hypot(center.x - otherCenter.x, center.y - otherCenter.y);
          gap = Math.max(distance - radius - other.planarCurve.radius, Math.abs(radius - other.planarCurve.radius) - distance);
        } else if (other instanceof Edge) {
          const a = this.plane.toLocal(other.start), b = this.plane.toLocal(other.end);
          const dx = b.x - a.x, dy = b.y - a.y;
          const t = Math.max(0, Math.min(1, ((center.x - a.x) * dx + (center.y - a.y) * dy) / (dx * dx + dy * dy)));
          const closest = Math.hypot(a.x + dx * t - center.x, a.y + dy * t - center.y);
          const farthest = Math.max(Math.hypot(a.x - center.x, a.y - center.y), Math.hypot(b.x - center.x, b.y - center.y));
          gap = Math.max(closest - radius, radius - farthest);
        }
        if (gap !== undefined && gap > 0) context.requestResolution(boundary, gap / 4);
      }
    }
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
 * Curved trim separation and tessellation are checked when triangulating.
 */
export function face(options: {
  /** Ordered, closed outer loop of shared edges and spatial curves. */
  outer: readonly SpatialBoundary[];
  /** Ordered, closed hole loops; defaults to none. */
  holes?: readonly (readonly SpatialBoundary[])[];
  /** Optional oriented frame; inferred from the outer loop when omitted. */
  plane?: Plane;
}): Face { return new Face(options); }
