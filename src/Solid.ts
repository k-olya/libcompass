import { Memo } from './Memo.js';
import { chamfer } from './operations/chamfer.js';
import { intersect } from './operations/intersect.js';
import { difference } from './operations/difference.js';
import { extrudeCut } from './operations/extrudeCut.js';
import type { ReadonlyVec3 } from 'gl-matrix';
import type { Sketch } from './Sketch.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { Surface } from './Surface.js';
import type { Vertex } from './Vertex.js';

/**
 * A memoized scene node retaining exact planar and spatial surfaces.
 *
 * @remarks
 * Surfaces share boundaries, endpoints, and singular apex vertices. Tessellation never changes
 * this topology. Shell closure and manifoldness are not validated by this
 * constructor; extrusion builds closed, consistently oriented solids.
 * Triangulation includes own surfaces followed by child nodes and is cached
 * until refresh(). Topology properties exclude children.
 */
export class Solid extends Memo {
  readonly surfaces: readonly Surface[];
  readonly boundaries: readonly SpatialBoundary[];
  readonly vertices: readonly Vertex[];

  /**
   * Collect surfaces and their shared analytic boundary topology.
   * @param options - Surfaces to retain; the input array is shallow-copied.
   */
  constructor({ surfaces }: { surfaces: readonly Surface[] }) {
    super();
    this.surfaces = [...surfaces];
    this.boundaries = [...new Set(surfaces.flatMap(surface => surface.boundaries))];
    this.vertices = [...new Set(surfaces.flatMap(surface => surface.vertices))];
  }

  /**
   * Return a new chamfered solid, leaving this solid and its cached mesh unchanged.
   * @param options - Setback, angle, and indices in this solid's boundaries array.
   * @param options.length - Positive setback on the first adjoining surface in
   * surfaces order; defaults to 0.5 (a chord distance on curved surfaces).
   * @param options.angle - Angle in degrees from that surface toward the material;
   * strictly between 0 and 90, default 45.
   * @param options.boundaries - Boundary indices; omitted or empty means all.
   * @returns A new solid retaining the original child nodes in a new child array.
   * @throws {@link RangeError} for invalid options, oversized bevels, or unresolved intersections.
   * @see {@link chamfer}
   */
  chamfer(options: {
    /** Positive setback on the first adjoining surface; defaults to 0.5. */
    length?: number;
    /** Angle in degrees; defaults to 45. */
    angle?: number;
    /** Indices in this.boundaries; omitted or empty selects all boundaries. */
    boundaries?: readonly number[];
  } = {}): Solid { return chamfer({ ...options, solid: this }); }

  /**
   * Return the shared volume of this solid and the tool, leaving both unchanged.
   * @param options.tool - Second solid; only each operand's own surfaces participate.
   * @returns A new solid retaining this solid's child nodes in a fresh array.
   * @throws {@link RangeError} for invalid inputs or unsupported/unresolved intersections.
   * @see {@link intersect}
   */
  intersect(options: {
    /** Second operand; never mutated. */
    tool: Solid;
  }): Solid { return intersect({ ...options, solid: this }); }

  /**
   * Return this solid with the tool's volume removed, leaving both unchanged.
   * @param options.tool - Cutting solid; its child nodes do not participate.
   * @returns A new solid retaining this solid's child nodes in a fresh array.
   * @throws {@link RangeError} for invalid inputs or unsupported/unresolved intersections.
   * @see {@link difference}
   */
  difference(options: {
    /** Cutting solid; never mutated. */
    tool: Solid;
  }): Solid { return difference({ ...options, solid: this }); }

  /**
   * Extrude a sketch and subtract it from this solid without modifying either.
   * @param options - Cutting sketch, signed length, optional axis and draft angle.
   * @param options.sketch - Closed profiles defining the cutting extrusion.
   * @param options.length - Finite, nonzero signed extrusion length.
   * @param options.axis - Direction normalized internally; defaults to the sketch normal.
   * @param options.angle - Draft angle in degrees, default zero, strictly between -90 and 90.
   * @returns A new solid; equivalent to this.difference({ tool: extrude(options) }).
   * @throws {@link RangeError} for extrusion errors or unsupported/invalid boolean cuts.
   * @see {@link extrudeCut}
   */
  extrudeCut(options: {
    /** Closed cutting profiles on their placement plane. */
    sketch: Sketch;
    /** Signed extrusion length; negative reverses travel. */
    length: number;
    /** Direction normalized internally; defaults to the sketch normal. */
    axis?: ReadonlyVec3;
    /** Draft angle in degrees; defaults to zero. */
    angle?: number;
  }): Solid { return extrudeCut({ ...options, solid: this }); }

  protected override triangulateUncached(): Float32Array {
    const own = Surface.triangulateAll(this.surfaces), children = super.triangulateUncached();
    const positions = new Float32Array(own.length + children.length);
    positions.set(own); positions.set(children, own.length);
    return positions;
  }
}

/**
 * Collect surfaces and their shared analytic boundary topology.
 *
 * Constructor shorthand for `new Solid(options)`; returns a new {@link Solid} instance.
 *
 * @param options - Surfaces to retain; the input array is shallow-copied.
 */
export function solid(options: {
  /** Planar faces and spatial surfaces, retaining their identities. */
  surfaces: readonly Surface[];
}): Solid { return new Solid(options); }
