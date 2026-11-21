import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import type { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import { orientLoop } from './boundaryLoops.js';
import { RoundTopology, spherical, sub, type RoundRail } from './roundTopology.js';
import { solve3 } from './surfaceGeometry.js';

/** Rolling-ball blends of convex planar edges, with spherical three-edge corners. */
export function roundPlanes(solid: Solid, selected: readonly SpatialBoundary[], radius: number, topology: RoundTopology): Surface[] {
  if (!selected.length) return [...solid.surfaces];
  if (!solid.surfaces.every(surface => surface instanceof Face) || !solid.boundaries.every(boundary => boundary instanceof Edge)) {
    throw new RangeError('Round at open edges currently requires a convex planar solid');
  }
  const faces = solid.surfaces as readonly Face[], edges = solid.boundaries as readonly Edge[];
  const chosen = new Set(selected), tolerance = topology.tolerance;
  const adjoining = (edge: SpatialBoundary) => faces.filter(face => face.boundaries.includes(edge));
  for (const edge of selected) for (const face of adjoining(edge)) {
    if (edges.some(other => [other.start, other.end].some(point => vec3.dot(sub(point.position, edge.start.position), face.plane.normal) > tolerance))) {
      throw new RangeError('Round at a nonconvex edge requires local rolling-ball intersection trimming');
    }
  }
  const corners = new Map<Vertex, { faces: Face[]; edges: Edge[]; selected: Edge[]; center: Vertex }>();
  for (const vertex of solid.vertices) {
    const incident = edges.filter(edge => edge.start === vertex || edge.end === vertex), selections = incident.filter(edge => chosen.has(edge));
    if (!selections.length) continue;
    const surfaces = faces.filter(face => face.vertices.includes(vertex));
    if (incident.length !== 3 || surfaces.length !== 3 || selections.length === 2) {
      throw new RangeError('Round corners require one selected edge or all three edges of a regular three-face corner');
    }
    const offsetFaces = new Set(selections.flatMap(adjoining));
    if (selections.length === 1) {
      const cap = surfaces.find(face => !offsetFaces.has(face))!;
      if ([...offsetFaces].some(face => Math.abs(vec3.dot(face.plane.normal, cap.plane.normal)) > 1e-8)) {
        throw new RangeError('Round ending at an oblique face requires curved end trimming');
      }
    }
    const normals = surfaces.map(face => face.plane.normal);
    const delta = solve3([normals[0][0], normals[1][0], normals[2][0]], [normals[0][1], normals[1][1], normals[2][1]],
      [normals[0][2], normals[1][2], normals[2][2]], surfaces.map(face => offsetFaces.has(face) ? -radius : 0) as vec3);
    corners.set(vertex, { faces: surfaces, edges: incident, selected: selections,
      center: topology.vertex(vec3.add([0, 0, 0], vertex.position, delta as vec3)) });
  }
  const rails = new Map<SpatialBoundary, Map<Face, RoundRail>>(), ends = new Map<Vertex, Map<SpatialBoundary, RoundRail>>();
  const rounded: Surface[] = [];
  const contact = (vertex: Vertex, face: Face) => topology.vertex(vec3.scaleAndAdd([0, 0, 0], corners.get(vertex)!.center.position, face.plane.normal, radius));
  for (const edge of selected) {
    const [a, b] = adjoining(edge), ca = corners.get(edge.start)!.center, cb = corners.get(edge.end)!.center;
    if (vec3.dot(sub(cb.position, ca.position), sub(edge.end.position, edge.start.position)) < -tolerance) {
      throw new RangeError('Round radius consumes an edge beyond its convergence');
    }
    const evaluate = (u: number, v: number): Vertex => ({ position: vec3.scaleAndAdd([0, 0, 0],
      vec3.lerp([0, 0, 0], ca.position, cb.position, u), spherical(a.plane.normal, b.plane.normal, v), radius) });
    const first = topology.rail(t => ({ position: vec3.lerp([0, 0, 0], contact(edge.start, a).position, contact(edge.end, a).position, t) }), undefined, true);
    const second = topology.rail(t => ({ position: vec3.lerp([0, 0, 0], contact(edge.start, b).position, contact(edge.end, b).position, t) }), undefined, true);
    rails.set(edge, new Map([[a, first], [b, second]]));
    const arcs = [topology.rail(t => evaluate(0, t)), topology.rail(t => evaluate(1, t))];
    [edge.start, edge.end].forEach((vertex, i) => {
      const entries = ends.get(vertex) ?? new Map(); entries.set(edge, arcs[i]); ends.set(vertex, entries);
    });
    const surface = topology.patch(evaluate, { v0: first, v1: second, u0: arcs[0], u1: arcs[1] },
      (_u, v) => spherical(a.plane.normal, b.plane.normal, v));
    if (surface) rounded.push(surface);
  }
  const endpoint = (edge: Edge, vertex: Vertex): Vertex => {
    const corner = corners.get(vertex);
    if (!corner) return topology.vertex(vertex.position);
    const selectedEdge = corner.selected[0];
    const face = adjoining(edge).find(face => adjoining(selectedEdge).includes(face));
    if (!face) throw new RangeError('Round cannot resolve an unselected corner edge');
    return contact(vertex, face);
  };
  const unselected = new Map(edges.filter(edge => !chosen.has(edge)).map(edge => [edge,
    topology.rail(t => ({ position: vec3.lerp([0, 0, 0], endpoint(edge, edge.start).position, endpoint(edge, edge.end).position, t) }), undefined, true)]));
  const retained: Surface[] = [];
  for (const face of faces) {
    const loops = face.boundaryLoops.map(loop => {
      const pieces = orientLoop(loop).map(({ boundary, reversed }) => {
        const rail = rails.get(boundary)?.get(face) ?? unselected.get(boundary as Edge)!;
        return { boundary: rail.boundary, start: rail.at(reversed ? 1 : 0), end: rail.at(reversed ? 0 : 1),
          corner: reversed ? boundary.start : boundary.end };
      });
      const result: SpatialBoundary[] = [];
      pieces.forEach((piece, i) => {
        if (piece.boundary) result.push(piece.boundary);
        const next = pieces[(i + 1) % pieces.length];
        if (vec3.distance(piece.end.position, next.start.position) <= tolerance) return;
        const candidates = [...(ends.get(piece.corner)?.values() ?? [])];
        const arc = candidates.find(rail => rail.boundary &&
          ((vec3.distance(rail.at(0).position, piece.end.position) <= tolerance && vec3.distance(rail.at(1).position, next.start.position) <= tolerance)
          || (vec3.distance(rail.at(1).position, piece.end.position) <= tolerance && vec3.distance(rail.at(0).position, next.start.position) <= tolerance)));
        if (!arc?.boundary) throw new RangeError('Round face trim cannot join its corner rails');
        result.push(arc.boundary);
      });
      // Opposite trims meeting at the radius limit leave a line, not a physical face.
      return [...new Set(result)];
    });
    const surface = topology.face(face, loops);
    if (surface) retained.push(surface);
  }
  for (const [vertex, corner] of corners) if (corner.selected.length === 3) {
    const [a, b, c] = corner.faces, normal = (u: number, v: number) => spherical(spherical(a.plane.normal, b.plane.normal, u), c.plane.normal, v);
    const arc = (first: Face, second: Face) => {
      const edge = corner.selected.find(edge => adjoining(edge).includes(first) && adjoining(edge).includes(second))!;
      return ends.get(vertex)!.get(edge)!;
    };
    const pole = contact(vertex, c);
    const patch = topology.patch((u, v) => ({ position: vec3.scaleAndAdd([0, 0, 0], corner.center.position, normal(u, v), radius) }),
      { v0: arc(a, b), u0: arc(a, c), u1: arc(b, c), v1: { at: () => pole } }, normal);
    if (patch) rounded.push(patch);
  }
  return [...retained, ...rounded];
}
