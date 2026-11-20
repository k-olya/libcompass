import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import type { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import { orientLoop } from './boundaryLoops.js';

type Cut = { normal: ReadonlyVec3; origin: ReadonlyVec3 };
const sub = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.subtract([0, 0, 0], a, b);

/** Analytic clipping planes for convex, straight edges between planar faces. */
export function chamferPlanes(solid: Solid, selections: readonly SpatialBoundary[], length: number, angleRAD: number): Cut[] {
  const tolerance = length * 1e-8;
  return selections.map(boundary => {
    const adjacent = solid.surfaces.filter(surface => surface.boundaries.includes(boundary));
    if (!(boundary instanceof Edge) || adjacent.length !== 2 || !adjacent.every(surface => surface instanceof Face)) {
      throw new RangeError('An open chamfer boundary must be a straight edge between two planar faces; curved corner trimming is required');
    }
    const [a, b] = adjacent as Face[];
    const cosine = Math.max(-1, Math.min(1, vec3.dot(a.plane.normal, b.plane.normal)));
    const turnRAD = Math.acos(cosine), interiorRAD = Math.PI - turnRAD;
    if (turnRAD < 1e-8 || turnRAD > Math.PI - 1e-8 || angleRAD >= turnRAD - 1e-8) {
      throw new RangeError('Chamfer angle must be smaller than the angle between the outward face normals');
    }
    // The edge must support the whole solid on its material side. A global
    // clipping plane cannot represent a local cut at a concave corner.
    for (const surface of [a, b]) if (solid.boundaries.some(edge => edge.sample().some(vertex =>
      vec3.dot(sub(vertex.position, boundary.start.position), surface.plane.normal) > tolerance))) {
      throw new RangeError('Chamfer at a nonconvex straight corner requires local intersection trimming');
    }
    const inward = vec3.scale([0, 0, 0], vec3.subtract([0, 0, 0],
      vec3.scale([0, 0, 0], a.plane.normal, cosine), b.plane.normal), 1 / Math.sin(turnRAD));
    const ratio = Math.sin(interiorRAD + angleRAD) / Math.sin(angleRAD);
    const normal = vec3.normalize([0, 0, 0], vec3.scaleAndAdd([0, 0, 0], b.plane.normal, a.plane.normal, ratio));
    return { normal, origin: vec3.scaleAndAdd([0, 0, 0], boundary.start.position, inward, length) };
  });
}

/** Clip exact boundary topology, sharing every intersection edge and vertex. */
export function clipChamferPlanes(input: readonly Surface[], cuts: readonly Cut[], length: number): Surface[] {
  let surfaces = [...input];
  const tolerance = Math.max(1e-10, length * 1e-8);
  const ids = new Map<Vertex, number>(), edges = new Map<string, Edge>();
  const id = (vertex: Vertex) => {
    if (!ids.has(vertex)) ids.set(vertex, ids.size);
    return ids.get(vertex)!;
  };
  const key = (a: Vertex, b: Vertex) => [id(a), id(b)].sort((x, y) => x - y).join(',');
  for (const surface of input) for (const boundary of surface.boundaries) {
    if (boundary instanceof Edge) edges.set(key(boundary.start, boundary.end), boundary);
  }
  const edge = (a: Vertex, b: Vertex): Edge => {
    const k = key(a, b);
    let result = edges.get(k);
    if (!result) { result = new Edge({ start: a, end: b }); edges.set(k, result); }
    return result;
  };
  for (const cut of cuts) {
    const distance = (vertex: Vertex) => vec3.dot(sub(vertex.position, cut.origin), cut.normal);
    const intersections = new Map<SpatialBoundary, Vertex>(), cap = new Set<Vertex>();
    const crossing = (boundary: SpatialBoundary): Vertex => {
      let vertex = intersections.get(boundary);
      if (vertex) return vertex;
      const a = distance(boundary.start), b = distance(boundary.end);
      vertex = Math.abs(a) <= tolerance ? boundary.start : Math.abs(b) <= tolerance ? boundary.end
        : { position: vec3.lerp([0, 0, 0], boundary.start.position, boundary.end.position, a / (a - b)) };
      intersections.set(boundary, vertex);
      cap.add(vertex);
      return vertex;
    };
    const clip = (loop: readonly SpatialBoundary[]): SpatialBoundary[] => {
      const pieces: { boundary: SpatialBoundary; start: Vertex; end: Vertex }[] = [];
      for (const { boundary, reversed } of orientLoop(loop)) {
        const start = reversed ? boundary.end : boundary.start, end = reversed ? boundary.start : boundary.end;
        if (!(boundary instanceof Edge)) {
          if (boundary.sample().some(vertex => distance(vertex) > tolerance)) {
            throw new RangeError('A straight chamfer intersects a curved trim; surface intersection trimming is required');
          }
          pieces.push({ boundary, start, end });
          continue;
        }
        const a = distance(start), b = distance(end), insideA = a <= tolerance, insideB = b <= tolerance;
        if (insideA && insideB) {
          pieces.push({ boundary, start, end });
          if (Math.abs(a) <= tolerance) cap.add(start);
          if (Math.abs(b) <= tolerance) cap.add(end);
        } else if (insideA !== insideB) {
          const point = crossing(boundary), from = insideA ? start : point, to = insideB ? end : point;
          if (from !== to) pieces.push({ boundary: edge(from, to), start: from, end: to });
        }
      }
      return pieces.flatMap((piece, i) => {
        const next = pieces[(i + 1) % pieces.length];
        return piece.end === next.start ? [piece.boundary] : [piece.boundary, edge(piece.end, next.start)];
      });
    };
    const next: Surface[] = [];
    for (const surface of surfaces) {
      if (!(surface instanceof Face)) {
        if (!(surface instanceof SpatialSurface) || surface.sample().vertices.some(row => row.some(vertex => distance(vertex) > tolerance))) {
          throw new RangeError('A straight chamfer crosses a curved surface; surface intersection trimming is required');
        }
        next.push(surface);
        continue;
      }
      // Holes may remain exact curves, but cannot merge with an outer trim.
      if (surface.holes.some(loop => loop.some(boundary => boundary.sample().some(vertex => distance(vertex) > tolerance)))) {
        throw new RangeError('Chamfer overlaps a hole; trim-loop intersection is required');
      }
      const outer = clip(surface.outer);
      if (!outer.length) throw new RangeError('Chamfer length consumes a face; use a smaller length');
      const unchanged = outer.length === surface.outer.length && outer.every((boundary, i) => boundary === surface.outer[i]);
      next.push(unchanged ? surface : new Face({ outer, holes: surface.holes, plane: surface.plane }));
    }
    if (cap.size < 3) throw new RangeError('Chamfer length is too large or the selected boundary was consumed');
    const center: vec3 = [0, 0, 0];
    for (const point of cap) vec3.add(center, center, point.position);
    vec3.scale(center, center, 1 / cap.size);
    const x = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], Math.abs(cut.normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], cut.normal));
    const y = vec3.cross([0, 0, 0], cut.normal, x);
    const points = [...cap].sort((a, b) => Math.atan2(vec3.dot(sub(a.position, center), y), vec3.dot(sub(a.position, center), x))
      - Math.atan2(vec3.dot(sub(b.position, center), y), vec3.dot(sub(b.position, center), x)));
    const plane = new Plane({ a: center, b: vec3.add([0, 0, 0], center, x), c: vec3.add([0, 0, 0], center, y) });
    next.push(new Face({ outer: points.map((point, i) => edge(point, points[(i + 1) % points.length])), plane }));
    surfaces = next;
  }
  return surfaces;
}
