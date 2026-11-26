import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import { RuledSurface } from '../RuledSurface.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface, type SurfaceSides } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import { TrimmedSurface } from '../TrimmedSurface.js';
import type { Vertex } from '../Vertex.js';
import { sliceSpatialCurve } from './curveTrimming.js';
import { assembleFaces } from './trimFace.js';
import { orientLoop } from './boundaryLoops.js';
import { parameterizedSamples } from './curveSamples.js';

export type BooleanPatch = { surface: Surface; reverse: boolean };

/** Equality at supplied sample parameters respects oscillatory sampling overrides. */
export function sameBooleanBoundary(a: SpatialBoundary, b: SpatialBoundary, reversed: boolean, tolerance: number): boolean {
  if ((a instanceof Edge) !== (b instanceof Edge)) return false;
  if (vec3.distance(a.start.position, (reversed ? b.end : b.start).position) > tolerance
    || vec3.distance(a.end.position, (reversed ? b.start : b.end).position) > tolerance) return false;
  if (a instanceof Edge) return true;
  if (![0.125, 0.25, 0.5, 0.75, 0.875].every(t => vec3.distance(a.at(t).position, b.at(reversed ? 1 - t : t).position) <= tolerance)) return false;
  return parameterizedSamples(a).every(({ t, point }) => vec3.distance(point.position, b.at(reversed ? 1 - t : t).position) <= tolerance)
    && parameterizedSamples(b).every(({ t, point }) => vec3.distance(point.position, a.at(reversed ? 1 - t : t).position) <= tolerance);
}

/** Sew mathematical patch boundaries, never a triangle soup. */
export function booleanTopology(patches: readonly BooleanPatch[], tolerance: number): Surface[] {
  const vertices: Vertex[] = [], boundaries: SpatialBoundary[] = [], replacements = new Map<SpatialBoundary, { boundary: SpatialBoundary; reversed: boolean }>();
  const weld = (point: Vertex): Vertex => {
    const found = vertices.find(vertex => vec3.distance(vertex.position, point.position) <= tolerance);
    if (found) return found;
    vertices.push(point); return point;
  };
  const replace = (original: SpatialBoundary) => {
    let replacement = replacements.get(original);
    if (replacement) return replacement;
    const start = weld(original.start), end = weld(original.end);
    const normalized = start === original.start && end === original.end ? original : sliceSpatialCurve(original, 0, 1, start, end);
    for (const boundary of boundaries) for (const reversed of [false, true]) if (sameBooleanBoundary(normalized, boundary, reversed, tolerance)) {
      replacement = { boundary, reversed }; replacements.set(original, replacement); return replacement;
    }
    boundaries.push(normalized); replacement = { boundary: normalized, reversed: false };
    replacements.set(original, replacement); return replacement;
  };
  // Surface side metadata fixes increasing parameter order; faces can use either direction.
  for (const { surface } of patches) if (surface instanceof SpatialSurface) for (const boundary of surface.boundaries) replace(boundary);
  for (const { surface } of patches) for (const boundary of surface.boundaries) replace(boundary);
  const ids = new Map<Vertex, number>();
  for (const vertex of vertices) ids.set(vertex, ids.size);
  const edges = new Map<string, Edge>();
  const edge = (a: Vertex, b: Vertex): Edge => {
    const key = [ids.get(a), ids.get(b)].sort((x, y) => x! - y!).join(',');
    let result = edges.get(key);
    if (!result) { result = new Edge({ start: a, end: b }); edges.set(key, result); }
    return result;
  };
  for (const boundary of boundaries) if (boundary instanceof Edge) {
    const key = [ids.get(boundary.start), ids.get(boundary.end)].sort((a, b) => a! - b!).join(',');
    edges.set(key, boundary);
  }
  const split = new Map<SpatialBoundary, SpatialBoundary[]>();
  for (const boundary of boundaries) {
    if (!(boundary instanceof Edge)) { split.set(boundary, [boundary]); continue; }
    const direction = vec3.subtract([0, 0, 0], boundary.end.position, boundary.start.position), length2 = vec3.squaredLength(direction);
    const interior = vertices.flatMap(vertex => {
      const t = vec3.dot(vec3.subtract([0, 0, 0], vertex.position, boundary.start.position), direction) / length2;
      return t > 1e-9 && t < 1 - 1e-9 && vec3.distance(vertex.position, vec3.lerp([0, 0, 0], boundary.start.position, boundary.end.position, t)) <= tolerance
        ? [{ t, vertex }] : [];
    }).sort((a, b) => a.t - b.t);
    const points = [boundary.start, ...interior.map(item => item.vertex), boundary.end];
    split.set(boundary, points.slice(0, -1).map((point, i) => edge(point, points[i + 1])));
  }
  const output: Surface[] = [];
  for (const { surface, reverse } of patches) {
    const loops = surface.boundaryLoops.map(loop => orientLoop(loop).flatMap(({ boundary, reversed }) => {
      const mapped = replace(boundary), pieces = split.get(mapped.boundary)!;
      return reversed !== mapped.reversed ? [...pieces].reverse() : pieces;
    }));
    if (surface instanceof Face) {
      const frame = surface.plane;
      const plane = reverse ? new Plane({ a: frame.origin, b: vec3.add([0, 0, 0], frame.origin, frame.xAxis),
        c: vec3.subtract([0, 0, 0], frame.origin, frame.yAxis) }) : frame;
      output.push(new Face({ outer: loops[0], holes: loops.slice(1), plane }));
      continue;
    }
    if (!(surface instanceof SpatialSurface)) throw new RangeError('Boolean encountered an unsupported surface class');
    const sides: SurfaceSides = {};
    for (const [key, original] of Object.entries(surface.sides)) {
      if (!original) continue;
      const mapped = replace(original);
      if (mapped.reversed || split.get(mapped.boundary)!.length !== 1) throw new RangeError('Boolean surface sewing needs unsupported side reparameterization or multiple charts');
      sides[key as keyof SurfaceSides] = mapped.boundary;
    }
    const unchanged = surface.boundaries.every(boundary => replace(boundary).boundary === boundary);
    if (unchanged && !reverse) { output.push(surface); continue; }
    const reversed = reverse ? !surface.reversed : surface.reversed;
    if (surface instanceof RuledSurface) {
      const start = replace(surface.start).boundary;
      const end = 'position' in surface.end ? weld(surface.end) : replace(surface.end).boundary;
      if (sides.u0 && (!(sides.u0 instanceof Edge) || !(sides.u1 instanceof Edge))) throw new RangeError('Boolean ruled-side sewing requires straight edges');
      output.push(new RuledSurface({ start, end, sides: sides.u0 ? [sides.u1 as Edge, sides.u0 as Edge] : undefined, reversed }));
    } else output.push(new TrimmedSurface({ surface, at: (u, v) => ({ x: u, y: v }), sides, boundaryLoops: loops, reversed }));
  }
  return mergeCoplanarFaces(output, tolerance);
}

