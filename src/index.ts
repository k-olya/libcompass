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
export type { Point } from './Point.js';
export { Line, line } from './Line.js';
export { LineSegment, lineSegment } from './LineSegment.js';
export { Circle, circle } from './Circle.js';
export { Plane, plane } from './Plane.js';
export { Sketch, sketch, type SketchElement } from './Sketch.js';
export type { Vertex } from './Vertex.js';
export { Edge, edge } from './Edge.js';
export { Face, face } from './Face.js';
export { Solid, solid } from './Solid.js';
export { extrude } from './extrude.js';
