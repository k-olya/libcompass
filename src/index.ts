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
export { AnnotatedNode, annotatedNode } from './AnnotatedNode.js';
export { annotate } from './operations/annotate.js';
export { TransformMat4, transformMat4Node } from './TransformMat4.js';
export { Transform, transform } from './Transform.js';
export { functionalize } from './util/functionalize.js';
export { transformMat4 } from './util/transformMat4.js';
export { PI, radtodeg, degtorad } from './util/angles.js';
export type { Point } from './Point.js';
export { Line, line } from './Line.js';
export { LineSegment, lineSegment } from './LineSegment.js';
export { roundPolyline } from './operations/roundPolyline.js';
export { polyline } from './operations/polyline.js';
export { rectangle } from './operations/rectangle.js';
export { centerRectangle } from './operations/centerRectangle.js';
export { Circle, circle } from './Circle.js';
export { arc } from './operations/arc.js';
export { ellipse } from './operations/ellipse.js';
export { svgPath } from './operations/svgPath.js';
export { measure, type Measurable, type Measurement, type BoundingBox } from './operations/measure.js';
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
export { round } from './operations/round.js';
export { chamfer } from './operations/chamfer.js';
export { searchBoundaries, type BoundarySelector, type BoundaryPredicate } from './operations/searchBoundaries.js';
export { trimCurve } from './operations/trimCurve.js';
export { trimSurface } from './operations/trimSurface.js';
export { intersect } from './operations/intersect.js';
export { difference } from './operations/difference.js';
export { extrudeCut } from './operations/extrudeCut.js';
export type { SpatialBoundary } from './SpatialBoundary.js';
export { SpatialCurve, spatialCurve } from './SpatialCurve.js';
export { SpatialLine, spatialLine } from './SpatialLine.js';
export type { SpatialObject } from './SpatialObject.js';
export { rotate } from './operations/rotate.js';
export { displace } from './operations/displace.js';
export type { ArrayTarget, ArrayCopy } from './ArrayTarget.js';
export { displacementArray } from './operations/displacementArray.js';
export { rotationArray } from './operations/rotationArray.js';
export { spatialCurveFromPlanar } from './operations/spatialCurveFromPlanar.js';
export { Surface } from './Surface.js';
export { RuledSurface, ruledSurface } from './RuledSurface.js';
export { SpatialSurface, spatialSurface, type SurfaceSides } from './SpatialSurface.js';
export { TrimmedSurface, trimmedSurface } from './TrimmedSurface.js';
export { SurfaceRegion, surfaceRegion, type SurfaceTrim, type SurfaceRegionChart } from './SurfaceRegion.js';
export { TRIANGULATION_RESOLUTION, setTriangulationResolution } from './triangulation.js';
export { X, Y, Z, negX, negY, negZ } from './defaults/axes.js';
export { XY, ZX, YZ } from './defaults/planes.js';
export { center, origin } from './defaults/points.js';
export { colors, type AnnotationColor } from './defaults/colors.js';