/** Remove duplicate planar patches and cancel shared interior subdivisions. */
export function mergeCoplanarFaces(output: readonly Surface[], tolerance: number): Surface[] {
  const boundaryIds = new Map<SpatialBoundary, number>();
  const id = (boundary: SpatialBoundary) => {
    if (!boundaryIds.has(boundary)) boundaryIds.set(boundary, boundaryIds.size);
    return boundaryIds.get(boundary)!;
  };
  const groups: Face[][] = [], spatial: Surface[] = [];
  for (const surface of output) {
    if (!(surface instanceof Face)) { spatial.push(surface); continue; }
    let group = groups.find(faces => vec3.dot(faces[0].plane.normal, surface.plane.normal) > 1 - 1e-10
      && Math.abs(vec3.dot(vec3.subtract([0, 0, 0], surface.plane.origin, faces[0].plane.origin), surface.plane.normal)) <= tolerance);
    if (!group) { group = []; groups.push(group); }
    const key = surface.boundaries.map(id).sort((a, b) => a - b).join(',');
    if (!group.some(face => face.boundaries.map(id).sort((a, b) => a - b).join(',') === key)) group.push(surface);
  }
  return [...groups.flatMap(group => {
    // Coplanar components meeting only at a vertex remain separate faces.
    // Only shared edges connect regions that can be merged into one contour.
    const remaining = new Set(group), components: Face[][] = [];
    while (remaining.size) {
      const component = [remaining.values().next().value!]; remaining.delete(component[0]);
      for (let i = 0; i < component.length; i++) for (const candidate of remaining) {
        if (candidate.boundaries.some(boundary => component[i].boundaries.includes(boundary))) {
          component.push(candidate); remaining.delete(candidate);
        }
      }
      components.push(component);
    }
    return components.flatMap(group => {
      if (group.length === 1) return group;
      const counts = new Map<SpatialBoundary, number>();
      for (const face of group) for (const boundary of face.boundaries) counts.set(boundary, (counts.get(boundary) ?? 0) + 1);
      if ([...counts.values()].some(count => count > 2)) throw new RangeError('Boolean has overlapping coplanar regions');
      return assembleFaces([...counts].filter(([, count]) => count === 1).map(([boundary]) => boundary), group[0]);
    });
  }), ...spatial];
}
