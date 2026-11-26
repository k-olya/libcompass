import { vec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface, type SurfaceSides } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import { SurfaceRegion, type SurfaceTrim } from '../SurfaceRegion.js';
import { TrimmedSurface } from '../TrimmedSurface.js';
import type { Vertex } from '../Vertex.js';
import { assembleBoundaryLoops } from './boundaryLoops.js';
import { mergeCoplanarFaces } from './booleanTopology.js';
import { parameterizedSamples } from './curveSamples.js';
import { joinSpatialBoundaries, type BoundaryJoin } from './joinSpatialBoundaries.js';
import { surfaceFrame } from './surfaceGeometry.js';
import { boundaryPlacement } from './surfaceRails.js';
import { sampleSurface } from './surfaceSampling.js';
import { signedArea } from './polygon.js';

type Side = keyof SurfaceSides;
const boundaries = (surfaces: readonly Surface[]) => [...new Set(surfaces.flatMap(surface => surface.boundaries))];
const incident = (surfaces: readonly Surface[], boundary: SpatialBoundary) => surfaces.filter(surface => surface.boundaries.includes(boundary));

/** A rectangular retained region can use its native chart without artificial trim seams. */
function rectangularRegion(source: Surface): Surface {
  if (!(source instanceof SurfaceRegion)) return source;
  const sampled = (trim: SurfaceTrim) => {
    const start = trim.start ?? 0, end = trim.end ?? 1;
    return [...new Set([start, ...parameterizedSamples(trim.boundary).map(({ t }) => t).filter(t => t > start && t < end), end])]
      .sort((a, b) => a - b).map(t => ({ t, uv: trim.at(t) }));
  };
  const charts = source.regions.map(chart => [chart.outer, ...(chart.holes ?? [])].map(loop => loop.flatMap(trim => {
    const points = sampled(trim).map(({ uv }) => uv);
    return (trim.reversed ? points.reverse() : points).slice(0, -1);
  })));
  const all = charts.flat(2), min = { x: Math.min(...all.map(p => p.x)), y: Math.min(...all.map(p => p.y)) },
    max = { x: Math.max(...all.map(p => p.x)), y: Math.max(...all.map(p => p.y)) };
  const width = max.x - min.x, height = max.y - min.y;
  if (!(width > 0 && height > 0)) return source;
  const area = charts.reduce((sum, loops) => sum + Math.abs(signedArea(loops[0])) - loops.slice(1).reduce((area, loop) => area + Math.abs(signedArea(loop)), 0), 0);
  if (Math.abs(area - width * height) > width * height * 1e-8) return source;
  const sides: SurfaceSides = {}, physical = new Set(source.boundaries);
  for (const chart of source.regions) for (const loop of [chart.outer, ...(chart.holes ?? [])]) for (const trim of loop) {
    if (trim.physical === false || !physical.has(trim.boundary)) continue;
    const samples = sampled(trim);
    const side = (['u0', 'u1', 'v0', 'v1'] as const).find(side => {
      const axis = side[0] === 'u' ? 'x' : 'y', other = axis === 'x' ? 'y' : 'x';
      const value = side[1] === '0' ? min[axis] : max[axis];
      if (!samples.every(({ uv }) => Math.abs(uv[axis] - value) <= 1e-8)) return false;
      return samples.every(({ uv }) => uv[other] >= min[other] - 1e-8 && uv[other] <= max[other] + 1e-8);
    });
    if (!side || (sides[side] && sides[side] !== trim.boundary)) return source;
    sides[side] = trim.boundary;
  }
  const periodicU = source.periodicU && Math.abs(width - 1) < 1e-8, periodicV = source.periodicV && Math.abs(height - 1) < 1e-8;
  if ((!periodicU && (!sides.u0 || !sides.u1)) || (!periodicV && (!sides.v0 || !sides.v1))) return source;
  const axes: ((t: number) => number)[] = [], inverse: ((value: number) => number)[] = [];
  for (const [axis, names] of [['x', ['v0', 'v1']], ['y', ['u0', 'u1']]] as const) {
    const paths = names.flatMap(name => {
      const boundary = sides[name];
      if (!boundary) return [];
      const placement = boundaryPlacement(source, boundary), reversed = placement.uv(0)[axis] > placement.uv(1)[axis];
      return [{ boundary, at: (t: number) => placement.uv(reversed ? 1 - t : t)[axis], reversed }];
    });
    const at = paths[0]?.at ?? ((t: number) => min[axis] + (max[axis] - min[axis]) * t);
    if (Math.abs(at(0) - min[axis]) > 1e-8 || Math.abs(at(1) - max[axis]) > 1e-8) return source;
    for (const path of paths) {
      const samples = parameterizedSamples(path.boundary).map(({ t }) => path.reversed ? 1 - t : t).sort((a, b) => a - b);
      if (samples.some((t, i) => Math.abs(path.at(t) - at(t)) > 1e-8 || (i > 0 && path.at(t) <= path.at(samples[i - 1])))) return source;
    }
    axes.push(at);
    const cache = new Map<number, number>();
    inverse.push(value => {
      const cached = cache.get(value);
      if (cached !== undefined) return cached;
      let low = 0, high = 1;
      for (let i = 0; i < 48; i++) { const t = (low + high) / 2; if (at(t) < value) low = t; else high = t; }
      const t = (low + high) / 2; cache.set(value, t); return t;
    });
  }
  const result = new TrimmedSurface({ surface: source.surface, at: (u, v) => ({ x: axes[0](u), y: axes[1](v) }),
    sides, boundaryLoops: source.boundaryLoops, periodicU, periodicV, reversed: source.reversed });
  result.sample = () => {
    const grid = source.surface.sample();
    const seeds = (values: number[], axis: 'x' | 'y', index: number) => values.filter(t => t > min[axis] && t < max[axis]).map(inverse[index]);
    return sampleSurface(result, seeds(grid.u, 'x', 0), seeds(grid.v, 'y', 1));
  };
  return result;
}

