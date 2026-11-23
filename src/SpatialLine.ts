import { rotate } from './operations/rotate.js';
import { displace } from './operations/displace.js';
import type { ReadonlyVec3, vec3 } from 'gl-matrix';
import { validateVertex } from './Vertex.js';

/**
 * A world-space line whose three array components are its direction vector.
 * @remarks
 * gl-matrix vec3 is an array type, not a runtime class. This Array subclass is
 * compatible with vec3 operations and extrusion axes, with an additional origin.
 * Direction is not normalized. Straight extrusion ignores the origin;
 * rotational extrusion and rotation use both origin and direction.
 */
export class SpatialLine extends Array<number> {
  /** Copied world-space origin; defaults to [0, 0, 0]. */
  readonly origin: vec3;

  /**
   * Create an infinite line from a direction and optional origin.
   * @param options - Finite nonzero direction and finite origin; both arrays are copied.
   * @throws {@link RangeError} if coordinates are nonfinite or direction is zero.
   */
  constructor({ direction, origin = [0, 0, 0] }: { direction: ReadonlyVec3; origin?: ReadonlyVec3 }) {
    validateVertex({ position: direction }); validateVertex({ position: origin });
    if (direction[0] === 0 && direction[1] === 0 && direction[2] === 0) throw new RangeError('A spatial line needs a nonzero direction');
    super(direction[0], direction[1], direction[2]);
    this.origin = [origin[0], origin[1], origin[2]];
  }

  /**
   * Return a new rotated spatial line; leave this object unchanged.
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
   * Return a new displaced spatial line; leave this object unchanged.
   * Accepts a displacement vector directly, or an options object containing vector.
   *
   * @param options.vector - XYZ displacement in model units, without normalization.
   * @see {@link displace}
   */
  displace(options: ReadonlyVec3 | {
    /** Finite XYZ displacement in model units. */
    vector: ReadonlyVec3;
  }): this { return displace({ object: this, vector: 'vector' in options ? options.vector : options }); }

  /** Array methods such as map and slice return ordinary arrays. */
  static get [Symbol.species](): ArrayConstructor { return Array; }
}

/**
 * Create an infinite line from a direction and optional origin.
 *
 * Constructor shorthand for `new SpatialLine(options)`; returns a new {@link SpatialLine} instance.
 *
 * @param options - Finite nonzero direction and finite origin; both arrays are copied.
 * @throws {@link RangeError} if coordinates are nonfinite or direction is zero.
 */
export function spatialLine(options: {
  /** Finite, nonzero XYZ direction; copied without normalizing. */
  direction: ReadonlyVec3;
  /** Finite world-space origin; copied, defaults to [0, 0, 0]. */
  origin?: ReadonlyVec3;
}): SpatialLine { return new SpatialLine(options); }
