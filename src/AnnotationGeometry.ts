import type { Plane } from './Plane.js';
import type { Sketch, SketchElement } from './Sketch.js';
import type { SpatialLine } from './SpatialLine.js';
import type { SpatialCurve } from './SpatialCurve.js';

/**
 * Geometry displayed as lines by annotation-aware hosts, without adding triangles.
 * Standalone planar geometry uses world XY; sketches retain their placement plane.
 * Arrays may be nested, including arrays returned by rectangle() and polyline().
 */
export type AnnotationGeometry = Plane | Sketch | SketchElement | SpatialLine | SpatialCurve | readonly AnnotationGeometry[];
