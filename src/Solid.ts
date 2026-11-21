import type { SpatialLine } from './SpatialLine.js';
import { rotate } from './operations/rotate.js';
import { displace } from './operations/displace.js';
import { Memo } from './Memo.js';
import { round } from './operations/round.js';
import { chamfer } from './operations/chamfer.js';
import { intersect } from './operations/intersect.js';
import { difference } from './operations/difference.js';
import { extrudeCut } from './operations/extrudeCut.js';
import type { ReadonlyVec3 } from 'gl-matrix';
import type { Sketch } from './Sketch.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { Surface } from './Surface.js';
import type { Vertex } from './Vertex.js';
import { rigidCopies } from './internal/rigidContext.js';
import { TransformMat4 } from './TransformMat4.js';
import type { BoundarySelector } from './operations/searchBoundaries.js';
import { annotate } from './operations/annotate.js';
import type { AnnotatedNode } from './AnnotatedNode.js';
import type { AnnotationColor } from './defaults/colors.js';

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
  static {
    rigidCopies.solid = (source, { map }, matrix) => {
      if (!(source instanceof Solid)) return undefined;
      const copy = new Solid({ surfaces: source.surfaces.map(map) });
      copy.children = source.children.map(child => new TransformMat4({ matrix: [...matrix] }).add(child));
      return copy;
    };
  }
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
   * Wrap this solid in a new memoized group with preview annotations.
   * @param options.name - Preview mesh name; omitted names use a hidden mesh1, mesh2, ... counter.
   * @param options.color - Palette name or #RGB/#RRGGBB string; defaults to 'default'.
   * @param options.alpha - Opacity in [0, 1]; defaults to 1.
   * @returns An AnnotatedNode retaining this solid unchanged as its child.
   * @see {@link annotate}
   */
  annotate(options: {
    /** Preview mesh name; omitted names use the hidden mesh1, mesh2, ... counter. */
    name?: string;
    /** Palette name or #RGB/#RRGGBB string; defaults to 'default'. */
    color?: AnnotationColor;
    /** Opacity in [0, 1]; defaults to 1. */
    alpha?: number;
  } = {}): AnnotatedNode { return annotate({ ...options, solid: this }); }

  /**
   * Return a new rotated solid; leave this object unchanged.
   * @param options.axis - Spatial line defining the rotation origin and direction.
   * @param options.angle - Signed right-hand rotation in degrees.
   * @see {@link rotate}
   */
  rotate(options: {
    /** Rotation axis, including its origin. */
    axis: SpatialLine;
    /** Signed rotation in degrees. */
    angle: number;
  }): this { return rotate({ ...options, object: this }); }

  /**
   * Return a new displaced solid; leave this object unchanged.
   * @param options.vector - XYZ displacement in model units, without normalization.
   * @see {@link displace}
   */
  displace(options: {
    /** Finite XYZ displacement in model units. */
    vector: ReadonlyVec3;
  }): this { return displace({ ...options, object: this }); }

  /**
   * Return a new chamfered solid, leaving this solid and its cached mesh unchanged.
   * @param options - Setback, angle, and boundary selectors for this solid.
   * @param options.length - Positive setback on the first adjoining surface in
   * surfaces order; defaults to 0.5 (a chord distance on curved surfaces).
   * @param options.angle - Angle in degrees from that surface toward the material;
   * strictly between 0 and 90, default 45.
   * @param options.boundaries - Indices, boundary objects, planar faces, or predicates
   * resolved by {@link searchBoundaries}, as one selector or a list; omitted or [] means all.
   * @returns A new solid retaining the original child nodes in a new child array.
   * @throws {@link RangeError} for invalid options, oversized bevels, or unresolved intersections.
   * @see {@link chamfer}
   */
  chamfer(options: {
    /** Positive setback on the first adjoining surface; defaults to 0.5. */
    length?: number;
    /** Angle in degrees; defaults to 45. */
    angle?: number;
    /** One selector or a mixed list resolved by searchBoundaries; omitted or [] means all. */
    boundaries?: BoundarySelector | readonly BoundarySelector[];
  } = {}): Solid { return chamfer({ ...options, solid: this }); }

  /**
   * Return a new rounded solid, leaving this solid and its cached mesh unchanged.
   * @param options.radius - Positive tangent-round radius; defaults to 0.5 model units.
   * @param options.boundaries - Indices, boundary objects, planar faces, or predicates
   * resolved by {@link searchBoundaries}, as one selector or a list; omitted or [] means all.
   * @returns A new solid retaining child node identities in a fresh array.
   * @throws {@link RangeError} for invalid options or unsupported/unresolved rounds.
   * @see {@link round}
   */
  round(options: {
    /** Positive radius in model units; defaults to 0.5. */
    radius?: number;
    /** One selector or a mixed list resolved by searchBoundaries; omitted or [] means all. */
    boundaries?: BoundarySelector | readonly BoundarySelector[];
  } = {}): Solid { return round({ ...options, solid: this }); }

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
