/**
 * Sketch-based CAD math objects, extrusion, and reusable boundary topology.
 *
 * @remarks
 * Sketch coordinates are local to a plane; solid vertex positions are in world
 * space. Triangulation returns non-indexed XYZ triangle positions suitable for
 * WebGL. Solids are memoized scene graph nodes and can be added directly to
 * scenes and transform nodes.
 *
 * @packageDocumentation
 */
export { Node, node } from './Node.js';
export { Memo, memo } from './Memo.js';
export { TransformMat4, transformMat4Node } from './TransformMat4.js';
export { Transform, transform } from './Transform.js';
export { functionalize } from './util/functionalize.js';
export { transformMat4 } from './util/transformMat4.js';
export { PI, radtodeg, degtorad } from './util/angles.js';
export type { Point } from './Point.js';
export { Line, line } from './Line.js';
export { LineSegment, lineSegment } from './LineSegment.js';
export { Circle, circle } from './Circle.js';
export { PlanarCurve, planarCurve } from './PlanarCurve.js';
export type { PlanarLoop } from './PlanarLoop.js';
export { Plane, plane } from './Plane.js';
export { Sketch, sketch, type SketchElement } from './Sketch.js';
export type { Vertex } from './Vertex.js';
export { Edge, edge } from './Edge.js';
export { Face, face } from './Face.js';
export { Solid, solid } from './Solid.js';
export { extrudeAlongCurve } from './operations/extrudeAlongCurve.js';
export { extrude } from './operations/extrude.js';
export type { SpatialBoundary } from './SpatialBoundary.js';
export { SpatialCurve, spatialCurve } from './SpatialCurve.js';
export { Surface } from './Surface.js';
export { RuledSurface, ruledSurface } from './RuledSurface.js';
export { SpatialSurface, spatialSurface, type SurfaceSides } from './SpatialSurface.js';
export { TRIANGULATION_RESOLUTION } from './triangulation.js';
export { X, Y, Z } from './defaults/axes.js';
export { XY, ZX, YZ } from './defaults/planes.js';
