import { Surface } from './Surface.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { validateVertex, type Vertex } from './Vertex.js';
import { sampleSurface, type SurfaceGrid } from './internal/surfaceSampling.js';
import type { Tessellation } from './internal/Tessellation.js';

/** Physical parameter-domain sides; omit sides identified across periodic seams. */
export interface SurfaceSides {
  /** Boundary along v, at u = 0. */
  u0?: SpatialBoundary;
  /** Boundary along v, at u = 1. */
  u1?: SpatialBoundary;
  /** Boundary along u, at v = 0. */
  v0?: SpatialBoundary;
  /** Boundary along u, at v = 1. */
  v1?: SpatialBoundary;
}

/** A general parametric spatial surface, including doubly periodic surfaces such as tori. */
export class SpatialSurface extends Surface {
  readonly periodicU: boolean;
  readonly periodicV: boolean;
  readonly reversed: boolean;
  private readonly evaluate: (u: number, v: number) => Vertex;
  /** Physical boundaries at the four parameter-domain sides, in increasing parameter order. */
  readonly sides: Readonly<SurfaceSides>;
  private grid?: SurfaceGrid;

  /**
   * Create a mathematical surface without replacing it with a mesh.
   * @param options - Evaluator, physical boundary loops, parameter sides, periodicity, and orientation.
   * @remarks Sides use increasing parameters and must agree with at(). Periodic seams are not boundaries.
   * General curved trimming inside the parameter rectangle is not supported yet.
   */
  constructor({ at, boundaryLoops = [], sides = {}, periodicU = false, periodicV = false, reversed = false }: {
    at: (u: number, v: number) => Vertex;
    boundaryLoops?: readonly (readonly SpatialBoundary[])[];
    sides?: SurfaceSides;
    periodicU?: boolean;
    periodicV?: boolean;
    reversed?: boolean;
  }) {
    super({ boundaryLoops });
    this.evaluate = at; this.sides = sides;
    this.periodicU = periodicU; this.periodicV = periodicV; this.reversed = reversed;
  }

  /** Evaluate the surface on [0, 1]², sharing coordinates across periodic seams. */
  at(u: number, v: number): Vertex {
    if (![u, v].every(t => Number.isFinite(t) && t >= 0 && t <= 1)) throw new RangeError('Surface parameters must be in [0, 1]');
    return validateVertex(this.evaluate(this.periodicU && u === 1 ? 0 : u, this.periodicV && v === 1 ? 0 : v));
  }

  /** Sample adaptively in both parameters; sampling never adds topological edges. */
  sample(): SurfaceGrid { return sampleSurface(this); }

  protected override prepare(context: Tessellation): void {
    const { u0, u1, v0, v1 } = this.sides;
    if (u0 && u1) context.link(u0, u1);
    if (v0 && v1) context.link(v0, v1);
    const u = [v0, v1].flatMap(side => side ? context.parameters(side) : []);
    const v = [u0, u1].flatMap(side => side ? context.parameters(side) : []);
    const samples = this.sample();
    this.grid = sampleSurface(this, [...samples.u, ...u], [...samples.v, ...v]);
    for (const side of [v0, v1]) if (side) context.request(side, this.grid.u);
    for (const side of [u0, u1]) if (side) context.request(side, this.grid.v);
  }

  protected override mesh(context: Tessellation): Float32Array {
    const grid = this.grid ?? this.sample(), { u, v } = grid;
    const points = grid.vertices.map(row => [...row]);
    const { u0, u1, v0, v1 } = this.sides;
    if (u0) points[0] = [...context.vertices(u0)];
    if (u1) points[u.length - 1] = [...context.vertices(u1)];
    for (const [side, j] of [[v0, 0], [v1, v.length - 1]] as const) {
      if (side) context.vertices(side).forEach((point, i) => { points[i][j] = point; });
    }
    if (this.periodicU) points[u.length - 1] = points[0];
    if (this.periodicV) for (const row of points) row[v.length - 1] = row[0];
    const positions = new Float32Array((u.length - 1) * (v.length - 1) * 18);
    let offset = 0;
    for (let i = 0; i + 1 < u.length; i++) for (let j = 0; j + 1 < v.length; j++) {
      const corners = [points[i][j], points[i + 1][j], points[i + 1][j + 1], points[i][j + 1]];
      const indices = this.reversed ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const index of indices) { positions.set(corners[index].position, offset); offset += 3; }
    }
    return positions;
  }
}

/**
 * Create a mathematical surface without replacing it with a mesh.
 *
 * Constructor shorthand for `new SpatialSurface(options)`; returns a new {@link SpatialSurface} instance.
 * @param options - Evaluator, physical boundary loops, parameter sides, periodicity, and orientation.
 * @remarks Sides use increasing parameters and must agree with at(). Periodic seams are not boundaries.
 * General curved trimming inside the parameter rectangle is not supported yet.
 */
export function spatialSurface(options: {
  /** Surface evaluator on [0, 1]². */
  at: (u: number, v: number) => Vertex;
  /** Physical trim loops, excluding parameter seams. */
  boundaryLoops?: readonly (readonly SpatialBoundary[])[];
  /** Physical sides corresponding to the parameter rectangle. */
  sides?: SurfaceSides;
  /** Identify u = 0 and u = 1 without an edge. */
  periodicU?: boolean;
  /** Identify v = 0 and v = 1 without an edge. */
  periodicV?: boolean;
  /** Reverse triangle winding. */
  reversed?: boolean;
}): SpatialSurface { return new SpatialSurface(options); }
