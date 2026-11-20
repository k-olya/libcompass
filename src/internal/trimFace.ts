import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { Line } from '../Line.js';
import { Plane } from '../Plane.js';
import { PlanarCurve } from '../PlanarCurve.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import type { Point } from '../Point.js';
import { orientLoop } from './boundaryLoops.js';
import { parameterizedSamples } from './curveSamples.js';
import { planarIntersections, uniqueParameters } from './curveIntersections.js';
import { sliceSpatialCurve } from './curveTrimming.js';
import { containsPoint, signedArea, validateLoops } from './polygon.js';

/** Reuse the physical boundary's sampler, including user overrides. */
export function localCurve(boundary: SpatialBoundary, face: Face): PlanarCurve {
  class Local extends PlanarCurve {
    override sample(options: { resolution?: number } = {}): Point[] {
      return parameterizedSamples(boundary, options).map(({ t }) => this.at(t));
    }
  }
  return new Local({ at: t => face.plane.toLocal(boundary.at(t)) });
}

function loopPoints(loop: readonly SpatialBoundary[], face: Face): Point[] {
  return orientLoop(loop).flatMap(({ boundary, reversed }) => {
    const points = boundary.sample().map(vertex => face.plane.toLocal(vertex));
    return (reversed ? points.reverse() : points).slice(0, -1);
  });
}

/** Stitch exact retained boundary pieces, then assign holes and disconnected faces. */
export function assembleFaces(boundaries: SpatialBoundary[], face: Face): Face[] {
  const loops: SpatialBoundary[][] = [], incident = new Map<Vertex, SpatialBoundary[]>();
  for (const boundary of boundaries) {
    if (boundary.isLoop()) { loops.push([boundary]); continue; }
    for (const vertex of [boundary.start, boundary.end]) incident.set(vertex, [...(incident.get(vertex) ?? []), boundary]);
  }
  if ([...incident.values()].some(edges => edges.length !== 2)) throw new RangeError('Trim intersections are tangent, touching or unresolved');
  const unused = new Set(boundaries.filter(boundary => !boundary.isLoop()));
  while (unused.size) {
    const first = unused.values().next().value!, loop = [first];
    unused.delete(first);
    let current = first.end;
    while (current !== first.start) {
      const next = incident.get(current)?.find(boundary => unused.has(boundary));
      if (!next) throw new RangeError('Trim could not close a retained boundary');
      loop.push(next); unused.delete(next);
      current = next.start === current ? next.end : next.start;
    }
    loops.push(loop);
  }
  const polygons = loops.map(loop => loopPoints(loop, face)), areas = polygons.map(loop => Math.abs(signedArea(loop)));
  validateLoops(polygons);
  const parents = polygons.map((polygon, index) => polygons.reduce((parent, other, candidate) => {
    if (areas[candidate] > areas[index] && containsPoint(other, polygon[0]) && (parent === -1 || areas[candidate] < areas[parent])) return candidate;
    return parent;
  }, -1));
  const depth = (index: number): number => parents[index] === -1 ? 0 : depth(parents[index]) + 1;
  return loops.flatMap((outer, index) => depth(index) % 2 ? [] : [new Face({ outer,
    holes: loops.filter((_, candidate) => parents[candidate] === index), plane: face.plane })]);
}