/** Replace shared curves while preserving each retained chart's native parameters. */
function replaceJoins(surface: Surface, joins: readonly BoundaryJoin[]): Surface {
  const replacements = new Map(joins.flatMap(join => join.pieces.map(piece => [piece.source, { ...piece, boundary: join.boundary }] as const)));
  if (!surface.boundaries.some(boundary => replacements.has(boundary))) return surface;
  const boundaryLoops = surface.boundaryLoops.map(loop => {
    const mapped = loop.map(boundary => replacements.get(boundary)?.boundary ?? boundary);
    const result = mapped.filter((boundary, i) => !i || boundary !== mapped[i - 1]);
    if (result.length > 1 && result[0] === result.at(-1)) result.pop();
    return result;
  });
  if (surface instanceof Face) return new Face({ outer: boundaryLoops[0], holes: boundaryLoops.slice(1), plane: surface.plane });
  if (!(surface instanceof SurfaceRegion)) throw new RangeError('Union boundary join requires a retained surface chart');
  const trim = (original: SurfaceTrim): SurfaceTrim => {
    const piece = replacements.get(original.boundary);
    if (!piece) return original;
    const start = piece.to(original.start ?? 0), end = piece.to(original.end ?? 1);
    return { ...original, boundary: piece.boundary, start: Math.min(start, end), end: Math.max(start, end),
      reversed: !!original.reversed !== (start > end), at: t => original.at(piece.from(t)) };
  };
  return new SurfaceRegion({ surface: surface.surface, reversed: surface.reversed, boundaryLoops,
    regions: surface.regions.map(chart => ({ outer: chart.outer.map(trim), holes: chart.holes?.map(loop => loop.map(trim)) })) });
}

