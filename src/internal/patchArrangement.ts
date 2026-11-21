import type { Point } from '../Point.js';
import type { PatchPath, ParametricPatch } from './parametricPatch.js';
import { parameterizedSamples } from './curveSamples.js';
import { containsPoint, signedArea, triangulatePolygon } from './polygon.js';

export type ArrangementArc = { path: PatchPath; start: number; end: number; reversed: boolean };
export type ArrangementRegion = { outer: ArrangementArc[]; holes: ArrangementArc[][]; probe: Point };
type Path = { path: PatchPath; samples: { t: number; point: Point }[] };
type Segment = { path: Path; a: number; b: number; cuts: number[]; min: Point; max: Point };
type Node = { point: Point; outgoing: Half[]; id: number };
type Half = ArrangementArc & { from: Node; to: Node; twin: Half; visited?: boolean; region?: ArrangementRegion };
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const interpolate = (a: number, b: number, t: number) => a + (b - a) * t;
const within = (p: Point, a: Point, b: Point) => p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9 && p.y >= Math.min(a.y, b.y) - 1e-9 && p.y <= Math.max(a.y, b.y) + 1e-9;

/** Polygonal discovery, exact UV root refinement, then a planar half-edge arrangement. */
export function patchArrangement(patch: ParametricPatch, additional: readonly PatchPath[]): {
  regions: ArrangementRegion[]; boundary: (selected: ReadonlySet<ArrangementRegion>) => ArrangementArc[];
} {
  const paths: Path[] = [];
  for (const path of [...patch.paths, ...additional]) {
    const start = path.start ?? 0, end = path.end ?? 1;
    const values = [...new Set([start, ...parameterizedSamples(path.boundary).map(({ t }) => t).filter(t => t > start && t < end), end])].sort((a, b) => a - b);
    const samples = values.map(t => ({ t, point: path.at(t) }));
    const min = { x: Math.min(...samples.map(p => p.point.x)), y: Math.min(...samples.map(p => p.point.y)) };
    const max = { x: Math.max(...samples.map(p => p.point.x)), y: Math.max(...samples.map(p => p.point.y)) };
    const shifts = (axis: 'x' | 'y', periodic: boolean) => periodic
      ? Array.from({ length: Math.floor(1 - min[axis] + 1e-9) - Math.ceil(-max[axis] - 1e-9) + 1 }, (_, i) => Math.ceil(-max[axis] - 1e-9) + i) : [0];
    for (const x of shifts('x', patch.surface.periodicU)) for (const y of shifts('y', patch.surface.periodicV)) {
      const at = (t: number): Point => { const p = path.at(t); return { x: p.x + x, y: p.y + y }; };
      paths.push({ path: { ...path, at }, samples: samples.map(({ t }) => ({ t, point: at(t) })) });
    }
  }
  const segments: Segment[] = paths.flatMap(path => path.samples.slice(0, -1).map(({ t: a, point: p }, i) => {
    const { t: b, point: q } = path.samples[i + 1];
    return { path, a, b, cuts: [a, b], min: { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y) }, max: { x: Math.max(p.x, q.x), y: Math.max(p.y, q.y) } };
  })).filter(s => s.max.x >= -1e-9 && s.min.x <= 1 + 1e-9 && s.max.y >= -1e-9 && s.min.y <= 1 + 1e-9).sort((a, b) => a.min.x - b.min.x);
  const refine = (a: Segment, b: Segment, ta: number, tb: number): number[] => {
    const derivative = (path: PatchPath, t: number) => { const low = Math.max(0, t - 1e-6), high = Math.min(1, t + 1e-6); const p = sub(path.at(high), path.at(low)); return { x: p.x / (high - low), y: p.y / (high - low) }; };
    for (let i = 0; i < 20; i++) {
      const d = sub(a.path.path.at(ta), b.path.path.at(tb)); if (Math.hypot(d.x, d.y) < 1e-11) return [ta, tb];
      const x = derivative(a.path.path, ta), y = derivative(b.path.path, tb), determinant = cross(x, y);
      if (Math.abs(determinant) < 1e-12 * Math.hypot(x.x, x.y) * Math.hypot(y.x, y.y)) break;
      ta = Math.max(0, Math.min(1, ta - cross(d, y) / determinant)); tb = Math.max(0, Math.min(1, tb - cross(d, x) / determinant));
    }
    if (distance(a.path.path.at(ta), b.path.path.at(tb)) > 1e-8) throw new RangeError('Surface trim intersection is tangent or unresolved');
    return [ta, tb];
  };
  for (let i = 0; i < segments.length; i++) for (let j = i + 1; j < segments.length && segments[j].min.x <= segments[i].max.x + 1e-9; j++) {
    const a = segments[i], b = segments[j];
    if (a.max.y < b.min.y - 1e-9 || b.max.y < a.min.y - 1e-9 || a.path === b.path) continue;
    const p = a.path.path.at(a.a), q = a.path.path.at(a.b), r = b.path.path.at(b.a), s = b.path.path.at(b.b);
    const d = sub(q, p), e = sub(s, r), offset = sub(r, p), determinant = cross(d, e);
    if (Math.abs(determinant) > 1e-12 * Math.hypot(d.x, d.y) * Math.hypot(e.x, e.y)) {
      const x = cross(offset, e) / determinant, y = cross(offset, d) / determinant;
      if (x >= -1e-9 && x <= 1 + 1e-9 && y >= -1e-9 && y <= 1 + 1e-9) {
        const [ta, tb] = refine(a, b, interpolate(a.a, a.b, Math.max(0, Math.min(1, x))), interpolate(b.a, b.b, Math.max(0, Math.min(1, y))));
        a.cuts.push(ta); b.cuts.push(tb);
      }
    } else if (Math.abs(cross(offset, d)) <= 1e-9 * Math.hypot(d.x, d.y)) {
      const parameter = (p: Point, first: Point, direction: Point) => ((p.x - first.x) * direction.x + (p.y - first.y) * direction.y) / (direction.x ** 2 + direction.y ** 2);
      for (const [point, t] of [[p, a.a], [q, a.b]] as const) if (within(point, r, s)) { a.cuts.push(t); b.cuts.push(interpolate(b.a, b.b, Math.max(0, Math.min(1, parameter(point, r, e))))); }
      for (const [point, t] of [[r, b.a], [s, b.b]] as const) if (within(point, p, q)) { b.cuts.push(t); a.cuts.push(interpolate(a.a, a.b, Math.max(0, Math.min(1, parameter(point, p, d))))); }
    }
  }
  const nodes: Node[] = [], buckets = new Map<string, Node[]>();
  const node = (point: Point): Node => {
    const x = Math.floor(point.x / 1e-8), y = Math.floor(point.y / 1e-8);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const found = buckets.get(`${x + i},${y + j}`)?.find(n => distance(n.point, point) < 1e-8); if (found) return found;
    }
    const result = { point, outgoing: [], id: nodes.length }, key = `${x},${y}`;
    nodes.push(result); buckets.set(key, [...buckets.get(key) ?? [], result]); return result;
  };
  const halves: Half[] = [], pairs = new Map<string, Half>();
  for (const segment of segments) {
    const values = segment.cuts.sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > 1e-10);
    for (let i = 1; i < values.length; i++) {
      const start = values[i - 1], end = values[i], path = segment.path.path, mid = path.at((start + end) / 2);
      if (mid.x < -1e-9 || mid.x > 1 + 1e-9 || mid.y < -1e-9 || mid.y > 1 + 1e-9) continue;
      const from = node(path.at(start)), to = node(path.at(end)); if (from === to) continue;
      const key = [from.id, to.id].sort((a, b) => a - b).join(','), existing = pairs.get(key);
      if (existing && distance(existing.path.at((existing.start + existing.end) / 2), mid) < 1e-7) {
        if (path.physical && !existing.path.physical) { existing.path = path; existing.start = start; existing.end = end; existing.reversed = existing.from !== from; existing.twin.path = path; existing.twin.start = start; existing.twin.end = end; existing.twin.reversed = !existing.reversed; }
        continue;
      }
      const first = { path, start, end, reversed: false, from, to } as Half, second = { path, start, end, reversed: true, from: to, to: from, twin: first } as Half;
      first.twin = second; from.outgoing.push(first); to.outgoing.push(second); halves.push(first, second); pairs.set(key, first);
    }
  }
  const angleRAD = (half: Half): number => {
    const t = half.reversed ? half.end : half.start, next = half.path.at(t + (half.reversed ? -1 : 1) * Math.min((half.end - half.start) / 10, 1e-5));
    return Math.atan2(next.y - half.from.point.y, next.x - half.from.point.x);
  };
  for (const node of nodes) node.outgoing.sort((a, b) => angleRAD(a) - angleRAD(b));
  const cycles: { arcs: Half[]; polygon: Point[]; area: number }[] = [];
  for (const first of halves) {
    if (first.visited) continue;
    const arcs: Half[] = []; let current = first;
    do {
      if (current.visited) throw new RangeError('Surface trim arrangement cannot close a region');
      current.visited = true; arcs.push(current);
      const outgoing = current.to.outgoing, i = outgoing.indexOf(current.twin);
      current = outgoing[(i + outgoing.length - 1) % outgoing.length];
    } while (current !== first);
    const polygon = arcs.map(arc => arc.from.point), area = signedArea(polygon);
    if (Math.abs(area) > 1e-12) cycles.push({ arcs, polygon, area });
  }
  const positive = cycles.filter(cycle => cycle.area > 0), negative = cycles.filter(cycle => cycle.area < 0);
  const regions: ArrangementRegion[] = positive.map(outer => {
    const holes = negative.filter(hole => {
      const [a, b] = hole.polygon, length = distance(a, b), p = { x: (a.x + b.x) / 2 - (b.y - a.y) / length * 1e-7, y: (a.y + b.y) / 2 + (b.x - a.x) / length * 1e-7 };
      const parent = positive.filter(candidate => containsPoint(candidate.polygon, p)).sort((a, b) => a.area - b.area)[0];
      return parent === outer;
    });
    const polygons = [outer.polygon, ...holes.map(h => h.polygon)], points = polygons.flat();
    let triangles: number[];
    try { triangles = triangulatePolygon(polygons, 1e-14); }
    catch (cause) { throw new RangeError('Surface trim arrangement is tangent, coincident or numerically unresolved', { cause }); }
    let largest = -Infinity, probe = points[0];
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = triangles.slice(i, i + 3).map(index => points[index]), area = Math.abs(cross(sub(b, a), sub(c, a)));
      if (area > largest) { largest = area; probe = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 }; }
    }
    const region = { outer: outer.arcs, holes: holes.map(h => h.arcs), probe };
    for (const arc of [...outer.arcs, ...holes.flatMap(h => h.arcs)]) arc.region = region;
    return region;
  });
  const seamTwins = new Map<Half, Half>();
  for (const [axis, periodic] of [['x', patch.surface.periodicU], ['y', patch.surface.periodicV]] as const) {
    if (!periodic) continue;
    const seam = halves.filter(half => [0, 1].some(value => Math.abs(half.from.point[axis] - value) < 1e-8 && Math.abs(half.to.point[axis] - value) < 1e-8));
    for (const half of seam) {
      const shift = half.from.point[axis] < 0.5 ? 1 : -1;
      const from = { ...half.from.point, [axis]: half.from.point[axis] + shift }, to = { ...half.to.point, [axis]: half.to.point[axis] + shift };
      const twin = seam.find(other => distance(other.from.point, to) < 1e-8 && distance(other.to.point, from) < 1e-8);
      if (twin) seamTwins.set(half, twin);
    }
  }
  // Across a periodic seam, the adjacent region lives on the opposite chart
  // edge. A discovered cut lying on that seam is internal when both are kept.
  return { regions, boundary: selected => halves.filter(half => half.path.physical && half.region && selected.has(half.region)
    && ![half.twin, seamTwins.get(half)].some(twin => twin?.region && selected.has(twin.region))) };
}
