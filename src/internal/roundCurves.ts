import { vec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface, type SurfaceSides } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import { TrimmedSurface } from '../TrimmedSurface.js';
import { SurfaceRegion } from '../SurfaceRegion.js';
import type { Vertex } from '../Vertex.js';
import { parameterizedSamples } from './curveSamples.js';
import { RoundTopology, spherical, sub, unit, type RoundRail } from './roundTopology.js';
import { atSurface, checkedUV, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';
import { boundaryPlacement, moveSurfaceUV } from './surfaceRails.js';
import { orientLoop } from './boundaryLoops.js';
import { curveParameter, sliceSpatialCurve } from './curveTrimming.js';
import { UnsupportedRoundError } from './roundUnsupported.js';
import { trimRegionRails } from './trimRegionRails.js';

type Side = keyof SurfaceSides;
type Trim = { rail: RoundRail; uv(t: number): Point; side?: Side; reversed: boolean };

function solve(matrix: number[][], rhs: number[]): number[] {
  const rows = matrix.map((row, i) => [...row, rhs[i]]), size = rows.length;
  for (let i = 0; i < size; i++) {
    const pivot = rows.reduce((best, row, j) => j >= i && Math.abs(row[i]) > Math.abs(rows[best][i]) ? j : best, i);
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    if (Math.abs(rows[i][i]) < 1e-12) throw new RangeError('Round offset-surface intersection is singular or unresolved');
    const divisor = rows[i][i];
    for (let k = i; k <= size; k++) rows[i][k] /= divisor;
    for (let j = 0; j < size; j++) if (j !== i) {
      const factor = rows[j][i];
      for (let k = i; k <= size; k++) rows[j][k] -= factor * rows[i][k];
    }
  }
  return rows.map(row => row[size]);
}

/** Intersect inward/outward radius offsets for convex/concave rims, retaining contact equations. */
export function roundCurves(surfaces: readonly Surface[], selected: readonly SpatialBoundary[], radius: number, topology: RoundTopology): Surface[] {
  const replacements = new Map<Surface, Map<SpatialBoundary, Trim>>(), rounded: Surface[] = [];
  const contacts = new Map<SpatialBoundary, Map<Vertex, Vertex>>(), ends = new Map<Vertex, RoundRail>();
  const endpointSelections = new Map<Vertex, number>();
  for (const boundary of selected) if (!boundary.isLoop()) for (const vertex of [boundary.start, boundary.end]) endpointSelections.set(vertex, (endpointSelections.get(vertex) ?? 0) + 1);
  for (const boundary of selected) {
    const closed = boundary.isLoop();
    const adjacent = surfaces.filter(surface => surface.boundaries.includes(boundary));
    if (adjacent.length !== 2 || !adjacent.every(surface => surface instanceof Face || surface instanceof SpatialSurface || surface instanceof SurfaceRegion)) {
      throw new RangeError('Round requires two regular adjoining planar or spatial surfaces');
    }
    const source = adjacent as ParametricFace[], placements = source.map(surface => boundaryPlacement(surface, boundary));
    const cache = new Map<number, { uv: Point[]; points: Vertex[]; normals: vec3[]; center: vec3; sense: number }>();
    const pair = (parameter: number) => {
      const t = closed && parameter === 1 ? 0 : parameter, cached = cache.get(t);
      if (cached) return cached;
      const origin = boundary.at(t), tangent = boundary instanceof SpatialCurve ? boundary.tangent(t) : unit(sub(boundary.end.position, boundary.start.position));
      // Differencing world coordinates limits normal accuracy, independently of
      // radius. Do not demand residuals below that roundoff floor on large parts.
      const tolerance = Math.max(1e-11, radius * 1e-10,
        Math.min(radius * 1e-7, Math.max(radius, ...Array.from(origin.position, Math.abs)) * Number.EPSILON * 64 / 1e-5));
      const initial = placements.map(placement => placement.uv(t)), initialNormals = source.map((surface, i) => surfaceFrame(surface, initial[i]).normal);
      const cosine = vec3.dot(initialNormals[0], initialNormals[1]);
      if (cosine < -1 + 1e-8 || cosine > 1 - 1e-8) throw new RangeError('Round requires a sharp regular boundary');
      // Convex balls lie in material; concave balls lie in the adjacent void.
      // Retained surface directions distinguish the two without curve-type equations.
      const sense = vec3.dot(placements[0].inward(initial[0], tangent), initialNormals[1]) < 0 ? 1 : -1;
      const setback = radius * Math.sqrt((1 - cosine) / (1 + cosine));
      let uv = initial.map((point, i) => moveSurfaceUV(source[i], point, vec3.scale([0, 0, 0], unit(placements[i].inward(point, tangent)), setback)));
      // Fix the station with a contact point on the curved source. The ball's
      // center itself may converge to one point at a sphere's limiting radius.
      const constrain = source[1] instanceof Face ? 0 : 1;
      const evaluate = (values: Point[]) => {
        const points = source.map((surface, i) => atSurface(surface, values[i]));
        const normals = source.map((surface, i) => surfaceFrame(surface, values[i]).normal);
        const centers = points.map((point, i) => vec3.scaleAndAdd([0, 0, 0], point.position, normals[i], -radius * sense));
        return { points, normals, center: centers[0], residual: [...sub(centers[0], centers[1]), vec3.dot(sub(points[constrain].position, origin.position), tangent)] };
      };
      for (let iteration = 0; ; iteration++) {
        const result = evaluate(uv);
        if (Math.hypot(...result.residual) <= Math.max(1e-11, radius * 1e-10)
          || (iteration >= 20 && Math.hypot(...result.residual) <= tolerance)) {
          for (let i = 0; i < 2; i++) if (vec3.dot(sub(result.points[i].position, origin.position), placements[i].inward(initial[i], tangent)) < -topology.tolerance) {
            throw new RangeError('Round contacts leave the retained surfaces');
          }
          // Reconstruct the radius circle through both exact contact points.
          // A residual at the finite-difference roundoff floor must not leave a
          // tiny jump between a blend's interior and its shared endpoint rails.
          const chord = sub(result.points[1].position, result.points[0].position), length = vec3.length(chord);
          if (length === 0) throw new RangeError('Round contact circle is singular');
          if (length > 2 * radius + tolerance) throw new RangeError('Round contacts exceed the ball diameter');
          const middle = vec3.lerp([0, 0, 0], result.points[0].position, result.points[1].position, 0.5);
          const across = sub(result.center, middle);
          vec3.scaleAndAdd(across, across, chord, -vec3.dot(across, chord) / (length * length));
          const center = vec3.scaleAndAdd([0, 0, 0], middle, unit(across), Math.sqrt(Math.max(0, radius * radius - length * length / 4)));
          const normals = result.points.map(point => vec3.scale([0, 0, 0], unit(sub(point.position, center)), sense));
          const value = { uv, points: result.points, normals, center, sense };
          cache.set(t, value); return value;
        }
        if (iteration >= 30) throw new RangeError('Round offset-surface intersection did not converge');
        const columns = [0, 1, 2, 3].map(index => {
          const i = index >> 1, axis = index % 2 === 0 ? 'x' : 'y';
          const frame = surfaceFrame(source[i], uv[i]);
          // Shrink the Jacobian probe near a root, especially where a smooth
          // joined profile changes parameter speed or crosses a periodic seam.
          const h = iteration < 10 ? 1e-5 : Math.max(1e-10, Math.min(1e-5, Math.hypot(...result.residual)
            * 0.01 / vec3.length(axis === 'x' ? frame.du : frame.dv)));
          const a = uv.map(point => ({ ...point })), b = uv.map(point => ({ ...point }));
          const surface = source[i], bounded = !(surface instanceof Face) && !(axis === 'x' ? surface.periodicU : surface.periodicV);
          a[i] = checkedUV(surface, { ...a[i], [axis]: a[i][axis] - (a[i][axis] < h && bounded ? 0 : h) });
          b[i] = checkedUV(surface, { ...b[i], [axis]: b[i][axis] + (b[i][axis] > 1 - h && bounded ? 0 : h) });
          const first = evaluate(a).residual, second = evaluate(b).residual;
          return first.map((value, j) => (second[j] - value) / (b[i][axis] - a[i][axis]));
        });
        const step = solve([0, 1, 2, 3].map(row => columns.map(column => column[row])), result.residual.map(value => -value));
        uv = uv.map((point, i) => checkedUV(source[i], { x: point.x + step[2 * i], y: point.y + step[2 * i + 1] }));
      }
    };
    const caps = closed ? [] : [boundary.start, boundary.end].map(vertex => {
      if (endpointSelections.get(vertex) !== 1) throw new UnsupportedRoundError('Numerical round junctions currently require one selected open boundary per endpoint; corner intersection trimming is required');
      const candidates = surfaces.filter(surface => !(adjacent as Surface[]).includes(surface) && surface.vertices.includes(vertex));
      if (candidates.length !== 1 || !(candidates[0] instanceof Face)) throw new UnsupportedRoundError('Open round ends require a planar cap; curved corner trimming is required');
      return candidates[0];
    });
    const raw = (t: number, v: number): Vertex => {
      const value = pair(t), normal = spherical(value.normals[0], value.normals[1], v);
      return { position: vec3.scaleAndAdd([0, 0, 0], value.center, normal, radius * value.sense) };
    };
    const bounds = new Map<number, number[]>();
    const station = (u: number, v: number): number => {
      if (closed) return u;
      let range = bounds.get(v);
      if (!range) {
        const extrapolate = !(boundary instanceof SpatialCurve) && source.every(surface => surface instanceof Face);
        range = caps.map((cap, end) => {
          const distance = (t: number) => vec3.dot(sub(raw(t, v).position, cap.plane.origin), cap.plane.normal);
          let t = end;
          for (let iteration = 0; ; iteration++) {
            const error = distance(t);
            if (Math.abs(error) <= Math.max(1e-12, radius * 1e-11)) return t;
            if (iteration === 20) throw new RangeError('Round end-cap intersection did not converge');
            const a = extrapolate ? t - 1e-4 : Math.max(0, t - 1e-4), b = extrapolate ? t + 1e-4 : Math.min(1, t + 1e-4);
            const derivative = (distance(b) - distance(a)) / (b - a);
            if (Math.abs(derivative) < 1e-10) throw new RangeError('Round end cap is tangent or numerically unresolved');
            t -= error / derivative;
            if (!extrapolate) {
              if (t < -1e-9 || t > 1 + 1e-9) throw new UnsupportedRoundError('Round end-cap trimming exceeds the source chart; extended surface intersection is required');
              t = Math.max(0, Math.min(1, t));
            }
          }
        });
        if (range[1] < range[0] - 1e-9) throw new RangeError('Round radius consumes the open boundary between its end caps');
        bounds.set(v, range);
      }
      return range[0] + (range[1] - range[0]) * u;
    };
    const rails = source.map((_surface, index) => {
      const a = station(0, index), b = station(1, index);
      const samples = closed ? boundary : sliceSpatialCurve(boundary, a, b, boundary.at(a), boundary.at(b));
      return topology.rail(t => pair(station(t, index)).points[index], samples);
    });
    for (const { t } of parameterizedSamples(boundary)) for (const rail of rails) if (rail.boundary) {
      const a = Math.max(0, t - 1e-4), b = Math.min(1, t + 1e-4);
      if (vec3.dot(sub(rail.at(b).position, rail.at(a).position), sub(boundary.at(b).position, boundary.at(a).position)) < -(topology.tolerance ** 2)) {
        throw new RangeError('Round radius folds a contact rail beyond its convergence');
      }
    }
    adjacent.forEach((surface, index) => {
      const entries = replacements.get(surface) ?? new Map(), side = placements[index].side;
      entries.set(boundary, { rail: rails[index], uv: (t: number) => {
        const uv = pair(station(t, index)).uv[index];
        const start = placements[index].uv(0), end = placements[index].uv(1);
        return closed && t === 1 ? { x: uv.x + end.x - start.x, y: uv.y + end.y - start.y } : uv;
      }, side, reversed: placements[index].reversed });
      replacements.set(surface, entries);
    });
    const normal = (u: number, v: number) => {
      const value = pair(station(u, v)); return spherical(value.normals[0], value.normals[1], v);
    };
    const evaluate = (u: number, v: number): Vertex => raw(station(u, v), v);
    const endRails: Partial<Record<Side, RoundRail>> = {};
    if (!closed) for (const t of [0, 1] as const) {
      const vertex = t === 0 ? boundary.start : boundary.end;
      const cap = caps[t];
      const arc = topology.rail(v => evaluate(t, v));
      if (arc.boundary?.sample().some(point => Math.abs(vec3.dot(sub(point.position, cap.plane.origin), cap.plane.normal)) > topology.tolerance)) {
        throw new UnsupportedRoundError('Open round contacts leave the end cap; end-surface intersection trimming is required');
      }
      ends.set(vertex, arc); endRails[t === 0 ? 'u0' : 'u1'] = arc;
      adjacent.forEach((surface, i) => {
        const neighbors = surface.boundaries.filter(other => other !== boundary && (other.start === vertex || other.end === vertex) && cap.boundaries.includes(other));
        if (neighbors.length !== 1 || selected.includes(neighbors[0])) throw new UnsupportedRoundError('Open round cannot resolve its neighboring end trim');
        const neighbor = neighbors[0], entries = contacts.get(neighbor) ?? new Map();
        entries.set(vertex, rails[i].at(t)); contacts.set(neighbor, entries);
      });
    }
    const patch = topology.patch(evaluate, { v0: rails[0], v1: rails[1], ...endRails }, normal, closed);
    if (patch) rounded.push(patch);
  }
  for (const [boundary, vertices] of contacts) {
    const start = vertices.get(boundary.start) ?? boundary.start, end = vertices.get(boundary.end) ?? boundary.end;
    const a = start === boundary.start ? 0 : curveParameter(boundary, start.position), b = end === boundary.end ? 1 : curveParameter(boundary, end.position);
    if (b < a - 1e-9 || vec3.distance(boundary.at(a).position, start.position) > topology.tolerance || vec3.distance(boundary.at(b).position, end.position) > topology.tolerance) {
      throw new RangeError('Round consumes an end trim or its contacts leave the neighboring boundary');
    }
    const rail = vec3.distance(start.position, end.position) <= topology.tolerance ? { at: () => start }
      : { boundary: sliceSpatialCurve(boundary, a, b, start, end), at: (t: number) => boundary.at(a + (b - a) * t) };
    for (const surface of surfaces) if (surface.boundaries.includes(boundary)) {
      if (!(surface instanceof Face || surface instanceof SpatialSurface)) throw new UnsupportedRoundError('Open round end trims require a regular surface chart');
      const placement = boundaryPlacement(surface, boundary), entries = replacements.get(surface) ?? new Map();
      entries.set(boundary, { rail, uv: (t: number) => placement.uv(a + (b - a) * t), side: placement.side, reversed: placement.reversed }); replacements.set(surface, entries);
    }
  }
  const retained = surfaces.flatMap(surface => {
    const entries = replacements.get(surface);
    if (!entries) return [surface];
    const loops = surface.boundaryLoops.map(loop => {
      const pieces = orientLoop(loop).map(({ boundary, reversed }) => {
        const trim = entries.get(boundary), rail = trim?.rail ?? { boundary, at: (t: number) => boundary.at(t) };
        return { rail, start: rail.at(reversed ? 1 : 0), end: rail.at(reversed ? 0 : 1), vertex: reversed ? boundary.start : boundary.end };
      });
      return [...new Set(pieces.flatMap((piece, i) => {
        const next = pieces[(i + 1) % pieces.length], result = piece.rail.boundary ? [piece.rail.boundary] : [];
        if (vec3.distance(piece.end.position, next.start.position) <= topology.tolerance) return result;
        const arc = ends.get(piece.vertex);
        if (!arc?.boundary || ![false, true].some(reverse => vec3.distance(arc.at(reverse ? 1 : 0).position, piece.end.position) <= topology.tolerance && vec3.distance(arc.at(reverse ? 0 : 1).position, next.start.position) <= topology.tolerance)) {
          throw new RangeError('Round face trim cannot join its endpoint rails');
        }
        return [...result, arc.boundary];
      }))];
    });
    if (surface instanceof Face) { const face = topology.face(surface, loops); return face ? [face] : []; }
    if (surface instanceof SurfaceRegion) {
      const rails = new Map([...entries].map(([boundary, trim]) => {
        if (!boundary.isLoop() || !trim.rail.boundary) throw new UnsupportedRoundError('Surface region rounds require closed, noncollapsing contact rails');
        return [boundary, { boundary: trim.rail.boundary, uv: trim.uv }] as const;
      }));
      return [trimRegionRails(surface, rails, loops)];
    }
    const original = surface as SpatialSurface;
    const trims = new Map([...entries.values()].map(trim => [trim.side!, trim]));
    const uv = (side: Side, t: number) => {
      const trim = trims.get(side); return trim?.uv(trim.reversed ? 1 - t : t);
    };
    const corners = [uv('v0', 0) ?? uv('u0', 0) ?? { x: 0, y: 0 }, uv('v0', 1) ?? uv('u1', 0) ?? { x: 1, y: 0 },
      uv('v1', 0) ?? uv('u0', 1) ?? { x: 0, y: 1 }, uv('v1', 1) ?? uv('u1', 1) ?? { x: 1, y: 1 }];
    const lerp = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const chart = (u: number, v: number): Point => {
      const left = uv('u0', v) ?? lerp(corners[0], corners[2], v), right = uv('u1', v) ?? lerp(corners[1], corners[3], v);
      const bottom = uv('v0', u) ?? lerp(corners[0], corners[1], u), top = uv('v1', u) ?? lerp(corners[2], corners[3], u);
      if (right.x < left.x - 1e-8 || top.y < bottom.y - 1e-8) throw new RangeError('Round radius overlaps opposing surface trims');
      const blend = (axis: 'x' | 'y') => (1 - u) * ((1 - v) * corners[0][axis] + v * corners[2][axis]) + u * ((1 - v) * corners[1][axis] + v * corners[3][axis]);
      return { x: (1 - v) * bottom.x + v * top.x + (1 - u) * left.x + u * right.x - blend('x'),
        y: (1 - v) * bottom.y + v * top.y + (1 - u) * left.y + u * right.y - blend('y') };
    };
    const at = (u: number, v: number) => atSurface(original, chart(u, v));
    const collapsed = (!original.periodicU && [0, 0.5, 1].every(t => vec3.distance(at(0, t).position, at(1, t).position) <= topology.tolerance))
      || (!original.periodicV && [0, 0.5, 1].every(t => vec3.distance(at(t, 0).position, at(t, 1).position) <= topology.tolerance));
    if (collapsed) return [];
    const sides = Object.fromEntries(Object.entries(original.sides).map(([side, boundary]) => [side,
      entries.has(boundary) ? entries.get(boundary)!.rail.boundary : boundary]));
    return [new TrimmedSurface({ surface: original, at: chart, sides, boundaryLoops: loops.filter(loop => loop.length) })];
  });
  return [...retained, ...rounded];
}