/** Remove a smooth full-side join by composing the two original surface charts. */
function joinSurfaces(a: SpatialSurface, b: SpatialSurface, rim: SpatialBoundary, surfaces: readonly Surface[], tolerance: number): { surface: SpatialSurface; joins: BoundaryJoin[] } | undefined {
  const first = boundaryPlacement(a, rim), second = boundaryPlacement(b, rim);
  if (!first.side || !second.side) return;
  if ([a, b].some(surface => surface.boundaries.some(boundary => !Object.values(surface.sides).includes(boundary)))) return;
  const axisA = first.side[0], axisB = second.side[0], endA = first.side[1] === '1', endB = second.side[1] === '1';
  const otherA = axisA === 'u' ? 'v' : 'u', otherB = axisB === 'u' ? 'v' : 'u';
  if ((otherA === 'u' ? a.periodicU : a.periodicV) !== (otherB === 'u' ? b.periodicU : b.periodicV)) return;
  const stations = new Set(parameterizedSamples(rim).map(({ t }) => t));
  for (const [surface, placement] of [[a, first], [b, second]] as const) {
    const grid = surface.sample(), values = placement.side![0] === 'u' ? grid.v : grid.u;
    for (const t of values) stations.add(placement.reversed ? 1 - t : t);
  }
  for (const t of stations) {
    const ua = first.uv(t), ub = second.uv(t), na = surfaceFrame(a, ua).normal, nb = surfaceFrame(b, ub).normal;
    if (vec3.distance(a.at(ua.x, ua.y).position, rim.at(t).position) > tolerance
      || vec3.distance(b.at(ub.x, ub.y).position, rim.at(t).position) > tolerance) return;
    const tangent = rim instanceof SpatialCurve ? rim.tangent(t) : vec3.normalize([0, 0, 0], vec3.subtract([0, 0, 0], rim.end.position, rim.start.position));
    if (vec3.dot(na, nb) < 1 - 1e-8 || vec3.dot(first.inward(ua, tangent), second.inward(ub, tangent)) > -1 + 1e-8) return;
  }
  const flip = first.reversed !== second.reversed;
  const joins: BoundaryJoin[] = [], sides: SurfaceSides = {};
  for (const end of [0, 1]) {
    const ca = a.sides[`${otherA}${end}` as Side], cb = b.sides[`${otherB}${flip ? 1 - end : end}` as Side];
    if (!ca && !cb) continue;
    if (!ca || !cb) return;
    const outsideA = incident(surfaces, ca).filter(surface => surface !== a && surface !== b);
    const outsideB = incident(surfaces, cb).filter(surface => surface !== a && surface !== b);
    if (outsideA.length !== 1 || outsideB.length !== 1 || outsideA[0] !== outsideB[0]
      || !(outsideA[0] instanceof Face || outsideA[0] instanceof SurfaceRegion)) return;
    const vertex = (first.reversed ? 1 - end : end) === 0 ? rim.start : rim.end;
    if ((vertex !== ca.start && vertex !== ca.end) || (vertex !== cb.start && vertex !== cb.end)) return;
    const joined = joinSpatialBoundaries(ca, cb, vertex, tolerance);
    if (!joined) return;
    joins.push(joined); sides[`${otherA}${end}` as Side] = joined.boundary;
  }
  const split = joins[0]?.split ?? 0.5;
  if (joins.some(join => Math.abs(join.split - split) > 1e-8)) return;
  const outerA = a.sides[`${axisA}${endA ? 0 : 1}` as Side], outerB = b.sides[`${axisB}${endB ? 0 : 1}` as Side];
  const periodic = !!outerA && outerA === outerB;
  if (a.boundaries.some(boundary => b.boundaries.includes(boundary) && boundary !== rim && (!periodic || boundary !== outerA))) return;
  if (!periodic) {
    sides[`${axisA}0` as Side] = outerA;
    sides[`${axisA}1` as Side] = outerB;
  }
  const chart = (g: number, q: number, left: boolean): Point => {
    const p = left ? (endA ? g / split : 1 - g / split) : (endB ? (1 - g) / (1 - split) : (g - split) / (1 - split));
    const other = !left && flip ? 1 - q : q;
    return (left ? axisA : axisB) === 'u' ? { x: p, y: other } : { x: other, y: p };
  };
  const periodicOther = otherA === 'u' ? a.periodicU : a.periodicV;
  const surface = new SpatialSurface({ at: (u, v) => {
    const g = axisA === 'u' ? u : v, q = axisA === 'u' ? v : u, left = g <= split, uv = chart(g, q, left);
    return (left ? a : b).at(uv.x, uv.y);
  }, sides, boundaryLoops: assembleBoundaryLoops(Object.values(sides).filter((boundary): boundary is SpatialBoundary => !!boundary)),
  periodicU: axisA === 'u' ? periodic : periodicOther, periodicV: axisA === 'v' ? periodic : periodicOther,
  reversed: a.reversed !== !endA, poles: [...a.poles, ...b.poles] });
  surface.derivatives = (u, v) => {
    const g = axisA === 'u' ? u : v, q = axisA === 'u' ? v : u, left = g <= split, uv = chart(g, q, left);
    const source = (left ? a : b).derivatives(uv.x, uv.y), axis = left ? axisA : axisB;
    const along = vec3.scale([0, 0, 0], axis === 'u' ? source.du : source.dv, left ? (endA ? 1 : -1) / split : (endB ? -1 : 1) / (1 - split));
    const across = vec3.scale([0, 0, 0], axis === 'u' ? source.dv : source.du, !left && flip ? -1 : 1);
    return axisA === 'u' ? { du: along, dv: across } : { du: across, dv: along };
  };
  surface.sample = () => {
    const seeds = { u: [] as number[], v: [] as number[] };
    for (const [source, left, axis] of [[a, true, axisA], [b, false, axisB]] as const) {
      const grid = source.sample();
      const p = axis === 'u' ? grid.u : grid.v, q = axis === 'u' ? grid.v : grid.u;
      for (const t of p) seeds[axisA as 'u' | 'v'].push(left ? (endA ? t : 1 - t) * split : split + (endB ? 1 - t : t) * (1 - split));
      for (const t of q) seeds[otherA as 'u' | 'v'].push(!left && flip ? 1 - t : t);
    }
    return sampleSurface(surface, seeds.u, seeds.v);
  };
  return { surface, joins };
}

