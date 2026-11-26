import type { SpatialLine } from './SpatialLine.js';
import { rotate } from './operations/rotate.js';
import { displace } from './operations/displace.js';
import { Memo } from './Memo.js';
import { round } from './operations/round.js';
import { chamfer } from './operations/chamfer.js';
import { intersect } from './operations/intersect.js';
import { difference } from './operations/difference.js';
import { union } from './operations/union.js';
import { extrudeCut } from './operations/extrudeCut.js';
import type { ReadonlyVec3 } from 'gl-matrix';
import type { Sketch } from './Sketch.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { Surface } from './Surface.js';
import type { Vertex } from './Vertex.js';
import { rigidCopies } from './internal/rigidContext.js';
import { TransformMat4 } from './TransformMat4.js';
import type { BoundarySelector } from './operations/searchBoundaries.js';
import { forgetSolidMesh, solidMesh } from './internal/solidMesh.js';

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
   *
   * Accepts a surface array directly, or an options object containing surfaces.
   *
   * @param options - Surfaces to retain; the input array is shallow-copied.
   */
  constructor(options: readonly Surface[] | { surfaces: readonly Surface[] }) {
    const { surfaces } = 'surfaces' in options ? options : { surfaces: options };
    super();
    this.surfaces = [...surfaces];
    this.boundaries = [...new Set(surfaces.flatMap(surface => surface.boundaries))];
    this.vertices = [...new Set(surfaces.flatMap(surface => surface.vertices))];
  }

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
   *
   * Accepts a displacement vector directly, or an options object containing vector.
   *
   * @param options.vector - XYZ displacement in model units, without normalization.
   * @see {@link displace}
   */
  displace(options: ReadonlyVec3 | {
    /** Finite XYZ displacement in model units. */
    vector: ReadonlyVec3;
  }): this { return displace({ object: this, vector: 'vector' in options ? options.vector : options }); }

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
   * Accepts the radius directly, or an options object.
   * @param options.radius - Positive tangent-round radius; defaults to 0.5 model units.
   * @param options.boundaries - Indices, boundary objects, planar faces, or predicates
   * resolved by {@link searchBoundaries}, as one selector or a list; omitted or [] means all.
   * @returns A new solid retaining child node identities in a fresh array.
   * @throws {@link RangeError} for invalid options or unsupported/unresolved rounds.
   * @see {@link round}
   */
  round(options: number | {
    /** Positive radius in model units; defaults to 0.5. */
    radius?: number;
    /** One selector or a mixed list resolved by searchBoundaries; omitted or [] means all. */
    boundaries?: BoundarySelector | readonly BoundarySelector[];
  } = {}): Solid { return round({ ...(typeof options === 'number' ? { radius: options } : options), solid: this }); }

  /**
   * Return the shared volume of this solid and the tool, leaving both unchanged.
   *
   * Accepts the tool solid directly, or an options object containing tool.
   *
   * @param options.tool - Second solid; only each operand's own surfaces participate.
   * @returns A new solid retaining this solid's child nodes in a fresh array.
   * @throws {@link RangeError} for invalid inputs or unsupported/unresolved intersections.
   * @see {@link intersect}
   */
  intersect(options: Solid | {
    /** Second operand; never mutated. */
    tool: Solid;
  }): Solid { return intersect({ solid: this, tool: options instanceof Solid ? options : options.tool }); }

  /**
   * Return this solid with the tool's volume removed, leaving both unchanged.
   *
   * Accepts the tool solid directly, or an options object containing tool.
   *
   * @param options.tool - Cutting solid; its child nodes do not participate.
   * @returns A new solid retaining this solid's child nodes in a fresh array.
   * @throws {@link RangeError} for invalid inputs or unsupported/unresolved intersections.
   * @see {@link difference}
   */
  difference(options: Solid | {
    /** Cutting solid; never mutated. */
    tool: Solid;
  }): Solid { return difference({ solid: this, tool: options instanceof Solid ? options : options.tool }); }

  /**
   * Unite this solid with the tool, preserving disconnected components as one solid.
   * Accepts a tool solid directly, or an options object containing tool.
   * @param options.tool - Second solid; child nodes do not participate in geometry.
   * @returns A new solid retaining this solid's children in a fresh child array.
   * @throws {@link RangeError} for invalid inputs or nonmanifold/unresolved results.
   * @see {@link union}
   */
  union(options: Solid | {
    /** Solid whose material is added; never mutated. */
    tool: Solid;
  }): Solid { return union({ solid: this, tool: options instanceof Solid ? options : options.tool }); }

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

  /** Invalidate both memoized triangles and any mesh retained during operation validation. */
  override refresh(): void { forgetSolidMesh(this); super.refresh(); }

  protected override triangulateUncached(): Float32Array {
    const own = solidMesh(this) ?? Surface.triangulateAll(this.surfaces), children = super.triangulateUncached();
    const positions = new Float32Array(own.length + children.length);
    positions.set(own); positions.set(children, own.length);
    return positions;
  }
}

/**
 * Collect surfaces and their shared analytic boundary topology.
 *
 * Accepts a surface array directly, or an options object containing surfaces.
 *
 * Constructor shorthand for `new Solid(options)`; returns a new {@link Solid} instance.
 *
 * @param options - Surfaces to retain; the input array is shallow-copied.
 */
export function solid(options: readonly Surface[] | {
  /** Planar faces and spatial surfaces, retaining their identities. */
  surfaces: readonly Surface[];
}): Solid { return new Solid(options); }
