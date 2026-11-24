import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import type { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import { orientLoop } from './boundaryLoops.js';
import { boundaryPlacement } from './surfaceRails.js';
import { UnsupportedRoundError } from './roundUnsupported.js';
import { RoundTopology, spherical, sub, type RoundRail } from './roundTopology.js';
import { solve3 } from './surfaceGeometry.js';

/** Signed rolling-ball blends of planar edges, with convex/concave spherical corners. */
export function roundPlanes(solid: Solid, selected: readonly Edge[], radius: number, topology: RoundTopology): Surface[] {
  if (!selected.length) return [...solid.surfaces];
  const edges = solid.boundaries.filter(boundary => boundary instanceof Edge);
  const chosen = new Set(selected), tolerance = topology.tolerance;
  const adjoining = (edge: SpatialBoundary): Face[] => {
    const surfaces = solid.surfaces.filter(surface => surface.boundaries.includes(edge));
    if (surfaces.length !== 2 || !surfaces.every(surface => surface instanceof Face)) {
      throw new UnsupportedRoundError('Round at an open straight edge requires two adjoining planar faces; curved corner trimming is required');
    }
    return surfaces;
  };
  const senses = new Map<Edge, number>();
  for (const edge of selected) {
    const [a, b] = adjoining(edge);
    const direction = vec3.normalize([0, 0, 0], sub(edge.end.position, edge.start.position));
    const inward = boundaryPlacement(a, edge).inward(a.plane.toLocal(edge.start), direction);
    const side = vec3.dot(inward, b.plane.normal);
    if (Math.abs(side) < 1e-8) throw new RangeError('Round requires a sharp regular boundary');
    senses.set(edge, side < 0 ? 1 : -1);
  }
  const corners = new Map<Vertex, { faces: Face[]; edges: Edge[]; selected: Edge[]; center: Vertex; sense: number }>();
  for (const vertex of solid.vertices) {
    const incident = solid.boundaries.filter(edge => edge.start === vertex || edge.end === vertex), selections = incident.filter((edge): edge is Edge => edge instanceof Edge && chosen.has(edge));
    if (!selections.length) continue;
    const surfaces = solid.surfaces.filter(face => face.vertices.includes(vertex));
    if (incident.length !== 3 || surfaces.length !== 3 || selections.length === 2) {
      throw new UnsupportedRoundError('Round corners require one selected edge or all three edges of a regular three-face corner');
    }
    if (!incident.every(edge => edge instanceof Edge) || !surfaces.every(surface => surface instanceof Face)) {
      throw new UnsupportedRoundError('Round at a mixed straight/curved corner requires curved corner trimming');
    }
    const sense = senses.get(selections[0])!;
    if (selections.some(edge => senses.get(edge) !== sense)) throw new UnsupportedRoundError('Round at mixed convex/concave junctions requires corner intersection trimming');
    const offsetFaces = new Set(selections.flatMap(adjoining));
    if (selections.length === 1) {
      const cap = surfaces.find(face => !offsetFaces.has(face))!;
      if ([...offsetFaces].some(face => Math.abs(vec3.dot(face.plane.normal, cap.plane.normal)) > 1e-8)) {
        throw new UnsupportedRoundError('Round ending at an oblique face requires curved end trimming');
      }
    }
    const normals = surfaces.map(face => face.plane.normal);
    const delta = solve3([normals[0][0], normals[1][0], normals[2][0]], [normals[0][1], normals[1][1], normals[2][1]],
      [normals[0][2], normals[1][2], normals[2][2]], surfaces.map(face => offsetFaces.has(face) ? -radius * sense : 0) as vec3);
    corners.set(vertex, { faces: surfaces, edges: incident, selected: selections, sense,
      center: topology.vertex(vec3.add([0, 0, 0], vertex.position, delta as vec3)) });
  }
  const rails = new Map<SpatialBoundary, Map<Face, RoundRail>>(), ends = new Map<Vertex, Map<SpatialBoundary, RoundRail>>();
  const rounded: Surface[] = [];
  const contact = (vertex: Vertex, face: Face) => topology.vertex(vec3.scaleAndAdd([0, 0, 0], corners.get(vertex)!.center.position, face.plane.normal, radius * corners.get(vertex)!.sense));
  for (const edge of selected) {
    const [a, b] = adjoining(edge), ca = corners.get(edge.start)!.center, cb = corners.get(edge.end)!.center;
    if (vec3.dot(sub(cb.position, ca.position), sub(edge.end.position, edge.start.position)) < -tolerance) {
      throw new RangeError('Round radius consumes an edge beyond its convergence');
    }
    const evaluate = (u: number, v: number): Vertex => ({ position: vec3.scaleAndAdd([0, 0, 0],
      vec3.lerp([0, 0, 0], ca.position, cb.position, u), spherical(a.plane.normal, b.plane.normal, v), radius * senses.get(edge)!) });
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
    if (!corner) return vertex;
    const selectedEdge = corner.selected[0];
    const face = adjoining(edge).find(face => adjoining(selectedEdge).includes(face));
    if (!face) throw new RangeError('Round cannot resolve an unselected corner edge');
    return contact(vertex, face);
  };
  const unselected = new Map<SpatialBoundary, RoundRail>();
  for (const edge of edges) if (!chosen.has(edge) && (corners.has(edge.start) || corners.has(edge.end))) {
    const start = endpoint(edge, edge.start), end = endpoint(edge, edge.end);
    unselected.set(edge, topology.rail(t => ({ position: vec3.lerp([0, 0, 0], start.position, end.position, t) }), undefined, true));
  }
  const retained: Surface[] = [];
  for (const face of solid.surfaces) {
    if (!face.boundaries.some(boundary => rails.has(boundary) || unselected.has(boundary))) {
      retained.push(face); continue;
    }
    if (!(face instanceof Face)) throw new RangeError('Round end trims reach a curved surface; curved corner trimming is required');
    const loops = face.boundaryLoops.map(loop => {
      const pieces = orientLoop(loop).map(({ boundary, reversed }) => {
        const rail = rails.get(boundary)?.get(face) ?? unselected.get(boundary);
        if (!rail) return { boundary, start: reversed ? boundary.end : boundary.start,
          end: reversed ? boundary.start : boundary.end, corner: reversed ? boundary.start : boundary.end };
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
    const patch = topology.patch((u, v) => ({ position: vec3.scaleAndAdd([0, 0, 0], corner.center.position, normal(u, v), radius * corner.sense) }),
      { v0: arc(a, b), u0: arc(a, c), u1: arc(b, c), v1: { at: () => pole } }, normal);
    if (patch) rounded.push(patch);
  }
  return [...retained, ...rounded];
}
