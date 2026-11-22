import { vec3 } from 'gl-matrix';
import { Surface } from './Surface.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { validateVertex, type Vertex } from './Vertex.js';
import { sampleSurface, type SurfaceGrid } from './internal/surfaceSampling.js';
import type { Tessellation } from './internal/Tessellation.js';
import type { RigidContext } from './internal/rigidContext.js';

/** Physical parameter-domain sides; boundaries may run in either direction. Omit periodic seams. */
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
  /** Shared singular vertices at collapsed parameter sides, such as sphere poles. */
  readonly poles: readonly Vertex[];
  private readonly evaluate: (u: number, v: number) => Vertex;
  /** Physical boundaries at the four parameter-domain sides, in either native direction. */
  readonly sides: Readonly<SurfaceSides>;
  private grid?: SurfaceGrid;
  private directions = new Map<keyof SurfaceSides, boolean>();

  /**
   * Create a mathematical surface without replacing it with a mesh.
   *
   * Accepts the evaluator function directly, or an options object for boundaries and surface settings.
   *
   * @param options - Evaluator, physical boundary loops, parameter sides, periodicity, and orientation.
   * @remarks Sides agree with at() using t or 1-t. Periodic seams are not boundaries.
   * Use trimSurface for supported geometric cuts, or TrimmedSurface for an explicit retained chart.
   */
  constructor(options: ((u: number, v: number) => Vertex) | {
    at: (u: number, v: number) => Vertex;
    boundaryLoops?: readonly (readonly SpatialBoundary[])[];
    sides?: SurfaceSides;
    periodicU?: boolean;
    periodicV?: boolean;
    reversed?: boolean;
    /** Singular vertices retained even when they do not bound a physical edge. */
    poles?: readonly Vertex[];
  }) {
    const { at, boundaryLoops = [], sides = {}, periodicU = false, periodicV = false, reversed = false, poles = [] } = typeof options === 'function' ? { at: options } : options;
    super({ boundaryLoops });
    this.evaluate = at; this.sides = sides;
    this.poles = poles.map(validateVertex);
    this.periodicU = periodicU; this.periodicV = periodicV; this.reversed = reversed;
  }

  /** Include singular poles even when no physical boundary touches them. */
  override get vertices(): readonly Vertex[] { return [...new Set([...super.vertices, ...this.poles])]; }

  /** Evaluate the surface on [0, 1]², sharing coordinates across periodic seams. */
  at(u: number, v: number): Vertex {
    if (![u, v].every(t => Number.isFinite(t) && t >= 0 && t <= 1)) throw new RangeError('Surface parameters must be in [0, 1]');
    return validateVertex(this.evaluate(this.periodicU && u === 1 ? 0 : u, this.periodicV && v === 1 ? 0 : v));
  }

  /** Sample adaptively in both parameters; sampling never adds topological edges. */
  sample(): SurfaceGrid { return sampleSurface(this); }

  protected transformedSides({ map }: RigidContext): SurfaceSides {
    const sides: SurfaceSides = {};
    for (const [key, side] of Object.entries(this.sides)) if (side) sides[key as keyof SurfaceSides] = map(side);
    return sides;
  }

  protected transformedSamples<T extends SpatialSurface>(surface: T, { vertex }: RigidContext): T {
    surface.sample = () => {
      const grid = this.sample();
      return { u: [...grid.u], v: [...grid.v], vertices: grid.vertices.map(row => row.map(vertex)) };
    };
    return surface;
  }

  protected override copyTransformed(context: RigidContext): SpatialSurface {
    return this.transformedSamples(new SpatialSurface({ at: (u, v) => context.vertex(this.at(u, v)),
      boundaryLoops: this.boundaryLoops.map(loop => loop.map(context.map)), sides: this.transformedSides(context),
      periodicU: this.periodicU, periodicV: this.periodicV, reversed: this.reversed, poles: this.poles.map(context.vertex) }), context);
  }

  /** Infer a side's native boundary direction, including loops with identical endpoints. */
  private sideReversed(side: keyof SurfaceSides): boolean {
    const cached = this.directions.get(side);
    if (cached !== undefined) return cached;
    const boundary = this.sides[side]!;
    const at = (t: number) => side === 'u0' ? this.at(0, t) : side === 'u1' ? this.at(1, t)
      : side === 'v0' ? this.at(t, 0) : this.at(t, 1);
    const probes = boundary.isLoop() ? [0.25, 0.75] : [0, 1];
    const error = (reversed: boolean) => probes.reduce((sum, t) => sum
      + vec3.squaredDistance(at(t).position, boundary.at(reversed ? 1 - t : t).position), 0);
    const reversed = error(true) < error(false);
    this.directions.set(side, reversed);
    return reversed;
  }

  protected override prepare(context: Tessellation): void {
    const link = (a: keyof SurfaceSides, b: keyof SurfaceSides) => {
      if (this.sides[a] && this.sides[b]) context.link(this.sides[a]!, this.sides[b]!, this.sideReversed(a) !== this.sideReversed(b));
    };
    link('u0', 'u1'); link('v0', 'v1');
    const parameters = (side: keyof SurfaceSides) => this.sides[side] ? context.parameters(this.sides[side]!)
      .map(t => this.sideReversed(side) ? 1 - t : t) : [];
    const samples = this.sample();
    this.grid = sampleSurface(this, [...samples.u, ...parameters('v0'), ...parameters('v1')],
      [...samples.v, ...parameters('u0'), ...parameters('u1')]);
    for (const side of ['v0', 'v1', 'u0', 'u1'] as const) if (this.sides[side]) {
      const values = side[0] === 'v' ? this.grid.u : this.grid.v;
      context.request(this.sides[side]!, values.map(t => this.sideReversed(side) ? 1 - t : t));
    }
  }

  protected override mesh(context: Tessellation): Float32Array {
    const grid = this.grid ?? this.sample(), { u, v } = grid;
    const points = grid.vertices.map(row => [...row]);
    const vertices = (side: keyof SurfaceSides) => {
      const points = [...context.vertices(this.sides[side]!)];
      return this.sideReversed(side) ? points.reverse() : points;
    };
    if (this.sides.u0) points[0] = vertices('u0');
    if (this.sides.u1) points[u.length - 1] = vertices('u1');
    for (const [side, j] of [['v0', 0], ['v1', v.length - 1]] as const) {
      if (this.sides[side]) vertices(side).forEach((point, i) => { points[i][j] = point; });
    }
    if (this.periodicU) points[u.length - 1] = points[0];
    if (this.periodicV) for (const row of points) row[v.length - 1] = row[0];
    const positions = new Float32Array((u.length - 1) * (v.length - 1) * 18);
    let offset = 0;
    for (let i = 0; i + 1 < u.length; i++) for (let j = 0; j + 1 < v.length; j++) {
      const corners = [points[i][j], points[i + 1][j], points[i + 1][j + 1], points[i][j + 1]];
      const indices = this.reversed ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (let k = 0; k < indices.length; k += 3) {
        const triangle = indices.slice(k, k + 3).map(index => corners[index].position);
        // A regular surface can have collapsed parameter sides (sphere poles or
        // spherical corner tips). Emit a fan there, rather than zero-area quads.
        const [a, b, c] = triangle.map(point => Array.from(point, Math.fround));
        const cross = [0, 1, 2].map(i => {
          const j = (i + 1) % 3, l = (i + 2) % 3;
          return (b[j] - a[j]) * (c[l] - a[l]) - (b[l] - a[l]) * (c[j] - a[j]);
        });
        if (cross.every(value => value === 0)) continue;
        for (const point of triangle) { positions.set(point, offset); offset += 3; }
      }
    }
    return positions.slice(0, offset);
  }
}

/**
 * Create a mathematical surface without replacing it with a mesh.
 *
 * Accepts the evaluator function directly, or an options object for boundaries and surface settings.
 *
 * Constructor shorthand for `new SpatialSurface(options)`; returns a new {@link SpatialSurface} instance.
 * @param options - Evaluator, physical boundary loops, parameter sides, periodicity, and orientation.
 * @remarks Sides agree with at() using t or 1-t. Periodic seams are not boundaries.
 * Use trimSurface for supported geometric cuts, or TrimmedSurface for an explicit retained chart.
 */
export function spatialSurface(options: ((u: number, v: number) => Vertex) | {
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
  /** Singular vertices, such as sphere poles; defaults to none. */
  poles?: readonly Vertex[];
}): SpatialSurface { return new SpatialSurface(options); }