/** Unify compatible faces and smooth boundary runs without changing source topology. */
export function unifyUnion(input: readonly Surface[], tolerance: number): Surface[] {
  let surfaces = mergeCoplanarFaces(input, tolerance);
  for (;;) {
    surfaces = surfaces.map(rectangularRegion);
    let changed = false;
    for (const boundary of boundaries(surfaces)) {
      const adjacent = incident(surfaces, boundary);
      if (adjacent.length !== 2 || !adjacent.every(surface => surface instanceof SpatialSurface)) continue;
      const [a, b] = adjacent as SpatialSurface[], joined = joinSurfaces(a, b, boundary, surfaces, tolerance);
      if (!joined) continue;
      surfaces = surfaces.flatMap(surface => surface === a ? [joined.surface] : surface === b ? [] : [replaceJoins(surface, joined.joins)]);
      changed = true; break;
    }
    if (changed) continue;
    const edges = boundaries(surfaces), vertices = new Map<Vertex, Set<SpatialBoundary>>();
    for (const boundary of edges) for (const vertex of [boundary.start, boundary.end]) {
      let adjoining = vertices.get(vertex);
      if (!adjoining) { adjoining = new Set(); vertices.set(vertex, adjoining); }
      adjoining.add(boundary);
    }
    for (const [vertex, edges] of vertices) {
      if (edges.size !== 2) continue;
      const [a, b] = [...edges], adjacent = incident(surfaces, a);
      if (adjacent.length !== 2 || adjacent.some(surface => !(surface instanceof Face || surface instanceof SurfaceRegion)
        || !surface.boundaries.includes(b)) || incident(surfaces, b).length !== 2) continue;
      const joined = joinSpatialBoundaries(a, b, vertex, tolerance);
      if (!joined) continue;
      surfaces = surfaces.map(surface => replaceJoins(surface, [joined]));
      changed = true; break;
    }
    if (!changed) return surfaces;
  }
}
