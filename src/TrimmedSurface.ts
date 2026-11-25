import type { Point } from './Point.js';
import { SpatialSurface, type SurfaceSides } from './SpatialSurface.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import type { RigidContext } from './internal/rigidContext.js';
import { vec3 } from 'gl-matrix';

/**
 * A mathematical trim of a spatial surface, retaining its original evaluator.
 *
 * @remarks
 * A parameter chart maps [0, 1]² into the retained region of the source surface.
 * Its four sides can be curved in source parameter space. Periodic directions
 * permit annular trims without adding physical seam edges. The chart must be
 * regular and agree with its supplied physical boundaries. Regions needing
 * several charts must be split into patches; trimming never substitutes a mesh
 * for the original surface.
 */
export class TrimmedSurface extends SpatialSurface {
  /** Original mathematical surface, retained without mutation. */
  readonly surface: SpatialSurface;
  private readonly chart: (u: number, v: number) => Point;

  /** Create a trim from a parameter chart and shared physical boundary topology. */
  constructor({ surface, at, boundaryLoops, sides, periodicU = surface.periodicU,
    periodicV = surface.periodicV, reversed = surface.reversed }: {
    surface: SpatialSurface;
    at: (u: number, v: number) => Point;
    boundaryLoops: readonly (readonly SpatialBoundary[])[];
    sides: SurfaceSides;
    periodicU?: boolean;
    periodicV?: boolean;
    reversed?: boolean;
  }) {
    super({ at: (u, v) => {
      const point = at(u, v);
      return surface.at(surface.periodicU ? (point.x % 1 + 1) % 1 : point.x,
        surface.periodicV ? (point.y % 1 + 1) % 1 : point.y);
    }, boundaryLoops, sides, periodicU, periodicV, reversed });
    this.surface = surface;
    this.chart = at;
  }

  /** Evaluate the retained region's chart in the source surface's parameter space. */
  parameters(u: number, v: number): Point {
    if (![u, v].every(t => Number.isFinite(t) && t >= 0 && t <= 1)) throw new RangeError('Trim parameters must be in [0, 1]');
    return this.chart(u, v);
  }

  /** Apply the chart's chain rule without differencing world-space surface normals. */
  override derivatives(u: number, v: number): { du: vec3; dv: vec3 } {
    const uv = this.chart(u, v), source = this.surface.derivatives(uv.x, uv.y);
    const derivative = (axis: number) => {
      const t = axis ? v : u, low = Math.max(0, t - 1e-5), high = Math.min(1, t + 1e-5);
      const a = axis ? this.chart(u, low) : this.chart(low, v), b = axis ? this.chart(u, high) : this.chart(high, v);
      return vec3.scaleAndAdd([0, 0, 0], vec3.scale([0, 0, 0], source.du, (b.x - a.x) / (high - low)),
        source.dv, (b.y - a.y) / (high - low));
    };
    return { du: derivative(0), dv: derivative(1) };
  }

  protected override copyTransformed(context: RigidContext): TrimmedSurface {
    return this.transformedSamples(new TrimmedSurface({ surface: context.map(this.surface), at: (u, v) => this.parameters(u, v),
      boundaryLoops: this.boundaryLoops.map(loop => loop.map(context.map)), sides: this.transformedSides(context),
      periodicU: this.periodicU, periodicV: this.periodicV, reversed: this.reversed }), context);
  }
}

/**
 * Create a trim from a parameter chart and shared physical boundary topology.
 *
 * Constructor shorthand for `new TrimmedSurface(options)`; returns a new {@link TrimmedSurface} instance.
 *
 * @param options - Source surface, parameter chart, shared boundaries, and optional periodicity/orientation.
 */
export function trimmedSurface(options: {
  /** Original mathematical surface, retained without mutation. */
  surface: SpatialSurface;
  /** Map [0, 1]² to the retained source parameter region. */
  at: (u: number, v: number) => Point;
  /** Physical trim loops, without periodic seams. */
  boundaryLoops: readonly (readonly SpatialBoundary[])[];
  /** Shared physical parameter-domain sides, agreeing with the chart. */
  sides: SurfaceSides;
  /** Defaults to the source's U periodicity. */
  periodicU?: boolean;
  /** Defaults to the source's V periodicity. */
  periodicV?: boolean;
  /** Defaults to the source's orientation. */
  reversed?: boolean;
}): TrimmedSurface { return new TrimmedSurface(options); }
