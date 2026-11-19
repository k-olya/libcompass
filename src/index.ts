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
export { Node } from './Node.js';
export { Memo } from './Memo.js';
export { TransformMat4 } from './TransformMat4.js';
export { Transform } from './Transform.js';
export { functionalize } from './util/functionalize.js';
export { transformMat4 } from './util/transformMat4.js';
export { Point } from './Point.js';
export { Line } from './Line.js';
export { LineSegment } from './LineSegment.js';
export { Circle } from './Circle.js';
export { Plane } from './Plane.js';
export { Sketch, type SketchElement } from './Sketch.js';
export { Vertex } from './Vertex.js';
export { Edge } from './Edge.js';
export { Face } from './Face.js';
export { Solid } from './Solid.js';
export { extrude } from './extrude.js';
