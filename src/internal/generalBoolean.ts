import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import type { Point } from '../Point.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { SurfaceRegion, type SurfaceTrim } from '../SurfaceRegion.js';
import { SpatialSurface } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import type { Solid } from '../Solid.js';
import type { BooleanMesh } from './booleanMesh.js';
import { parameterizedSamples, sampleParameter } from './curveSamples.js';
import { ParametricPatch, type PatchPath } from './parametricPatch.js';
import { patchArrangement, type ArrangementArc, type ArrangementRegion } from './patchArrangement.js';
import { surfaceIntersections } from './surfaceIntersections.js';
import { assembleFaces } from './trimFace.js';

type Interval = { start: number; end: number };
type Piece = Interval & { boundary: SpatialBoundary; parameter: (t: number) => number; local: (t: number) => number };
function intervals(arcs: readonly ArrangementArc[]): Map<SpatialBoundary, Interval[]> {
  const groups = new Map<SpatialBoundary, Interval[]>();
  for (const arc of arcs) groups.set(arc.path.boundary, [...groups.get(arc.path.boundary) ?? [], { start: arc.start, end: arc.end }]);
  for (const [curve, values] of groups) {
    const merged: Interval[] = [];
    for (const value of values.sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && value.start <= last.end + 1e-8) last.end = Math.max(last.end, value.end);
      else merged.push({ ...value });
    }
    groups.set(curve, merged);
  }
  return groups;
}
/** Closest parameter refines sampled candidates against the original curve. */
function curveParameter(curve: SpatialBoundary, point: ReadonlyVec3): number {
  const samples = parameterizedSamples(curve); let best = 0, error = Infinity;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], direction = vec3.subtract([0, 0, 0], b.point.position, a.point.position);
    const fraction = Math.max(0, Math.min(1, vec3.dot(vec3.subtract([0, 0, 0], point, a.point.position), direction) / vec3.squaredLength(direction)));
    const d = vec3.squaredDistance(vec3.lerp([0, 0, 0], a.point.position, b.point.position, fraction), point);
    if (d < error) { error = d; best = a.t + (b.t - a.t) * fraction; }
  }
  for (let i = 0; i < 20; i++) {
    const low = Math.max(0, best - 1e-6), high = Math.min(1, best + 1e-6);
    const derivative = vec3.scale([0, 0, 0], vec3.subtract([0, 0, 0], curve.at(high).position, curve.at(low).position), 1 / (high - low));
    const delta = vec3.dot(vec3.subtract([0, 0, 0], point, curve.at(best).position), derivative) / vec3.squaredLength(derivative);
    best = Math.max(0, Math.min(1, best + delta)); if (Math.abs(delta) < 1e-12) break;
  }
  return best;
}
function loops(boundaries: readonly SpatialBoundary[]): SpatialBoundary[][] {
  const remaining = new Set(boundaries), result: SpatialBoundary[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!, loop = [first]; remaining.delete(first);
    let vertex = first.end;
    while (vertex !== first.start) {
      const adjacent = [...remaining].filter(boundary => boundary.start === vertex || boundary.end === vertex);
      if (adjacent.length !== 1) throw new RangeError('Boolean trims cannot be sewn into manifold boundary loops');
      const next = adjacent[0]; remaining.delete(next); loop.push(next); vertex = next.start === vertex ? next.end : next.start;
    }
    result.push(loop);
  }
  return result;
}

