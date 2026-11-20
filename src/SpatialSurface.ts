import { vec3 } from 'gl-matrix';
import { Edge } from './Edge.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { Surface } from './Surface.js';
import type { Vertex } from './Vertex.js';
import { validateVertex } from './Vertex.js';
import type { Tessellation } from './internal/Tessellation.js';

/**
 * An exact ruled surface between two equally parameterized spatial boundaries.
 *
 * @remarks
 * at(u, v) interpolates between start.at(u) and end.at(u). This represents
 * cylindrical and oblique extrusion walls without planar facets. Both rims
 * must be either open or closed. Closed rims bound a periodic surface without
 * an artificial seam edge. This class currently models ruled patches, rather
 * than arbitrary trimmed, doubly curved surfaces.
 */
export class SpatialSurface extends Surface {
  readonly start: SpatialBoundary;
  readonly end: SpatialBoundary;
  readonly reversed: boolean;

  /**
   * Create a ruled patch without tessellating its boundaries.
   *
   * @param options - Corresponding rims, optional shared side edges, and orientation.
   * @throws {@link RangeError} if only one rim is a loop or side edges do not join the rims.
   */
  constructor({ start, end, sides, reversed = false }: {
    start: SpatialBoundary;
    end: SpatialBoundary;
    sides?: readonly [Edge, Edge];
    reversed?: boolean;
  }) {
    if (start.isLoop() !== end.isLoop()) throw new RangeError('Surface rims must both be open or both be loops');
    if (start.isLoop() && sides) throw new RangeError('A periodic surface has no seam edges');
    const lateral = start.isLoop() ? [] : sides ?? [
      new Edge({ start: start.end, end: end.end }),
      new Edge({ start: start.start, end: end.start }),
    ];
    super({ outer: start.isLoop() ? [start] : [start, lateral[0], end, lateral[1]], holes: start.isLoop() ? [[end]] : [] });
    this.start = start;
    this.end = end;
    this.reversed = reversed;
  }

  /**
   * Evaluate the exact ruled surface in world space.
   * @param u - Normalized parameter along the rims in [0, 1].
   * @param v - Normalized displacement between the rims in [0, 1].
   * @throws {@link RangeError} if parameters are outside [0, 1] or coordinates are nonfinite.
   */
  at(u: number, v: number): Vertex {
    if (![u, v].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError('Surface parameters must be in [0, 1]');
    if (v === 0) return this.start.at(u);
    if (v === 1) return this.end.at(u);
    return validateVertex({ position: vec3.lerp([0, 0, 0], this.start.at(u).position, this.end.at(u).position, v) });
  }

  protected override prepare(context: Tessellation): void { context.link(this.start, this.end); }

  protected override mesh(context: Tessellation): Float32Array {
    const start = context.vertices(this.start), end = context.vertices(this.end);
    const positions = new Float32Array((start.length - 1) * 18);
    for (let i = 0; i + 1 < start.length; i++) {
      const triangles = [start[i], start[i + 1], end[i + 1], start[i], end[i + 1], end[i]];
      if (this.reversed) {
        [triangles[1], triangles[2]] = [triangles[2], triangles[1]];
        [triangles[4], triangles[5]] = [triangles[5], triangles[4]];
      }
      triangles.forEach((vertex, j) => positions.set(vertex.position, i * 18 + j * 3));
    }
    return positions;
  }
}

/**
 * Create a ruled patch without tessellating its boundaries.
 *
 * Constructor shorthand for `new SpatialSurface(options)`; returns a new {@link SpatialSurface} instance.
 *
 * @param options - Corresponding rims, optional shared side edges, and orientation.
 * @throws {@link RangeError} if only one rim is a loop or side edges do not join the rims.
 */
export function spatialSurface(options: {
  /** Boundary at v = 0, evaluated along u in [0, 1]. */
  start: SpatialBoundary;
  /** Corresponding boundary at v = 1. */
  end: SpatialBoundary;
  /** Shared edges at u = 1 and u = 0 for open rims; generated when omitted. */
  sides?: readonly [Edge, Edge];
  /** Reverse triangle winding; defaults to false. */
  reversed?: boolean;
}): SpatialSurface { return new SpatialSurface(options); }
