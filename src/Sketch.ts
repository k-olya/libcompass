import type { ReadonlyVec3 } from 'gl-matrix';
import { Circle } from './Circle.js';
import { Face } from './Face.js';
import { Line } from './Line.js';
import { LineSegment } from './LineSegment.js';
import { Plane } from './Plane.js';
import { Point } from './Point.js';
import { extrude } from './extrude.js';
import { Solid } from './Solid.js';

/** A drawable sketch entity; points and infinite lines are construction geometry. */
export type SketchElement = Point | Line | LineSegment | Circle;

/**
 * Local 2D drawing geometry placed on a plane in world space.
 *
 * @remarks
 * Closed segment loops and circles define profiles. Nesting uses even-odd fill
 * to distinguish material, holes, and islands; points and infinite lines are
 * construction geometry. Segment endpoints match by exact XY coordinates.
 *
 * @example
 * ```ts
 * const sketch = new Sketch().add(new Circle(new Point(0, 0), 5));
 * const solid = sketch.extrude([0, 0, 10]);
 * ```
 */
export class Sketch {
  /** Mutable drawing entities in insertion order. */
  readonly elements: SketchElement[] = [];

  /**
   * Create an empty sketch.
   *
   * @param plane - Local-to-world frame; defaults to the world XY plane.
   */
  constructor(
    /** Plane placing the sketch in world space. */
    public readonly plane: Plane = new Plane()
  ) {}

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
   * Start a sketch on a face, copying its outer and hole boundaries into segments.
   *
   * @param face - Planar face supplying the frame and boundary coordinates.
   * @returns A new sketch on the same plane with new points and segments;
   * the face's vertex and edge objects are not reused as drawing entities.
   */
  static fromFace(face: Face): Sketch {
    const sketch = new Sketch(face.plane);
    for (const loop of [face.outer, ...face.holes]) {
      const points = loop.map((vertex) => face.plane.toLocal(vertex));
      sketch.add(...points.map((point, i) => new LineSegment(point, points[(i + 1) % points.length])));
    }
    return sketch;
  }

  /**
   * Extrude all filled regions, preserving holes and disconnected components.
   *
   * @param direction - Finite world-space displacement with a nonzero component
   * along the plane normal; its magnitude is not normalized.
   * @param circleSegments - Segments per circle; integer of at least three,
   * defaulting to 64.
   * @returns A new solid snapshot with shared vertices, edges, and outward faces.
   * @throws {@link RangeError} if the direction, resolution, or profiles are
   * invalid, or triangulation fails at the current numeric tolerance.
   * @see {@link extrude}
   */
  extrude(direction: ReadonlyVec3, circleSegments = 64): Solid {
    return extrude(this, direction, circleSegments);
  }
}