/** General B-rep partitioning. Meshes discover/classify; retained curves and surfaces remain evaluators. */
export function generalBoolean(solid: Solid, tool: Solid, operation: 'intersect' | 'difference', a: BooleanMesh, b: BooleanMesh, tolerance: number): Surface[] {
  const sourceBounds = [...solid.surfaces, ...tool.surfaces].flatMap(source => {
    const surface = source instanceof SurfaceRegion ? source.surface : source;
    if (!(surface instanceof SpatialSurface)) return [];
    const points = surface.sample().vertices.flat();
    return [{ min: [0, 1, 2].map(i => points.reduce((min, point) => Math.min(min, point.position[i]), Infinity)), max: [0, 1, 2].map(i => points.reduce((max, point) => Math.max(max, point.position[i]), -Infinity)) }];
  });
  const extent = [a.bounds, b.bounds, ...sourceBounds].flatMap(bounds => [0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k => [i ? bounds.max[0] : bounds.min[0], j ? bounds.max[1] : bounds.min[1], k ? bounds.max[2] : bounds.min[2]] as [number, number, number]))));
  const left = solid.surfaces.map(surface => new ParametricPatch(surface, extent)), right = tool.surfaces.map(surface => new ParametricPatch(surface, extent));
  const paths = new Map<ParametricPatch, PatchPath[]>();
  for (const patch of [...left, ...right]) paths.set(patch, []);
  const addPath = (patch: ParametricPatch, path: PatchPath): void => {
    if ([...patch.paths, ...paths.get(patch)!].some(existing => existing.physical && existing.boundary === path.boundary)) return;
    paths.get(patch)!.push(path);
  };
  const projected = (patch: ParametricPatch, boundary: SpatialBoundary): PatchPath => {
    const stations = parameterizedSamples(boundary).map(({ t, point }) => ({ t, uv: patch.project(point.position) }));
    for (let i = 1; i < stations.length; i++) {
      const uv = stations[i].uv;
      stations[i].uv = { x: uv.x + (patch.surface.periodicU ? Math.round(stations[i - 1].uv.x - uv.x) : 0), y: uv.y + (patch.surface.periodicV ? Math.round(stations[i - 1].uv.y - uv.y) : 0) };
    }
    return { boundary, physical: true, at: t => {
      const i = Math.max(0, stations.findIndex((s, i) => i + 1 < stations.length && t >= s.t && t <= stations[i + 1].t));
      const first = stations[i], last = stations[Math.min(i + 1, stations.length - 1)], fraction = (t - first.t) / (last.t - first.t);
      const initial = { x: first.uv.x + (last.uv.x - first.uv.x) * fraction, y: first.uv.y + (last.uv.y - first.uv.y) * fraction };
      return patch.project(boundary.at(t).position, initial);
    } };
  };
  for (const first of left) for (const second of right) {
    if (first.source instanceof Face && second.source instanceof Face && Math.abs(vec3.dot(first.source.plane.normal, second.source.plane.normal)) > 1 - 1e-10) {
      if (Math.abs(vec3.dot(vec3.subtract([0, 0, 0], first.source.plane.origin, second.source.plane.origin), first.source.plane.normal)) <= tolerance) {
        for (const [target, source] of [[first, second], [second, first]]) for (const boundary of source.source.boundaries) addPath(target, projected(target, boundary));
      }
      continue;
    }
    for (const curve of surfaceIntersections(first, second, tolerance)) {
      // An existing rim is already the exact intersection; reuse its identity and sampling.
      const existing = [...first.source.boundaries, ...second.source.boundaries, ...first.surface.boundaries, ...second.surface.boundaries].find(boundary => curve.isLoop() === boundary.isLoop()
        && parameterizedSamples(curve).every(({ point }) => vec3.distance(point.position, boundary.at(curveParameter(boundary, point.position)).position) <= tolerance));
      const rims = existing ? [...new Set([first, second].filter(patch => patch.source.boundaries.includes(existing) || patch.surface.boundaries.includes(existing)).flatMap(patch => patch.source.boundaries.filter(boundary =>
        parameterizedSamples(boundary).every(({ point }) => vec3.distance(point.position, existing.at(curveParameter(existing, point.position)).position) <= tolerance)) ))] : [];
      for (const [patch, offset] of [[first, 0], [second, 2]] as const) {
        if (existing) {
          for (const boundary of rims) addPath(patch, projected(patch, boundary));
        } else addPath(patch, { boundary: curve, physical: true, at: t => { const q = curve.parameters(t); return { x: q[offset], y: q[offset + 1] }; } });
      }
    }
  }
  const retained: { patch: ParametricPatch; regions: ArrangementRegion[]; intervals: Map<SpatialBoundary, Interval[]>; reverse: boolean }[] = [];
  const coincidentNormal = (patch: ParametricPatch, point: ReadonlyVec3, normal: ReadonlyVec3): ReadonlyVec3 | undefined => {
    if (patch.source instanceof Face && (Math.abs(vec3.dot(patch.source.plane.normal, normal)) < 1 - 1e-9 || Math.abs(vec3.dot(vec3.subtract([0, 0, 0], point, patch.source.plane.origin), patch.source.plane.normal)) > tolerance)) return;
    const uv = patch.project(point);
    if (!patch.contains(uv) || vec3.distance(patch.at(uv).position, point) > tolerance) return;
    const [du, dv] = patch.derivatives(uv), other = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], du, dv));
    if (patch.reversed) vec3.negate(other, other);
    if (Math.abs(vec3.dot(other, normal)) > 1 - 1e-9) return other;
  };
  for (const [patches, analysis, isLeft] of [[left, b, true], [right, a, false]] as const) for (const patch of patches) {
    const arrangement = patchArrangement(patch, paths.get(patch)!);
    const selected = new Set(arrangement.regions.filter(region => {
      if (!patch.contains(region.probe)) return false;
      const point = patch.at(region.probe).position, [du, dv] = patch.derivatives(region.probe), normal = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], du, dv));
      if (patch.reversed) vec3.negate(normal, normal);
      const coincident = (isLeft ? right : left).map(candidate => coincidentNormal(candidate, point, normal)).find(normal => normal !== undefined);
      if (coincident) {
        const same = vec3.dot(coincident, normal) > 0;
        return operation === 'intersect' ? isLeft && same : isLeft && !same;
      }
      const inside = analysis.contains(point); return operation === 'intersect' || !isLeft ? inside : !inside;
    }));
    if (selected.size) retained.push({ patch, regions: [...selected], intervals: intervals(arrangement.boundary(selected)), reverse: operation === 'difference' && !isLeft });
  }
  // Split each shared curve only at real topological events, not at discovery samples or chart seams.
  const cuts = new Map<SpatialBoundary, number[]>();
  for (const patch of retained) for (const [curve, ranges] of patch.intervals) cuts.set(curve, [...cuts.get(curve) ?? [], ...ranges.flatMap(range => [range.start, range.end])]);
  const requested = new Map<SpatialBoundary, number[]>();
  for (const patch of retained) for (const region of patch.regions) for (const arc of [region.outer, ...region.holes].flat()) {
    const curve = arc.path.boundary;
    requested.set(curve, [...(requested.get(curve) ?? []), arc.start, arc.end]);
    if (!cuts.has(curve)) cuts.set(curve, [0, 1]);
  }
  const vertices: Vertex[] = [], canonical: SpatialBoundary[] = [], pieces = new Map<SpatialBoundary, Piece[]>();
  const weld = (point: Vertex): Vertex => {
    const existing = vertices.find(vertex => vec3.distance(vertex.position, point.position) <= tolerance * 4);
    if (existing) return existing; vertices.push(point); return point;
  };
  for (const [curve, values] of cuts) {
    const sorted = [0, ...values, 1].sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > 1e-8), list: Piece[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const start = sorted[i - 1], end = sorted[i];
      const first = weld(start < 1e-10 ? curve.start : curve.at(start)), last = weld(end > 1 - 1e-10 ? curve.end : curve.at(end));
      class Trim extends SpatialCurve {
        override sample(options: { resolution?: number } = {}): Vertex[] {
          const own = super.sample(options).map((point, i, points) => sampleParameter(this, point, i, points.length)!);
          const source = [...parameterizedSamples(curve, options).map(({ t }) => t), ...(requested.get(curve) ?? [])].map(t => (t - start) / (end - start)).filter(t => t > 1e-10 && t < 1 - 1e-10);
          return [...own, ...source].sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > 1e-10).map(t => this.at(t));
        }
      }
      let boundary: SpatialBoundary = curve instanceof Edge ? new Edge({ start: first, end: last }) : new Trim({ at: t => t === 0 ? first : t === 1 ? last : curve.at(start + (end - start) * t), start: first, end: last });
      let parameter = (t: number) => start + (end - start) * t;
      let local = (t: number) => Math.max(0, Math.min(1, (t - start) / (end - start)));
      const existing = canonical.find(other => ((other.start === first && other.end === last) || (other.start === last && other.end === first))
        && parameterizedSamples(boundary).every(({ point }) => vec3.distance(point.position, other.at(curveParameter(other, point.position)).position) <= tolerance));
      if (existing) { boundary = existing; parameter = t => curveParameter(curve, existing.at(t).position); local = t => curveParameter(existing, curve.at(t).position); }
      else canonical.push(boundary);
      list.push({ start, end, boundary, parameter, local });
    }
    pieces.set(curve, list);
  }
  return retained.flatMap<Surface>(({ patch, regions, intervals: ranges, reverse }) => {
    const boundaries = [...new Set([...ranges].flatMap(([curve, ranges]) => (pieces.get(curve) ?? []).filter(piece => ranges.some(range => piece.start >= range.start - 1e-8 && piece.end <= range.end + 1e-8)).map(piece => piece.boundary)))];
    if (patch.source instanceof Face) {
      const frame = patch.source.plane;
      const plane = reverse ? new Plane({ a: frame.origin, b: vec3.add([0, 0, 0], frame.origin, frame.xAxis), c: vec3.subtract([0, 0, 0], frame.origin, frame.yAxis) }) : frame;
      try { return assembleFaces(boundaries, new Face({ outer: patch.source.outer, holes: patch.source.holes, plane })); }
      catch (cause) { throw new RangeError('Boolean could not assemble exact retained planar boundaries', { cause }); }
    }
    const trims = (arcs: ArrangementArc[]): SurfaceTrim[] => arcs.flatMap(arc => {
      const list = pieces.get(arc.path.boundary) ?? [], result: SurfaceTrim[] = [];
      const limits = [...new Set([arc.start, arc.end, ...list.flatMap(piece => [piece.start, piece.end]).filter(t => t > arc.start + 1e-10 && t < arc.end - 1e-10)])].sort((a, b) => a - b);
      for (let i = 1; i < limits.length; i++) {
        const start = limits[i - 1], end = limits[i], piece = list.find(piece => (start + end) / 2 >= piece.start - 1e-10 && (start + end) / 2 <= piece.end + 1e-10);
        if (!piece) result.push({ ...arc.path, start, end, reversed: arc.reversed, physical: false });
        else {
          const first = piece.local(start), last = piece.local(end);
          result.push({ boundary: piece.boundary, start: Math.min(first, last), end: Math.max(first, last), reversed: arc.reversed !== (first > last),
            at: t => arc.path.at(piece.parameter(t)), physical: boundaries.includes(piece.boundary) });
        }
      }
      return arc.reversed ? result.reverse() : result;
    });
    return [new SurfaceRegion({ surface: patch.surface, boundaryLoops: loops(boundaries), reversed: reverse ? !patch.reversed : patch.reversed,
      regions: regions.map(region => ({ outer: trims(region.outer), holes: region.holes.map(trims) })) })];
  });
}