export function trimFace(face: Face, cutter: Plane | PlanarCurve, keep: string): Face[] {
  const polygons = face.boundaryLoops.map(loop => loopPoints(loop, face));
  const inFace = (point: Point) => containsPoint(polygons[0], point) && !polygons.slice(1).some(loop => containsPoint(loop, point));
  let cuttingCurve: PlanarCurve | Line, retain: (point: Point) => boolean;
  if (cutter instanceof Plane) {
    const nx = vec3.dot(cutter.normal, face.plane.xAxis), ny = vec3.dot(cutter.normal, face.plane.yAxis);
    const constant = vec3.dot(vec3.subtract([0, 0, 0], face.plane.origin, cutter.origin), cutter.normal);
    if (Math.hypot(nx, ny) < 1e-12) {
      if (Math.abs(constant) < 1e-10) throw new RangeError('A coincident cutting plane does not select a side');
      return (constant > 0) === (keep === 'positive') ? [new Face({ outer: face.outer, holes: face.holes, plane: face.plane })] : [];
    }
    const length2 = nx * nx + ny * ny;
    cuttingCurve = new Line({ point: { x: -constant * nx / length2, y: -constant * ny / length2 }, direction: [-ny, nx] });
    retain = point => (constant + nx * point.x + ny * point.y > 0) === (keep === 'positive');
  } else {
    if (!cutter.isLoop()) throw new RangeError('A face cutter must be a closed planar curve');
    const polygon = cutter.sample().slice(0, -1);
    validateLoops([polygon]);
    cuttingCurve = cutter;
    retain = point => containsPoint(polygon, point) === (keep === 'inside');
  }
  const vertices = [...face.vertices];
  const extent = Math.max(1, ...polygons.flatMap(loop => loop.flatMap(point => [Math.abs(point.x), Math.abs(point.y)])));
  const weld = (vertex: Vertex): Vertex => {
    const existing = vertices.find(other => vec3.distance(other.position, vertex.position) <= extent * 1e-10);
    if (existing) return existing;
    vertices.push(vertex); return vertex;
  };
  const endpoint = (boundary: SpatialBoundary, t: number) => weld(t === 0 ? boundary.start : t === 1 ? boundary.end : boundary.at(t));
  const cutterCuts: { t: number; vertex: Vertex }[] = [], pieces: SpatialBoundary[] = [];
  const addPiece = (boundary: SpatialBoundary, a: number, b: number, start: Vertex, end: Vertex) => {
    pieces.push(a === 0 && b === 1 && start === boundary.start && end === boundary.end ? boundary : sliceSpatialCurve(boundary, a, b, start, end));
  };
  for (const boundary of face.boundaries) {
    const local = localCurve(boundary, face);
    const hits = planarIntersections(local, cuttingCurve).map(hit => ({ ...hit, vertex: endpoint(boundary, hit.a) }));
    cutterCuts.push(...hits.map(hit => ({ t: hit.b, vertex: hit.vertex })));
    const parameters = uniqueParameters([0, 1, ...hits.map(hit => hit.a)]);
    const vertex = (t: number) => hits.find(hit => Math.abs(hit.a - t) < 1e-9)?.vertex ?? endpoint(boundary, t);
    for (let i = 0; i + 1 < parameters.length; i++) {
      const a = parameters[i], b = parameters[i + 1];
      if (retain(local.at((a + b) / 2))) addPiece(boundary, a, b, vertex(a), vertex(b));
    }
  }
  const cuts = uniqueParameters(cutterCuts.map(hit => hit.t));
  if (cuttingCurve instanceof Line) {
    for (let i = 0; i + 1 < cuts.length; i++) if (inFace(cuttingCurve.at((cuts[i] + cuts[i + 1]) / 2))) {
      const start = cutterCuts.find(hit => Math.abs(hit.t - cuts[i]) < 1e-9)!.vertex;
      const end = cutterCuts.find(hit => Math.abs(hit.t - cuts[i + 1]) < 1e-9)!.vertex;
      pieces.push(new Edge({ start, end }));
    }
  } else {
    const boundary = SpatialCurve.fromPlanarCurve({ curve: cuttingCurve, plane: face.plane });
    const parameters = uniqueParameters([0, 1, ...cuts]);
    const vertex = (t: number) => cutterCuts.find(hit => Math.abs(hit.t - t) < 1e-9)?.vertex ?? endpoint(boundary, t);
    for (let i = 0; i + 1 < parameters.length; i++) {
      const a = parameters[i], b = parameters[i + 1];
      if (inFace(cuttingCurve.at((a + b) / 2))) addPiece(boundary, a, b, vertex(a), vertex(b));
    }
  }
  return assembleFaces(pieces, face);
}
