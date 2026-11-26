import { vec3 } from 'gl-matrix';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import type { Point } from '../Point.js';
import type { BlendSection } from './blendSection.js';
import { solveBlendSystem } from './blendSection.js';
import { RoundTopology, sub, type RoundRail } from './roundTopology.js';
import { atSurface, checkedUV, solve3, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';

export type BlendStrip = { boundary: SpatialBoundary; source: ParametricFace[]; section(t: number): BlendSection };
export type JunctionSeam = { rail: RoundRail; v(t: number): number };
export type JunctionEnd = { station(v: number): number; seams: JunctionSeam[] };
type Station = { t: number; v: number };

/** Intersect exact strip evaluators, sewing two-strip miters and three-strip bevel junctions. */
export function blendJunction(strips: BlendStrip[], vertex: Vertex, topology: RoundTopology): {
  ends: Map<SpatialBoundary, JunctionEnd>; unselectedContact?: Vertex;
  cut?: { surface: ParametricFace; rail: RoundRail; uv(t: number): Point };
} {
  const tolerance = topology.tolerance * 0.25;
  const endpoint = (strip: BlendStrip) => strip.boundary.start === vertex ? 0 : 1;
  const point = (strip: BlendStrip, station: Station) => strip.section(station.t).at(station.v).position;
  const derivative = (strip: BlendStrip, station: Station, axis: 't' | 'v') => {
    const a = axis === 'v' ? station[axis] - 1e-5 : Math.max(0, station[axis] - 1e-5);
    const b = axis === 'v' ? station[axis] + 1e-5 : Math.min(1, station[axis] + 1e-5);
    return vec3.scale([0, 0, 0], sub(point(strip, { ...station, [axis]: b }), point(strip, { ...station, [axis]: a })), 1 / (b - a));
  };
  const valid = (station: Station) => Number.isFinite(station.t) && Number.isFinite(station.v)
    && station.t >= 0 && station.t <= 1 && station.v >= 0 && station.v <= 1;
  const contacts = (a: BlendStrip, av: number, b: BlendStrip, bv: number, closest = false): Station[] => {
    let stations = [{ t: endpoint(a), v: av }, { t: endpoint(b), v: bv }];
    for (let iteration = 0; ; iteration++) {
      const residual = sub(point(a, stations[0]), point(b, stations[1])), error = vec3.length(residual);
      if (error <= tolerance) return stations;
      if (iteration >= 30) {
        if (closest) return stations;
        throw new RangeError('Blend contact rails do not meet at the corner');
      }
      const da = derivative(a, stations[0], 't'), db = vec3.negate([0, 0, 0], derivative(b, stations[1], 't'));
      const aa = vec3.dot(da, da), ab = vec3.dot(da, db), bb = vec3.dot(db, db), determinant = aa * bb - ab * ab;
      if (determinant <= aa * bb * 1e-14) throw new RangeError('Blend contact intersection is singular');
      const x = -vec3.dot(da, residual), y = -vec3.dot(db, residual), step = [(bb * x - ab * y) / determinant, (aa * y - ab * x) / determinant];
      let next: Station[] | undefined;
      for (let reduction = 0; reduction < 16; reduction++) {
        const candidate = stations.map((station, i) => ({ ...station, t: station.t + step[i] * 2 ** -reduction }));
        if (candidate.every(valid) && vec3.distance(point(a, candidate[0]), point(b, candidate[1])) < error) { next = candidate; break; }
      }
      if (!next) {
        if (closest) return stations;
        throw new RangeError('Blend contact rails leave their corner neighborhood');
      }
      stations = next;
    }
  };
  const intersection = (a: BlendStrip, b: BlendStrip, av: number, initial: Station[], extend = false): Station[] | undefined => {
    let stations = [{ ...initial[0], v: av }, { ...initial[1] }];
    for (let iteration = 0; ; iteration++) {
      const delta = sub(point(b, stations[1]), point(a, stations[0])), error = vec3.length(delta);
      if (error <= tolerance) return stations;
      if (iteration >= 30) {
        if (extend) return undefined;
        throw new RangeError('Blend miter intersection did not converge');
      }
      const step = solve3(derivative(a, stations[0], 't'), vec3.negate([0, 0, 0], derivative(b, stations[1], 't')),
        vec3.negate([0, 0, 0], derivative(b, stations[1], 'v')), delta);
      let next: Station[] | undefined;
      for (let reduction = 0; reduction < 16; reduction++) {
        const scale = 2 ** -reduction, candidate = [{ t: stations[0].t + scale * step[0], v: av },
          { t: stations[1].t + scale * step[1], v: stations[1].v + scale * step[2] }];
        if (candidate.every(station => valid(extend ? { ...station, v: 0 } : station))
          && vec3.distance(point(a, candidate[0]), point(b, candidate[1])) < error) { next = candidate; break; }
      }
      if (!next) {
        if (extend) return undefined;
        throw new RangeError('Blend miter leaves its source strips');
      }
      stations = next;
    }
  };
  const pairs: { a: number; b: number; start: Station[] }[] = [];
  for (let a = 0; a < strips.length; a++) for (let b = a + 1; b < strips.length; b++) {
    const common = strips[a].source.find(surface => strips[b].source.includes(surface));
    if (!common) throw new RangeError('Connected blends need a shared support surface');
    pairs.push({ a, b, start: contacts(strips[a], strips[a].source.indexOf(common), strips[b], strips[b].source.indexOf(common)) });
  }
  let junction: Station[] | undefined, unselectedContact: Vertex | undefined;
  let cut: { surface: ParametricFace; rail: RoundRail; uv(t: number): Point } | undefined;
  if (strips.length === 3) {
    junction = strips.map((_, i) => {
      const starts = pairs.flatMap(pair => pair.a === i ? [pair.start[0]] : pair.b === i ? [pair.start[1]] : []);
      return { t: starts.reduce((sum, station) => sum + station.t, 0) / starts.length, v: 0.5 };
    });
    const residualAt = (stations: Station[]) => {
      const points = strips.map((strip, i) => point(strip, stations[i]));
      return [...sub(points[0], points[1]), ...sub(points[0], points[2])];
    };
    for (let iteration = 0; ; iteration++) {
      const residual = residualAt(junction), error = Math.hypot(...residual);
      if (error <= tolerance) break;
      if (iteration >= 30) throw new RangeError('Three blend surfaces do not meet at their corner');
      const columns = strips.flatMap((strip, i) => (['t', 'v'] as const).map(axis => {
        const d = derivative(strip, junction![i], axis);
        return [...Array.from(d, value => i === 2 ? 0 : value * (i ? -1 : 1)), ...Array.from(d, value => i === 1 ? 0 : value * (i ? -1 : 1))];
      }));
      const step = solveBlendSystem([0, 1, 2, 3, 4, 5].map(row => columns.map(column => column[row])), residual.map(value => -value));
      let next: Station[] | undefined;
      for (let reduction = 0; reduction < 16; reduction++) {
        const scale = 2 ** -reduction, candidate = junction.map((station, i) => ({ t: station.t + scale * step[2 * i], v: station.v + scale * step[2 * i + 1] }));
        if (candidate.every(valid) && Math.hypot(...residualAt(candidate)) < error) { next = candidate; break; }
      }
      if (!next) throw new RangeError('Blend corner intersection leaves its source strips');
      junction = next;
    }
  }
  const ends = new Map<SpatialBoundary, JunctionEnd>();
  const seamStations = new Map<SpatialBoundary, { seam: JunctionSeam; station(t: number): Station }[]>();
  for (const pair of pairs) {
    const [a, b] = [strips[pair.a], strips[pair.b]], start = pair.start;
    let finish: Station[];
    if (junction) finish = [junction[pair.a], junction[pair.b]];
    else {
      const initial = contacts(a, 1 - start[0].v, b, 1 - start[1].v, true);
      if (vec3.distance(point(a, initial[0]), point(b, initial[1])) <= tolerance) finish = initial;
      else {
        const candidate = intersection(a, b, initial[0].v, initial, true);
        const found = candidate && candidate[1].v >= -1e-8 && candidate[1].v <= 1 + 1e-8 ? candidate
          : intersection(b, a, initial[1].v, [initial[1], initial[0]], true)?.reverse();
        if (!found) throw new RangeError('Blend intersection cannot reach its adjoining supports');
        finish = found;
      }
      for (const station of finish) {
        if (station.v < -1e-8 || station.v > 1 + 1e-8) throw new RangeError('Blend miters cannot reach their adjoining supports');
        station.v = Math.max(0, Math.min(1, station.v));
      }
      unselectedContact = topology.vertex(point(a, finish[0]));
    }
    const cache = new Map<number, Station[]>();
    const stationsAt = (q: number): Station[] => {
      const cached = cache.get(q); if (cached) return cached;
      if (q === 0) return start;
      if (q === 1) return finish;
      const av = start[0].v + (finish[0].v - start[0].v) * q;
      const stations = intersection(a, b, av, start.map((station, i) => ({ t: station.t + (finish[i].t - station.t) * q, v: station.v + (finish[i].v - station.v) * q })))!;
      cache.set(q, stations); return stations;
    };
    const rail = topology.rail(q => ({ position: point(a, stationsAt(q)[0]) }));
    for (const [i, strip] of [a, b].entries()) {
      const entries = seamStations.get(strip.boundary) ?? [];
      entries.push({ seam: { rail, v: q => stationsAt(q)[i].v }, station: q => stationsAt(q)[i] });
      seamStations.set(strip.boundary, entries);
    }
    if (!junction) for (const [i, strip] of [a, b].entries()) {
      const outer = 1 - start[i].v;
      if (Math.abs(finish[i].v - outer) <= 1e-8) continue;
      const other = i ? a : b, otherStation = finish[1 - i], otherOuter = 1 - start[1 - i].v;
      const surface = other.source[otherOuter], initialUV = other.section(otherStation.t).uv[otherOuter];
      const capCache = new Map<number, { station: Station; uv: Point }>();
      const capAt = (q: number) => {
        const cached = capCache.get(q); if (cached) return cached;
        const v = finish[i].v + (outer - finish[i].v) * q;
        let station = { ...finish[i], v }, uv = initialUV;
        for (let iteration = 0; ; iteration++) {
          const delta = sub(atSurface(surface, uv).position, point(strip, station));
          if (vec3.length(delta) <= tolerance) { const result = { station, uv }; capCache.set(q, result); return result; }
          if (iteration >= 30) throw new RangeError('Blend corner cap intersection did not converge');
          const { du, dv } = surfaceFrame(surface, uv);
          const step = solve3(derivative(strip, station, 't'), vec3.negate([0, 0, 0], du), vec3.negate([0, 0, 0], dv), delta);
          station = { t: station.t + step[0], v }; uv = checkedUV(surface, { x: uv.x + step[1], y: uv.y + step[2] });
          if (!valid(station)) throw new RangeError('Blend cap consumes its adjoining strip');
        }
      };
      const rail = topology.rail(q => ({ position: point(strip, capAt(q).station) }));
      seamStations.get(strip.boundary)!.push({ seam: { rail, v: q => capAt(q).station.v }, station: q => capAt(q).station });
      cut = { surface, rail, uv: q => capAt(q).uv };
      unselectedContact = rail.at(1);
    }
  }
  for (const [boundary, entries] of seamStations) {
    entries.sort((a, b) => Math.min(a.seam.v(0), a.seam.v(1)) - Math.min(b.seam.v(0), b.seam.v(1)));
    const cache = new Map<number, number>();
    ends.set(boundary, { seams: entries.map(entry => entry.seam), station: v => {
      const cached = cache.get(v); if (cached !== undefined) return cached;
      const entry = entries.find(entry => v >= Math.min(entry.seam.v(0), entry.seam.v(1)) - 1e-9 && v <= Math.max(entry.seam.v(0), entry.seam.v(1)) + 1e-9);
      if (!entry) throw new RangeError('Blend junction does not span its strip');
      const first = entry.seam.v(0), last = entry.seam.v(1);
      let low = 0, high = 1, q = Math.max(0, Math.min(1, (v - first) / (last - first)));
      for (let iteration = 0; ; iteration++) {
        const station = entry.station(q);
        if (Math.abs(station.v - v) <= 1e-11) { cache.set(v, station.t); return station.t; }
        if (iteration >= 40) throw new RangeError('Blend miter parameter could not be inverted');
        if ((station.v < v) === (last > first)) low = q; else high = q;
        q = (low + high) / 2;
      }
    } });
  }
  return { ends, unselectedContact, cut };
}
