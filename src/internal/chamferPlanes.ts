import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import type { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import { orientLoop } from './boundaryLoops.js';
import { RoundTopology, sub, unit } from './roundTopology.js';
import { solve3 } from './surfaceGeometry.js';
import { SurfaceGraph } from './surfaceGraph.js';

type Cut = { edge: Edge; faces: Face[]; plane: Plane; sense: number };
const distance = (plane: Plane, point: ReadonlyVec3) => vec3.dot(sub(point, plane.origin), plane.normal);

/**
 * Local planar arrangement at each affected vertex. Bevel planes never clip
 * remote faces or disconnected components. Convex cuts and concave fills share
 * the same contact graph; intersections are sewn before any Face is constructed.
 */
export function chamferPlanar(solid: Solid, selected: readonly Edge[], length: number, angleRAD: number): Surface[] {
  if (!selected.length) return [...solid.surfaces];
  const graph = new SurfaceGraph(solid.surfaces), topology = new RoundTopology(length, solid.vertices), tolerance = topology.tolerance;
  const cuts = new Map<Edge, Cut>(), corners = new Map<Vertex, { faces: Face[]; edges: Edge[]; cuts: Cut[] }>();
  for (const edge of selected) {
    const faces = graph.adjoining(edge);
    if (!faces.every(face => face instanceof Face) || faces.length !== 2) throw new RangeError('Planar bevels require two planar supports');
    const [a, b] = faces as Face[], tangent = unit(sub(edge.end.position, edge.start.position));
    const inward = unit(graph.placement(a, edge).inward(a.plane.toLocal(edge.start), tangent));
    const side = vec3.dot(inward, b.plane.normal);
    if (Math.abs(side) < 1e-8) throw new RangeError('Chamfer requires a sharp regular boundary');
    const sense = side < 0 ? 1 : -1, origin = vec3.scaleAndAdd([0, 0, 0], edge.start.position, inward, length);
    const across = vec3.scaleAndAdd([0, 0, 0], vec3.scale([0, 0, 0], inward, -Math.cos(angleRAD)), a.plane.normal, -sense * Math.sin(angleRAD));
    const divisor = vec3.dot(across, b.plane.normal), travel = -distance(b.plane, origin) / divisor;
    if (!Number.isFinite(travel) || travel <= tolerance) throw new RangeError('Chamfer angle does not cut the adjoining surface');
    const second = vec3.scaleAndAdd([0, 0, 0], origin, across, travel);
    const inwardB = graph.placement(b, edge).inward(b.plane.toLocal(edge.start), tangent);
    if (vec3.dot(sub(second, edge.start.position), inwardB) <= tolerance) throw new RangeError('Chamfer angle leaves the retained surfaces');
    const normal = unit(vec3.cross([0, 0, 0], tangent, across));
    if (vec3.dot(normal, vec3.add([0, 0, 0], a.plane.normal, b.plane.normal)) < 0) vec3.negate(normal, normal);
    const y = vec3.cross([0, 0, 0], normal, tangent);
    cuts.set(edge, { edge, faces: [a, b], sense, plane: new Plane({ a: origin, b: vec3.add([0, 0, 0], origin, tangent), c: vec3.add([0, 0, 0], origin, y) }) });
  }
  for (const edge of selected) for (const vertex of [edge.start, edge.end]) {
    if (corners.has(vertex)) continue;
    const surfaces = graph.atVertex(vertex), edges = [...new Set(surfaces.flatMap(surface => surface.boundaries.filter(boundary => boundary.start === vertex || boundary.end === vertex)))];
    if (surfaces.length !== 3 || edges.length !== 3 || !surfaces.every(surface => surface instanceof Face) || !edges.every(boundary => boundary instanceof Edge)) {
      throw new RangeError('Planar chamfer junctions require a regular three-face neighborhood');
    }
    corners.set(vertex, { faces: surfaces as Face[], edges: edges as Edge[], cuts: edges.flatMap(edge => cuts.has(edge as Edge) ? [cuts.get(edge as Edge)!] : []) });
  }
  const intersection = (a: Plane, b: Plane, c: Plane, vertex: Vertex): Vertex | undefined => {
    const normals = [a.normal, b.normal, c.normal];
    if (Math.abs(vec3.dot(normals[0], vec3.cross([0, 0, 0], normals[1], normals[2]))) < 1e-10) return undefined;
    const delta = solve3([normals[0][0], normals[1][0], normals[2][0]], [normals[0][1], normals[1][1], normals[2][1]],
      [normals[0][2], normals[1][2], normals[2][2]], [-distance(a, vertex.position), -distance(b, vertex.position), -distance(c, vertex.position)]);
    return topology.vertex(vec3.add([0, 0, 0], vertex.position, delta as vec3));
  };
  const candidates = (target: Plane, vertex: Vertex, planes: Plane[], inside: (point: Vertex) => boolean): Vertex[] => {
    const result = new Set<Vertex>();
    for (let i = 0; i < planes.length; i++) for (let j = i + 1; j < planes.length; j++) {
      const point = intersection(target, planes[i], planes[j], vertex);
      if (point && inside(point)) result.add(point);
    }
    if (!result.size) throw new RangeError('Chamfer corner intersections are unresolved or overlapping');
    return [...result];
  };
  const paths = new Map<Face, Map<Vertex, { edges: Edge[]; points: Vertex[] }>>();
  for (const [vertex, corner] of corners) for (const face of corner.faces) {
    const edges = corner.edges.filter(edge => face.boundaries.includes(edge));
    const directions = edges.map(edge => sub((edge.start === vertex ? edge.end : edge.start).position, vertex.position));
    const [d1, d2] = directions, aa = vec3.dot(d1, d1), ab = vec3.dot(d1, d2), bb = vec3.dot(d2, d2), determinant = aa * bb - ab * ab;
    if (determinant < aa * bb * 1e-12) throw new RangeError('Chamfer corner has singular face directions');
    const tangent = unit(sub(edges[0].end.position, edges[0].start.position));
    const inward = graph.placement(face, edges[0]).inward(face.plane.toLocal(vertex), tangent);
    // Reflex face corners retain the complement of the outgoing edge wedge.
    const reflex = vec3.dot(inward, d2) < 0;
    const coordinates = (point: Vertex) => {
      const d = sub(point.position, vertex.position), x = vec3.dot(d, d1), y = vec3.dot(d, d2);
      return [(bb * x - ab * y) / determinant, (aa * y - ab * x) / determinant];
    };
    const points = candidates(face.plane, vertex, [...corner.faces.filter(other => other !== face).map(other => other.plane), ...corner.cuts.map(cut => cut.plane)], point => {
      const [x, y] = coordinates(point);
      const retained = reflex ? x <= 1e-9 || y <= 1e-9 : x >= -1e-9 && y >= -1e-9;
      return retained && corner.cuts.every(cut => cut.sense * distance(cut.plane, point.position) <= tolerance);
    }).sort((a, b) => { const x = coordinates(a), y = coordinates(b); return Math.atan2(x[1], x[0]) - Math.atan2(y[1], y[0]); });
    const entries = paths.get(face) ?? new Map(); entries.set(vertex, { edges, points }); paths.set(face, entries);
  }
  const end = (face: Face, edge: Edge, vertex: Vertex) => {
    const path = paths.get(face)?.get(vertex);
    return !path ? vertex : path.edges[0] === edge ? path.points[0] : path.points.at(-1)!;
  };
  const edgeCache = new Map<Vertex, Map<Vertex, Edge>>();
  for (const boundary of solid.boundaries) if (boundary instanceof Edge) {
    const entries = edgeCache.get(boundary.start) ?? new Map(); entries.set(boundary.end, boundary); edgeCache.set(boundary.start, entries);
  }
  const shared = (a: Vertex, b: Vertex): Edge | undefined => {
    if (a === b) return undefined;
    let edge = edgeCache.get(a)?.get(b) ?? edgeCache.get(b)?.get(a);
    if (!edge) { edge = new Edge({ start: a, end: b }); const entries = edgeCache.get(a) ?? new Map(); entries.set(b, edge); edgeCache.set(a, entries); }
    return edge;
  };
  const chain = (points: Vertex[]) => points.slice(1).flatMap((point, i) => { const edge = shared(points[i], point); return edge ? [edge] : []; });
  const retained = solid.surfaces.flatMap(surface => {
    if (!(surface instanceof Face) || !paths.has(surface)) return [surface];
    const loops = surface.boundaryLoops.map(loop => orientLoop(loop).flatMap(({ boundary, reversed }) => {
      if (!(boundary instanceof Edge)) return [boundary];
      const start = reversed ? boundary.end : boundary.start, finish = reversed ? boundary.start : boundary.end;
      const a = end(surface, boundary, start), b = end(surface, boundary, finish);
      if (vec3.dot(sub(b.position, a.position), sub(finish.position, start.position)) < -tolerance * vec3.distance(start.position, finish.position)) throw new RangeError('Chamfer length consumes an edge or intersects another trim');
      const rail = shared(a, b);
      const path = paths.get(surface)?.get(finish);
      const points = !path ? [] : path.edges[0] === boundary ? path.points : [...path.points].reverse();
      return [...(rail ? [rail] : []), ...chain(points)];
    }));
    const face = topology.face(surface, loops.map(loop => [...new Set(loop)]));
    return face ? [face] : [];
  });
  const bevels = [...cuts.values()].map(cut => {
    const [a, b] = cut.faces;
    const endpointPath = (vertex: Vertex): Vertex[] => {
      const corner = corners.get(vertex)!, cap = corner.faces.find(face => !cut.faces.includes(face))!;
      const toward = sub((cut.edge.start === vertex ? cut.edge.end : cut.edge.start).position, vertex.position);
      const first = end(a, cut.edge, vertex), last = end(b, cut.edge, vertex), across = sub(last.position, first.position);
      // Connected bevels can extend past the old end plane to meet their shared miter.
      const points = candidates(cut.plane, vertex, [...corner.faces.map(face => face.plane), ...corner.cuts.filter(other => other !== cut).map(other => other.plane)], point =>
        cut.faces.every(face => cut.sense * distance(face.plane, point.position) <= tolerance)
        && (corner.cuts.length > 1 || distance(cap.plane, point.position) * vec3.dot(cap.plane.normal, toward) >= -tolerance)
        && corner.cuts.filter(other => other !== cut).every(other => other.sense * distance(other.plane, point.position) <= tolerance));
      points.sort((p, q) => vec3.dot(sub(p.position, q.position), across));
      if (points[0] !== first || points.at(-1) !== last) throw new RangeError('Chamfer corner cannot join its support contacts');
      return points;
    };
    const first = endpointPath(cut.edge.start), last = endpointPath(cut.edge.end);
    const loop = [shared(first[0], last[0])!, ...chain(last), shared(last.at(-1)!, first.at(-1)!)!, ...chain([...first].reverse())];
    return new Face({ outer: loop, plane: cut.plane });
  });
  return [...retained, ...bevels];
}
