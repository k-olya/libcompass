import type { ReadonlyVec3 } from 'gl-matrix';
import { Face } from './Face.js';
import type { Line } from './Line.js';
import type { LineSegment } from './LineSegment.js';
import { Plane } from './Plane.js';
import type { PlanarCurve } from './PlanarCurve.js';
import type { Point } from './Point.js';
import type { SpatialCurve } from './SpatialCurve.js';
import { extrudeAlongCurve } from './operations/extrudeAlongCurve.js';
import { extrudeRotate } from './operations/extrudeRotate.js';
import { SpatialLine } from './SpatialLine.js';
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
 * const solid = sketch.extrude({ length: 10 });
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
   * @param elements - Construction geometry, profile boundaries, or arrays of them to append.
   * Arrays are flattened one level; readonly arrays and mixed individual/array arguments are accepted.
   * @returns This sketch for chaining. Profile validity is checked at extrusion.
   */
  add(...elements: (SketchElement | readonly SketchElement[])[]): this {
    for (const element of elements.flat()) this.elements.push(element);
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
   * Sweep filled regions along a smooth spatial curve with transported orientation.
   * Accepts the spatial path directly, or an options object containing curve.
   *
   * @param options - Spatial path; local (0, 0) follows it and its tangent is the sketch normal.
   * @throws {@link RangeError} for unsupported paths or detected folds and intersections.
   * @see {@link extrudeAlongCurve}
   */
  extrudeAlongCurve(options: SpatialCurve | {
    /** Smooth regular spatial path, open or smoothly closed. */
    curve: SpatialCurve;
  }): Solid { return extrudeAlongCurve({ sketch: this, curve: 'curve' in options ? options.curve : options }); }

  /**
   * Rotate filled regions about a coplanar spatial line, preserving their world-space placement.
   * Accepts the axis directly, or an options object with an optional signed angle.
   * @param options.axis - Coplanar rotation line, including its world-space origin.
   * @param options.angle - Signed rotation in degrees, default 360; 0 < abs(angle) <= 360.
   * Profiles may touch the axis: axis edges produce no wall and stationary points become poles.
   * @throws {@link RangeError} for invalid profiles/angles, axis crossing, folds, pinches or intersections.
   * @see {@link extrudeRotate}
   */
  extrudeRotate(options: SpatialLine | {
    /** Rotation axis lying in this sketch's plane. */
    axis: SpatialLine;
    /** Signed rotation in degrees; defaults to a full circle (360). */
    angle?: number;
  }): Solid {
    return extrudeRotate({ sketch: this, ...(options instanceof SpatialLine ? { axis: options } : options) });
  }

  /**
   * Extrude all filled regions, preserving holes and disconnected components.
   *
   * Accepts a signed length directly, or an options object for axis and draft settings.
   *
   * @param options - Signed length and optional world-space axis; curves remain analytic.
   * @param options.axis - Finite, nonzero direction, normalized internally without
   * modifying it; defaults to this sketch's plane normal and must leave the plane.
   * @param options.length - Finite, nonzero length; negative values extrude
   * opposite to the axis. Displacement is `normalize(axis) * length`.
   * @param options.angle - Draft angle in degrees; defaults to zero. Positive
   * expands material and negative contracts it. Length clamps at an apex.
   * Sharp curved joins and intersecting offsets require trimming and are unsupported.
   * @returns An analytic solid snapshot with shared boundaries and surfaces.
   * @throws {@link RangeError} if the axis, length, or profiles are invalid.
   * @see {@link extrude}
   */
  extrude(options: number | {
    /** World-space direction, normalized internally; defaults to this sketch's plane normal. */
    axis?: ReadonlyVec3;
    /** Finite, nonzero signed length; negative values reverse the extrusion. */
    length: number;
    /** Draft angle in degrees; positive expands, negative contracts; defaults to zero. */
    angle?: number;
  }): Solid {
    const { axis, length, angle: angleDEG } = typeof options === 'number' ? { length: options } : options;
    return extrude({ sketch: this, axis, length, angle: angleDEG });
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
