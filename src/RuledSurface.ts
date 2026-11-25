import { vec3 } from 'gl-matrix';
import { Edge } from './Edge.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import type { SpatialCurve } from './SpatialCurve.js';
import { SpatialSurface } from './SpatialSurface.js';
import type { Vertex } from './Vertex.js';
import { validateVertex } from './Vertex.js';
import type { Tessellation } from './internal/Tessellation.js';
import type { RigidContext } from './internal/rigidContext.js';

/**
 * An exact ruled surface between two equally parameterized spatial boundaries.
 *
 * @remarks
 * at(u, v) interpolates between start.at(u) and end.at(u), or the apex. This represents
 * cylindrical, conical, and oblique extrusion walls without planar facets.
 * The end may be a single apex vertex. Otherwise both rims must be either
 * open or closed. Closed rims bound a periodic surface without
 * an artificial seam edge. This class currently models ruled patches, rather
 * than arbitrary trimmed, doubly curved surfaces.
 */
export class RuledSurface extends SpatialSurface {
  readonly start: SpatialBoundary;
  readonly end: SpatialBoundary | Vertex;

  /**
   * Create a ruled patch without tessellating its boundaries.
   *
   * @param options - Start rim, end rim or apex, optional shared side edges, and orientation.
   * @throws {@link RangeError} if only one rim is a loop or side edges do not join the rims.
   */
  constructor({ start, end, sides, reversed = false }: {
    start: SpatialBoundary;
    end: SpatialBoundary | Vertex;
    sides?: readonly [Edge, Edge];
    reversed?: boolean;
  }) {
    const apex = 'position' in end;
    if (apex) validateVertex(end);
    if (!apex && start.isLoop() !== end.isLoop()) throw new RangeError('Surface rims must both be open or both be loops');
    if (start.isLoop() && sides) throw new RangeError('A periodic surface has no seam edges');
    const lateral = start.isLoop() ? [] : sides ?? [
      new Edge({ start: start.end, end: apex ? end : end.end }),
      new Edge({ start: start.start, end: apex ? end : end.start }),
    ];
    super({
      at: (u, v) => {
        if (v === 0) return start.at(u);
        const last = apex ? end : end.at(u);
        return v === 1 ? last : { position: vec3.lerp([0, 0, 0], start.at(u).position, last.position, v) };
      },
      boundaryLoops: start.isLoop() ? (apex ? [[start]] : [[start], [end]])
        : [apex ? [start, ...lateral] : [start, lateral[0], end, lateral[1]]],
      sides: { v0: start, v1: apex ? undefined : end, u0: lateral[1], u1: lateral[0] },
      periodicU: start.isLoop(), reversed,
    });
    this.start = start;
    this.end = end;
  }

  /** Differentiate the ruling and retain each rim's tangent direction at smooth joins. */
  override derivatives(u: number, v: number): { du: vec3; dv: vec3 } {
    const derivative = (boundary: SpatialBoundary): vec3 => {
      const t = boundary.isLoop() ? (u % 1 + 1) % 1 : u, low = Math.max(0, t - 1e-5), high = Math.min(1, t + 1e-5);
      const delta = vec3.subtract([0, 0, 0], boundary.at(high).position, boundary.at(low).position);
      const tangent = (boundary as Partial<SpatialCurve>).tangent?.(t);
      return tangent ? vec3.scale([0, 0, 0], tangent, vec3.length(delta) / (high - low)) : vec3.scale(delta, delta, 1 / (high - low));
    };
    const start = this.start.at(this.periodicU ? (u % 1 + 1) % 1 : u), apex = 'position' in this.end;
    const end = apex ? this.end : this.end.at(this.periodicU ? (u % 1 + 1) % 1 : u);
    return { du: vec3.lerp([0, 0, 0], derivative(this.start), apex ? [0, 0, 0] : derivative(this.end), v),
      dv: vec3.subtract([0, 0, 0], end.position, start.position) };
  }

  /** Include a singular apex even when a periodic wall has no seam edges. */
  override get vertices(): readonly Vertex[] {
    return 'position' in this.end ? [...new Set([...super.vertices, this.end])] : super.vertices;
  }

  protected override copyTransformed(context: RigidContext): RuledSurface {
    const { map, vertex } = context, sides = this.transformedSides(context);
    return this.transformedSamples(new RuledSurface({ start: map(this.start),
      end: 'position' in this.end ? vertex(this.end) : map(this.end),
      sides: sides.u0 ? [sides.u1 as Edge, sides.u0 as Edge] : undefined, reversed: this.reversed }), context);
  }

  protected override prepare(context: Tessellation): void {
    if (!('position' in this.end)) context.link(this.start, this.end);
  }

  protected override mesh(context: Tessellation): Float32Array {
    const start = context.vertices(this.start), apex = 'position' in this.end ? this.end : undefined;
    const end = 'position' in this.end ? undefined : context.vertices(this.end);
    const stride = apex ? 9 : 18;
    const positions = new Float32Array((start.length - 1) * stride);
    for (let i = 0; i + 1 < start.length; i++) {
      const triangles = apex ? [start[i], start[i + 1], apex]
        : [start[i], start[i + 1], end![i + 1], start[i], end![i + 1], end![i]];
      if (this.reversed) {
        [triangles[1], triangles[2]] = [triangles[2], triangles[1]];
        if (!apex) [triangles[4], triangles[5]] = [triangles[5], triangles[4]];
      }
      triangles.forEach((vertex, j) => positions.set(vertex.position, i * stride + j * 3));
    }
    return positions;
  }
}

/**
 * Create a ruled patch without tessellating its boundaries.
 *
 * Constructor shorthand for `new RuledSurface(options)`; returns a new {@link RuledSurface} instance.
 *
 * @param options - Start rim, end rim or apex, optional shared side edges, and orientation.
 * @throws {@link RangeError} if only one rim is a loop or side edges do not join the rims.
 */
export function ruledSurface(options: {
  /** Boundary at v = 0, evaluated along u in [0, 1]. */
  start: SpatialBoundary;
  /** Corresponding boundary or shared apex vertex at v = 1. */
  end: SpatialBoundary | Vertex;
  /** Shared edges at u = 1 and u = 0 for open rims; generated when omitted. */
  sides?: readonly [Edge, Edge];
  /** Reverse triangle winding; defaults to false. */
  reversed?: boolean;
}): RuledSurface { return new RuledSurface(options); }
