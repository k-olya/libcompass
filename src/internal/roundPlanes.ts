import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import type { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import { orientLoop } from './boundaryLoops.js';
import { UnsupportedRoundError } from './roundUnsupported.js';
import { RoundTopology, spherical, sub, unit, type RoundRail } from './roundTopology.js';
import { solve3 } from './surfaceGeometry.js';
import { SurfaceGraph } from './surfaceGraph.js';

type Strip = { edge: Edge; faces: Face[]; sense: number; direction: vec3; center: vec3; at(distance: number, v: number): Vertex };
type Corner = { faces: Face[]; selected: Strip[]; center?: vec3; miter?: vec3; common?: Face; arc?: RoundRail };

/** Exact cylindrical strips, planar end intersections, two-strip miters and spherical junctions. */
export function roundPlanes(solid: Solid, selected: readonly Edge[], radius: number, topology: RoundTopology): Surface[] {
  if (!selected.length) return [...solid.surfaces];
  const graph = new SurfaceGraph(solid.surfaces), strips = new Map<Edge, Strip>(), corners = new Map<Vertex, Corner>();
  topology.retain(graph.boundaries.keys());
  const tolerance = topology.tolerance;
  for (const edge of selected) {
    const adjacent = graph.adjoining(edge);
    if (adjacent.length !== 2 || !adjacent.every(surface => surface instanceof Face)) throw new UnsupportedRoundError('Straight round strips require planar supports; numerical surface contacts are required');
    const faces = adjacent as Face[], [a, b] = faces, direction = unit(sub(edge.end.position, edge.start.position));
    const cosine = vec3.dot(a.plane.normal, b.plane.normal);
    const side = vec3.dot(graph.placement(a, edge).inward(a.plane.toLocal(edge.start), direction), b.plane.normal);
    if (Math.abs(side) < 1e-8 || Math.abs(cosine) >= 1 - 1e-8) throw new RangeError('Round requires a sharp regular boundary');
    const sense = side < 0 ? 1 : -1;
    const center = vec3.scaleAndAdd([0, 0, 0], edge.start.position, vec3.add([0, 0, 0], a.plane.normal, b.plane.normal), -radius * sense / (1 + cosine));
    const strip: Strip = { edge, faces, sense, direction, center, at: (distance, v) => ({ position:
      vec3.scaleAndAdd([0, 0, 0], vec3.scaleAndAdd([0, 0, 0], center, direction, distance), spherical(a.plane.normal, b.plane.normal, v), radius * sense) }) };
    strips.set(edge, strip);
  }
  for (const strip of strips.values()) for (const vertex of [strip.edge.start, strip.edge.end]) {
    if (corners.has(vertex)) continue;
    const surfaces = graph.atVertex(vertex), incident = [...new Set(surfaces.flatMap(face => face.boundaries.filter(boundary => boundary.start === vertex || boundary.end === vertex)))];
    if (incident.length !== 3 || surfaces.length !== 3 || !incident.every(boundary => boundary instanceof Edge) || !surfaces.every(face => face instanceof Face)) {
      throw new UnsupportedRoundError('Round junctions need a regular three-face neighborhood; general corner intersection trimming is required');
    }
    const chosen = incident.flatMap(boundary => strips.has(boundary as Edge) ? [strips.get(boundary as Edge)!] : []), faces = surfaces as Face[];
    if (chosen.some(other => other.sense !== strip.sense)) throw new UnsupportedRoundError('Round at mixed convex/concave junctions requires corner intersection trimming');
    const corner: Corner = { faces, selected: chosen }; corners.set(vertex, corner);
    if (chosen.length === 3) {
      const normals = faces.map(face => face.plane.normal);
      const delta = solve3([normals[0][0], normals[1][0], normals[2][0]], [normals[0][1], normals[1][1], normals[2][1]],
        [normals[0][2], normals[1][2], normals[2][2]], [-radius * strip.sense, -radius * strip.sense, -radius * strip.sense]);
      corner.center = vec3.add([0, 0, 0], vertex.position, delta as vec3);
    } else if (chosen.length === 2) {
      const [first, second] = chosen, common = first.faces.find(face => second.faces.includes(face))!;
      const a = first.faces.find(face => face !== common)!, b = second.faces.find(face => face !== common)!;
      if (Math.abs(vec3.dot(common.plane.normal, a.plane.normal) - vec3.dot(common.plane.normal, b.plane.normal)) > 1e-8) {
        throw new UnsupportedRoundError('Two-edge round junctions with unequal support angles require general strip intersection');
      }
      corner.common = common; corner.miter = unit(sub(a.plane.normal, b.plane.normal));
    }
  }
  const ends = new Map<Edge, RoundRail[]>(), rails = new Map<Edge, Map<Face, RoundRail>>(), rounded: Surface[] = [];
  const distanceAt = (strip: Strip, vertex: Vertex, v: number): number => {
    const corner = corners.get(vertex)!;
    if (corner.center) return vec3.dot(sub(corner.center, strip.center), strip.direction);
    const cap = corner.faces.find(face => !strip.faces.includes(face));
    const normal = corner.miter ?? cap!.plane.normal;
    const denominator = vec3.dot(strip.direction, normal);
    if (Math.abs(denominator) < 1e-10) throw new RangeError('Round end intersection is tangent or unresolved');
    return vec3.dot(sub(vertex.position, strip.at(0, v).position), normal) / denominator;
  };
  const endpoint = (strip: Strip, vertex: Vertex, v: number) => strip.at(distanceAt(strip, vertex, v), v);
  for (const strip of strips.values()) {
    const { edge, faces } = strip;
    const arcs = [edge.start, edge.end].map(vertex => {
      const corner = corners.get(vertex)!;
      if (corner.miter) {
        const reverse = faces[0] !== corner.common;
        if (!corner.arc) corner.arc = topology.rail(t => endpoint(strip, vertex, reverse ? 1 - t : t));
        const arc = corner.arc;
        return { boundary: arc.boundary, at: (t: number) => arc.at(reverse ? 1 - t : t) };
      }
      return topology.rail(t => endpoint(strip, vertex, t));
    });
    ends.set(edge, arcs);
    const evaluate = (u: number, v: number): Vertex => {
      const first = distanceAt(strip, edge.start, v), last = distanceAt(strip, edge.end, v);
      if (last < first - tolerance) throw new RangeError('Round radius consumes an edge beyond its convergence');
      return strip.at(first + (last - first) * u, v);
    };
    const contacts = faces.map((_face, v) => topology.rail(t => evaluate(t, v), undefined, true));
    rails.set(edge, new Map(faces.map((face, i) => [face, contacts[i]])));
    const patch = topology.patch(evaluate, { v0: contacts[0], v1: contacts[1], u0: arcs[0], u1: arcs[1] }, (_u, v) => spherical(faces[0].plane.normal, faces[1].plane.normal, v));
    if (patch) rounded.push(patch);
  }
  const unselected = new Map<SpatialBoundary, RoundRail>();
  const contact = (edge: Edge, vertex: Vertex): Vertex => {
    const corner = corners.get(vertex);
    if (!corner) return vertex;
    if (corner.arc) return corner.arc.at(1);
    const strip = corner.selected[0], face = strip.faces.find(face => graph.adjoining(edge).includes(face))!;
    return rails.get(strip.edge)!.get(face)!.at(strip.edge.start === vertex ? 0 : 1);
  };
  for (const edge of graph.boundaries.keys()) if (edge instanceof Edge && !strips.has(edge) && (corners.has(edge.start) || corners.has(edge.end))) {
    const first = contact(edge, edge.start), last = contact(edge, edge.end);
    if (vec3.dot(sub(last.position, first.position), sub(edge.end.position, edge.start.position)) < -tolerance) throw new RangeError('Round radius consumes an unselected edge');
    unselected.set(edge, topology.rail(t => ({ position: vec3.lerp([0, 0, 0], first.position, last.position, t) }), undefined, true));
  }
  const retained: Surface[] = [];
  for (const surface of solid.surfaces) {
    if (!surface.boundaries.some(boundary => rails.has(boundary as Edge) || unselected.has(boundary))) { retained.push(surface); continue; }
    if (!(surface instanceof Face)) throw new UnsupportedRoundError('Round end trims reach a curved surface; numerical surface contacts are required');
    const loops = surface.boundaryLoops.map(loop => {
      const pieces = orientLoop(loop).map(({ boundary, reversed }) => {
        const rail = rails.get(boundary as Edge)?.get(surface) ?? unselected.get(boundary) ?? { boundary, at: (t: number) => t === 0 ? boundary.start : t === 1 ? boundary.end : boundary.at(t) };
        return { rail, start: rail.at(reversed ? 1 : 0), end: rail.at(reversed ? 0 : 1), vertex: reversed ? boundary.start : boundary.end };
      });
      const boundaries: SpatialBoundary[] = [];
      pieces.forEach((piece, i) => {
        if (piece.rail.boundary) boundaries.push(piece.rail.boundary);
        const next = pieces[(i + 1) % pieces.length];
        if (vec3.distance(piece.end.position, next.start.position) <= tolerance) return;
        const candidates = corners.get(piece.vertex)?.selected.map(strip => ends.get(strip.edge)![strip.edge.start === piece.vertex ? 0 : 1]) ?? [];
        const arc = candidates.find(rail => rail.boundary && [false, true].some(reverse => vec3.distance(rail.at(reverse ? 1 : 0).position, piece.end.position) <= tolerance && vec3.distance(rail.at(reverse ? 0 : 1).position, next.start.position) <= tolerance));
        if (!arc?.boundary) throw new RangeError('Round face trim cannot join its corner rails');
        boundaries.push(arc.boundary);
      });
      return [...new Set(boundaries)];
    });
    const face = topology.face(surface, loops); if (face) retained.push(face);
  }
  for (const [vertex, corner] of corners) if (corner.center) {
    const [a, b, c] = corner.faces, sense = corner.selected[0].sense;
    const normal = (u: number, v: number) => spherical(spherical(a.plane.normal, b.plane.normal, u), c.plane.normal, v);
    const arc = (first: Face, second: Face) => {
      const strip = corner.selected.find(strip => strip.faces.includes(first) && strip.faces.includes(second))!;
      return ends.get(strip.edge)![strip.edge.start === vertex ? 0 : 1];
    };
    const pole = topology.vertex(vec3.scaleAndAdd([0, 0, 0], corner.center, c.plane.normal, radius * sense));
    const patch = topology.patch((u, v) => ({ position: vec3.scaleAndAdd([0, 0, 0], corner.center!, normal(u, v), radius * sense) }),
      { v0: arc(a, b), u0: arc(a, c), u1: arc(b, c), v1: { at: () => pole } }, normal);
    if (patch) rounded.push(patch);
  }
  return [...retained, ...rounded];
}
