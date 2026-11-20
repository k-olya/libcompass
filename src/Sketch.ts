import type { ReadonlyVec3 } from 'gl-matrix';
import { Face } from './Face.js';
import type { Line } from './Line.js';
import type { LineSegment } from './LineSegment.js';
import { Plane } from './Plane.js';
import type { PlanarCurve } from './PlanarCurve.js';
import type { Point } from './Point.js';
import { extrude } from './operations/extrude.js';
import { Solid } from './Solid.js';

/** A drawable sketch entity; points and infinite lines are construction geometry. */
export type SketchElement = Point | Line | LineSegment | PlanarCurve;

/**
 * Local 2D drawing geometry placed on a plane in world space.
 *
 * @remarks
 * Sketches can store any planar curve. Extrusion assembles closed profiles
 * from planar curves and line segments. Nesting uses even-odd fill
 * to distinguish material, holes, and islands; points and infinite lines are
 * construction geometry. Segment endpoints match by exact XY coordinates.
 *
 * @example
 * ```ts
 * const sketch = new Sketch().add(new Circle({ center: { x: 0, y: 0 }, radius: 5 }));
 * const solid = sketch.extrude({ direction: [0, 0, 10] });
 * ```
 */
export class Sketch {
  /** Mutable drawing entities in insertion order. */
  readonly elements: SketchElement[] = [];
  /** Plane placing the sketch in world space. */
  readonly plane: Plane;

  /**
   * Create an empty sketch.
   *
   * @param options - Optional Plane or planar Face; defaults to the world XY plane.
   * @throws {@link TypeError} if the placement is not a Plane or Face.
   */
  constructor({ plane = new Plane() }: { plane?: Plane | Face } = {}) {
    if (!(plane instanceof Plane) && !(plane instanceof Face)) throw new TypeError('A sketch plane must be a Plane or planar Face');
    this.plane = plane instanceof Face ? plane.plane : plane;
  }

  /**
   * Append entities to the drawing.
   *
   * @param elements - Construction geometry or profile boundaries to append.
   * @returns This sketch for chaining. Profile validity is checked at extrusion.
   */
  add(...elements: SketchElement[]): this {
    this.elements.push(...elements);
    return this;
  }

  /**
   * Start an empty sketch on a planar face's plane.
   *
   * @param face - Planar face supplying the placement plane.
   * @returns An empty sketch sharing the face's plane; boundaries are not copied.
   * @throws {@link TypeError} if the surface is not a planar Face.
   */
  static fromFace(face: Face): Sketch {
    if (!(face instanceof Face)) throw new TypeError('Only a planar Face can supply a sketch plane');
    return new Sketch({ plane: face.plane });
  }

  /**
   * Extrude all filled regions, preserving holes and disconnected components.
   *
   * @param options - World-space displacement; curves remain analytic.
   * @param options.direction - Finite world-space displacement with a nonzero component
   * along the plane normal; its magnitude is not normalized.
   * @returns An analytic solid snapshot with shared boundaries and surfaces.
   * @throws {@link RangeError} if the direction or profiles are invalid.
   * @throws {@link TypeError} if a noncircular planar curve is present.
   * @see {@link extrude}
   */
  extrude({ direction }: { direction: ReadonlyVec3 }): Solid {
    return extrude({ sketch: this, direction });
  }
}

/**
 * Create an empty sketch.
 *
 * Constructor shorthand for `new Sketch(options)`; returns a new {@link Sketch} instance.
 *
 * @param options - Optional Plane or planar Face; defaults to the world XY plane.
 * @throws {@link TypeError} if the placement is not a Plane or Face.
 */
export function sketch(options?: {
  /** Placement plane or planar Face; defaults to a new world XY plane. */
  plane?: Plane | Face;
}): Sketch { return new Sketch(options); }
