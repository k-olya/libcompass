import { vec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface, type SurfaceSides } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import { TrimmedSurface } from '../TrimmedSurface.js';
import type { Vertex } from '../Vertex.js';
import { parameterizedSamples } from './curveSamples.js';
import { RoundTopology, spherical, sub, unit, type RoundRail } from './roundTopology.js';
import { atSurface, checkedUV, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';
import { boundaryPlacement, moveSurfaceUV } from './surfaceRails.js';

type Side = keyof SurfaceSides;
type Trim = { rail: RoundRail; uv(t: number): Point; side?: Side };

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

/** Intersect inward parallel surfaces, retaining their exact contact equations. */
export function roundCurves(surfaces: readonly Surface[], selected: readonly SpatialBoundary[], radius: number, topology: RoundTopology): Surface[] {
  const replacements = new Map<Surface, Map<SpatialBoundary, Trim>>(), rounded: Surface[] = [];
  for (const boundary of selected) {
    if (!boundary.isLoop()) throw new RangeError('Round on open curved boundaries requires curved corner trimming');
    const adjacent = surfaces.filter(surface => surface.boundaries.includes(boundary));
    if (adjacent.length !== 2 || !adjacent.every(surface => surface instanceof Face || surface instanceof SpatialSurface)) {
      throw new RangeError('Round requires two regular adjoining planar or spatial surfaces');
    }
    const source = adjacent as ParametricFace[], placements = source.map(surface => boundaryPlacement(surface, boundary));
    const cache = new Map<number, { uv: Point[]; points: Vertex[]; normals: vec3[]; center: vec3 }>();
    const pair = (parameter: number) => {
      const t = parameter === 1 ? 0 : parameter, cached = cache.get(t);
      if (cached) return cached;
      const origin = boundary.at(t), tangent = boundary instanceof SpatialCurve ? boundary.tangent(t) : unit(sub(boundary.end.position, boundary.start.position));
      const initial = placements.map(placement => placement.uv(t)), initialNormals = source.map((surface, i) => surfaceFrame(surface, initial[i]).normal);
      const cosine = vec3.dot(initialNormals[0], initialNormals[1]);
      if (cosine < -1 + 1e-8 || cosine > 1 - 1e-8) throw new RangeError('Round requires a sharp regular boundary');
      const setback = radius * Math.sqrt((1 - cosine) / (1 + cosine));
      let uv = initial.map((point, i) => moveSurfaceUV(source[i], point, vec3.scale([0, 0, 0], unit(placements[i].inward(point, tangent)), setback)));
      // Fix the station with a contact point on the curved source. The ball's
      // center itself may converge to one point at a sphere's limiting radius.
      const constrain = source[1] instanceof Face ? 0 : 1;
      const evaluate = (values: Point[]) => {
        const points = source.map((surface, i) => atSurface(surface, values[i]));
        const normals = source.map((surface, i) => surfaceFrame(surface, values[i]).normal);
        const centers = points.map((point, i) => vec3.scaleAndAdd([0, 0, 0], point.position, normals[i], -radius));
        return { points, normals, center: centers[0], residual: [...sub(centers[0], centers[1]), vec3.dot(sub(points[constrain].position, origin.position), tangent)] };
      };
      for (let iteration = 0; ; iteration++) {
        const result = evaluate(uv);
        if (Math.hypot(...result.residual) <= Math.max(1e-11, radius * 1e-10)) {
          for (let i = 0; i < 2; i++) if (vec3.dot(sub(result.points[i].position, origin.position), placements[i].inward(initial[i], tangent)) < -topology.tolerance) {
            throw new RangeError('Round requires a convex boundary');
          }
          const value = { uv, points: result.points, normals: result.normals, center: result.center };
          cache.set(t, value); return value;
        }
        if (iteration >= 30) throw new RangeError('Round offset-surface intersection did not converge');
        const columns = [0, 1, 2, 3].map(index => {
          const i = index >> 1, axis = index % 2 === 0 ? 'x' : 'y', h = 1e-5;
          const a = uv.map(point => ({ ...point })), b = uv.map(point => ({ ...point }));
          a[i] = checkedUV(source[i], { ...a[i], [axis]: a[i][axis] - (a[i][axis] < h && source[i] instanceof SpatialSurface ? 0 : h) });
          b[i] = checkedUV(source[i], { ...b[i], [axis]: b[i][axis] + (b[i][axis] > 1 - h && source[i] instanceof SpatialSurface ? 0 : h) });
          const first = evaluate(a).residual, second = evaluate(b).residual;
          return first.map((value, j) => (second[j] - value) / (b[i][axis] - a[i][axis]));
        });
        const step = solve([0, 1, 2, 3].map(row => columns.map(column => column[row])), result.residual.map(value => -value));
        uv = uv.map((point, i) => checkedUV(source[i], { x: point.x + step[2 * i], y: point.y + step[2 * i + 1] }));
      }
    };
    const rails = source.map((_surface, index) => topology.rail(t => pair(t).points[index], boundary));
    for (const { t } of parameterizedSamples(boundary)) for (const rail of rails) if (rail.boundary) {
      const a = Math.max(0, t - 1e-4), b = Math.min(1, t + 1e-4);
      if (vec3.dot(sub(rail.at(b).position, rail.at(a).position), sub(boundary.at(b).position, boundary.at(a).position)) < -(topology.tolerance ** 2)) {
        throw new RangeError('Round radius folds a contact rail beyond its convergence');
      }
    }
    adjacent.forEach((surface, index) => {
      const entries = replacements.get(surface) ?? new Map(), side = placements[index].side;
      entries.set(boundary, { rail: rails[index], uv: (t: number) => {
        const uv = pair(t).uv[index];
        return t === 1 && side ? (side[0] === 'v' ? { ...uv, x: uv.x + 1 } : { ...uv, y: uv.y + 1 }) : uv;
      }, side });
      replacements.set(surface, entries);
    });
    const normal = (u: number, v: number) => spherical(pair(u).normals[0], pair(u).normals[1], v);
    const patch = topology.patch((u, v) => ({ position: vec3.scaleAndAdd([0, 0, 0], pair(u).center, normal(u, v), radius) }),
      { v0: rails[0], v1: rails[1] }, normal, true);
    if (patch) rounded.push(patch);
  }
  const retained = surfaces.flatMap(surface => {
    const entries = replacements.get(surface);
    if (!entries) return [surface];
    const loops = surface.boundaryLoops.map(loop => [...new Set(loop.flatMap(boundary => {
      const trim = entries.get(boundary); return trim ? trim.rail.boundary ? [trim.rail.boundary] : [] : [boundary];
    }))]);
    if (surface instanceof Face) { const face = topology.face(surface, loops); return face ? [face] : []; }
    const original = surface as SpatialSurface;
    const trims = new Map([...entries.values()].map(trim => [trim.side!, trim]));
    const chart = (u: number, v: number): Point => {
      const left = trims.get('u0')?.uv(v) ?? { x: 0, y: v }, right = trims.get('u1')?.uv(v) ?? { x: 1, y: v };
      const bottom = trims.get('v0')?.uv(u) ?? { x: u, y: 0 }, top = trims.get('v1')?.uv(u) ?? { x: u, y: 1 };
      if (right.x < left.x - 1e-8 || top.y < bottom.y - 1e-8) throw new RangeError('Round radius overlaps opposing surface trims');
      return { x: (1 - v) * bottom.x + v * top.x + (1 - u) * left.x + u * right.x - u,
        y: (1 - v) * bottom.y + v * top.y + (1 - u) * left.y + u * right.y - v };
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
