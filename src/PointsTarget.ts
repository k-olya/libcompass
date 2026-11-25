import type { Sketch, SketchElement } from './Sketch.js';

/** Local 2D geometry, a sketch, or nested readonly arrays accepted by points(). */
export type PointsTarget = SketchElement | Sketch | readonly PointsTarget[];
