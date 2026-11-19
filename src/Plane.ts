import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { validatePoint, type Point } from './Point.js';
import { validateVertex, type Vertex } from './Vertex.js';

/**
 * An oriented plane and orthonormal XY frame defined by three noncollinear points.
 *
 * @remarks
 * The first point is the origin. Local X points from the first to the second
 * point, the normal follows `(b - a) × (c - a)`, and local Y completes the
 * right-handed frame. Constructing without arguments gives the world XY plane.
 */
export class Plane {
  /** World-space origin of the local frame. */
  readonly origin: ReadonlyVec3;
  /** Unit local X axis expressed in world coordinates. */
  readonly xAxis: ReadonlyVec3;
  /** Unit local Y axis expressed in world coordinates. */
  readonly yAxis: ReadonlyVec3;
  /** Unit normal expressed in world coordinates. */
  readonly normal: ReadonlyVec3;

  /**
   * Create a plane from vertices or coordinate arrays.
   *
   * @param options - Frame points a (origin), b (local X), and c (orientation).
   * Defaults to the world XY plane; raw coordinate arrays are copied.
   * @throws {@link RangeError} if the coordinates are not finite or the points
   * cannot define a finite, nondegenerate frame.
   */
  constructor({ a = [0, 0, 0], b = [1, 0, 0], c = [0, 1, 0] }: {
    a?: Vertex | ReadonlyVec3; b?: Vertex | ReadonlyVec3; c?: Vertex | ReadonlyVec3;
  } = {}) {
    const [origin, second, third] = [a, b, c].map(value => validateVertex(
      'position' in value ? value : { position: [value[0], value[1], value[2]] },
    ));
    const x = vec3.subtract([0, 0, 0], second.position, origin.position);
    const y = vec3.subtract([0, 0, 0], third.position, origin.position);
    const normal = vec3.cross([0, 0, 0], x, y);
    if (vec3.length(x) === 0 || vec3.length(normal) === 0 || !Number.isFinite(vec3.length(normal))) {
      throw new RangeError('A plane needs three finite, noncollinear points');
    }
    vec3.normalize(x, x);
    vec3.normalize(normal, normal);
    this.origin = origin.position;
    this.xAxis = x;
    this.normal = normal;
    this.yAxis = vec3.cross([0, 0, 0], normal, x);
  }

  /**
   * Map local XY coordinates onto the plane in world space.
   *
   * @param point - Point in the plane's local frame.
   * @returns A new world-space vertex.
   * @throws {@link RangeError} if the resulting coordinates are not finite.
   */
  toWorld(point: Point): Vertex {
    validatePoint(point);
    const position = vec3.scaleAndAdd([0, 0, 0], this.origin, this.xAxis, point.x);
    vec3.scaleAndAdd(position, position, this.yAxis, point.y);
    return validateVertex({ position });
  }

  /**
   * Map an on-plane world point into the local XY frame.
   *
   * @remarks
   * Plane membership uses a distance tolerance of `1e-8 * max(1, distanceFromOrigin)`.
   *
   * @param point - World-space vertex or finite XYZ coordinates.
   * @returns A new point in sketch coordinates.
   * @throws {@link RangeError} if the point is off-plane beyond the tolerance,
   * or its input or resulting coordinates are not finite.
   */
  toLocal(point: Vertex | ReadonlyVec3): Point {
    const position = validateVertex('position' in point ? point : { position: point }).position;
    const offset = vec3.subtract([0, 0, 0], position, this.origin);
    if (Math.abs(vec3.dot(offset, this.normal)) > 1e-8 * Math.max(1, vec3.length(offset))) {
      throw new RangeError('The point is not on this plane');
    }
    return validatePoint({ x: vec3.dot(offset, this.xAxis), y: vec3.dot(offset, this.yAxis) });
  }
}

/**
 * Create a plane from vertices or coordinate arrays.
 *
 * Constructor shorthand for `new Plane(options)`; returns a new {@link Plane} instance.
 *
 * @param options - Frame points a (origin), b (local X), and c (orientation).
 * Defaults to the world XY plane; raw coordinate arrays are copied.
 * @throws {@link RangeError} if the coordinates are not finite or the points
 * cannot define a finite, nondegenerate frame.
 */
export function plane(options?: {
  /** World-space origin; defaults to [0, 0, 0]. Raw coordinate arrays are copied. */
  a?: Vertex | ReadonlyVec3;
  /** Point defining local +X from a; defaults to [1, 0, 0]. Raw coordinate arrays are copied. */
  b?: Vertex | ReadonlyVec3;
  /** Point defining orientation with a and b; defaults to [0, 1, 0]. Raw coordinate arrays are copied. */
  c?: Vertex | ReadonlyVec3;
}): Plane { return new Plane(options); }
