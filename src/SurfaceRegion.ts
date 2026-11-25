import type { Point } from './Point.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { SpatialSurface } from './SpatialSurface.js';
import { Surface } from './Surface.js';
import type { Vertex } from './Vertex.js';
import type { Tessellation } from './internal/Tessellation.js';
import { regionMesh } from './internal/regionMesh.js';
import type { RigidContext } from './internal/rigidContext.js';

/** One use of an exact boundary in a surface's parameter space. */
export interface SurfaceTrim {
  /** Shared physical curve, or an internal chart seam. */
  readonly boundary: SpatialBoundary;
  /** Source UV coordinates at the boundary's normalized parameter. */
  readonly at: (t: number) => Point;
  /** Start of the used interval; defaults to zero. */
  readonly start?: number;
  /** End of the used interval; defaults to one. */
  readonly end?: number;
  /** Traverse the interval backwards; defaults to false. */
  readonly reversed?: boolean;
  /** False for an internal parameter seam; defaults to true. */
  readonly physical?: boolean;
}

/** A retained parameter-space polygon with optional holes, bounded by exact curves. */
export interface SurfaceRegionChart {
  readonly outer: readonly SurfaceTrim[];
  readonly holes?: readonly (readonly SurfaceTrim[])[];
}

/**
 * A mathematical surface restricted by arbitrary trim loops, holes and charts.
 * @remarks
 * Unlike a rectangular TrimmedSurface chart, retained regions need not admit a
 * single rectangular parameterization. at(u, v) evaluates the original surface;
 * regions specify the retained subset. Multiple charts can cross periodic seams
 * without adding physical boundaries. Only tessellation approximates geometry.
 */
export class SurfaceRegion extends Surface {
  readonly surface: SpatialSurface;
  readonly regions: readonly SurfaceRegionChart[];
  readonly reversed: boolean;
  private prepared?: Float32Array;

  /**
   * Retain exact parameter trims and explicitly shared physical boundary loops.
   * @param options - Original surface, retained charts, physical loops and orientation.
   */
  constructor({ surface, regions, boundaryLoops, reversed = surface.reversed }: {
    surface: SpatialSurface;
    regions: readonly SurfaceRegionChart[];
    boundaryLoops: readonly (readonly SpatialBoundary[])[];
    reversed?: boolean;
  }) {
    super({ boundaryLoops });
    this.surface = surface; this.regions = [...regions]; this.reversed = reversed;
  }

  /** Evaluate the underlying mathematical surface on [0, 1]², including outside retained trims. */
  at(u: number, v: number): Vertex { return this.surface.at(u, v); }

  /** U periodicity of the original parameter chart. */
  get periodicU(): boolean { return this.surface.periodicU; }
  /** V periodicity of the original parameter chart. */
  get periodicV(): boolean { return this.surface.periodicV; }

  protected override copyTransformed({ map }: RigidContext): SurfaceRegion {
    const trim = (item: SurfaceTrim): SurfaceTrim => ({ ...item, boundary: map(item.boundary) });
    return new SurfaceRegion({ surface: map(this.surface), regions: this.regions.map(chart => ({
      outer: chart.outer.map(trim), holes: chart.holes?.map(hole => hole.map(trim)),
    })), boundaryLoops: this.boundaryLoops.map(loop => loop.map(map)), reversed: this.reversed });
  }

  protected override prepare(context: Tessellation): void { this.prepared = regionMesh(this, context); }
  protected override mesh(context: Tessellation): Float32Array { return this.prepared ?? regionMesh(this, context); }
}

/**
 * Retain exact parameter trims and explicitly shared physical boundary loops.
 * Constructor shorthand for `new SurfaceRegion(options)`.
 * @param options - Original surface, retained charts, physical loops and orientation.
 */
export function surfaceRegion(options: {
  /** Original mathematical surface; never replaced with a mesh. */
  surface: SpatialSurface;
  /** Retained parameter polygons, including holes and periodic chart pieces. */
  regions: readonly SurfaceRegionChart[];
  /** Physical boundary loops; exclude internal chart seams. */
  boundaryLoops: readonly (readonly SpatialBoundary[])[];
  /** Triangle winding; defaults to the source orientation. */
  reversed?: boolean;
}): SurfaceRegion { return new SurfaceRegion(options); }
