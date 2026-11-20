import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import { RuledSurface } from '../RuledSurface.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface, type SurfaceSides } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import { TrimmedSurface } from '../TrimmedSurface.js';
import type { Vertex } from '../Vertex.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import { parameterizedSamples } from './curveSamples.js';
import { signedArea } from './polygon.js';
import { atSurface, checkedUV, solve3, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';

type Side = keyof SurfaceSides;
type Rail = { boundary: SpatialCurve; uv: (t: number) => Point; side?: Side };
const sub = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.subtract([0, 0, 0], a, b);
const unit = (v: ReadonlyVec3) => {
  if (vec3.length(v) < 1e-12) throw new RangeError('Chamfer encountered a singular boundary');
  return vec3.normalize([0, 0, 0], v);
};

/** Respect source samplers, then refine only where the new rail needs it. */
class ChamferRail extends SpatialCurve {
  private readonly samples = new Map<number, Vertex[]>();
  constructor(at: (t: number) => Vertex, private readonly source: SpatialBoundary) { super({ at }); }
  override sample({ resolution = TRIANGULATION_RESOLUTION }: { resolution?: number } = {}): Vertex[] {
    if (!Number.isFinite(resolution) || resolution <= 0) throw new RangeError('Triangulation resolution must be positive and finite');
    const cached = this.samples.get(resolution);
    if (cached) return [...cached];
    const seeds = parameterizedSamples(this.source, { resolution }), points = [this.at(0)];
    const refine = (a: number, b: number, start: Vertex, end: Vertex, depth: number): void => {
      const t = (a + b) / 2, middle = this.at(t);
      if (vec3.distance(middle.position, vec3.lerp([0, 0, 0], start.position, end.position, 0.5)) > resolution) {
        if (depth >= 20) throw new RangeError('Chamfer rail cannot be sampled at the triangulation resolution');
        refine(a, t, start, middle, depth + 1); refine(t, b, middle, end, depth + 1);
      } else points.push(end);
    };
    for (let i = 0; i + 1 < seeds.length; i++) refine(seeds[i].t, seeds[i + 1].t, points[points.length - 1], this.at(seeds[i + 1].t), 0);
    this.samples.set(resolution, points);
    return [...points];
  }
}

function placement(surface: ParametricFace, boundary: SpatialBoundary) {
  if (surface instanceof Face) {
    const hole = surface.holes.some(loop => loop.includes(boundary));
    const area = signedArea(boundary.sample().slice(0, -1).map(point => surface.plane.toLocal(point)));
    return { uv: (t: number) => surface.plane.toLocal(boundary.at(t)),
      inward: (_uv: Point, tangent: ReadonlyVec3) => vec3.scale([0, 0, 0],
        vec3.cross([0, 0, 0], surface.plane.normal, tangent), Math.sign(area) * (hole ? -1 : 1)), side: undefined };
  }
  const side = (Object.keys(surface.sides) as Side[]).find(key => surface.sides[key] === boundary);
  if (!side) throw new RangeError('Chamfer requires the curved boundary to have a surface parameter side');
  const uv = (t: number): Point => side === 'v0' ? { x: t, y: 0 } : side === 'v1' ? { x: t, y: 1 }
    : side === 'u0' ? { x: 0, y: t } : { x: 1, y: t };
  return { uv, side, inward: (at: Point, tangent: ReadonlyVec3) => {
    const frame = surfaceFrame(surface, at);
    const derivative = side[0] === 'v' ? frame.dv : frame.du;
    const direction = vec3.scale([0, 0, 0], derivative, side[1] === '0' ? 1 : -1);
    return unit(vec3.scaleAndAdd(direction, direction, tangent, -vec3.dot(direction, tangent)));
  } };
}

function moveUV(surface: ParametricFace, uv: Point, displacement: ReadonlyVec3): Point {
  const { du, dv } = surfaceFrame(surface, uv);
  const a = vec3.dot(du, du), b = vec3.dot(du, dv), c = vec3.dot(dv, dv), determinant = a * c - b * b;
  if (determinant < 1e-20) throw new RangeError('Chamfer reaches a singular surface chart');
  const x = vec3.dot(du, displacement), y = vec3.dot(dv, displacement);
  return checkedUV(surface, { x: uv.x + (c * x - b * y) / determinant, y: uv.y + (a * y - b * x) / determinant });
}

function offset(surface: ParametricFace, origin: Vertex, tangent: ReadonlyVec3, uv: Point,
  inward: ReadonlyVec3, length: number, tolerance: number): Point {
  let next = moveUV(surface, uv, vec3.scale([0, 0, 0], inward, length));
  for (let iteration = 0; iteration < 30; iteration++) {
    const delta = sub(atSurface(surface, next).position, origin.position);
    const f = vec3.dot(delta, tangent), g = (vec3.squaredLength(delta) - length * length) / (2 * length);
    if (Math.hypot(f, g) <= tolerance) return next;
    const { du, dv } = surfaceFrame(surface, next);
    const a = vec3.dot(du, tangent), b = vec3.dot(dv, tangent);
    const c = vec3.dot(du, delta) / length, d = vec3.dot(dv, delta) / length;
    const determinant = a * d - b * c;
    if (Math.abs(determinant) < 1e-14) throw new RangeError('Chamfer setback intersection is unresolved');
    next = checkedUV(surface, { x: next.x + (b * g - d * f) / determinant,
      y: next.y + (c * f - a * g) / determinant });
  }
  throw new RangeError('Chamfer setback intersection did not converge');
}

function intersectLine(surface: ParametricFace, uv: Point, origin: Vertex, direction: ReadonlyVec3,
  initialDistance: number, tolerance: number): Point {
  let distance = initialDistance, next = uv;
  for (let iteration = 0; iteration < 30; iteration++) {
    const target = vec3.scaleAndAdd([0, 0, 0], origin.position, direction, distance);
    const delta = sub(target, atSurface(surface, next).position);
    if (vec3.length(delta) <= tolerance) {
      if (distance <= tolerance) throw new RangeError('Chamfer angle does not cut the adjoining surface');
      return next;
    }
    const { du, dv } = surfaceFrame(surface, next);
    const step = solve3(du, dv, vec3.negate([0, 0, 0], direction), delta);
    next = checkedUV(surface, { x: next.x + step[0], y: next.y + step[1] });
    distance += step[2];
  }
  throw new RangeError('Chamfer angle intersection did not converge');
}

/** Bevel smooth closed rims without curve-type equations or faceting the source surfaces. */
export function chamferCurves(surfaces: readonly Surface[], selections: readonly SpatialBoundary[], length: number, angleRAD: number): Surface[] {
  const replacements = new Map<Surface, Map<SpatialBoundary, Rail>>(), bevels: Surface[] = [];
  for (const boundary of selections) {
    if (!boundary.isLoop()) throw new RangeError('Open curved chamfers require curved corner intersection trimming');
    const adjacent = surfaces.filter(surface => surface.boundaries.includes(boundary));
    if (adjacent.length !== 2 || !adjacent.every(surface => surface instanceof Face || surface instanceof SpatialSurface)) {
      throw new RangeError('A chamfer boundary needs exactly two supported adjoining surfaces');
    }
    const [first, second] = adjacent as [ParametricFace, ParametricFace];
    const [a, b] = adjacent.map(surface => placement(surface as ParametricFace, boundary));
    const tolerance = Math.max(length * 1e-9, 1e-10);
    const firstSamples = new Map<number, { uv: Point; point: Vertex; origin: Vertex; tangent: ReadonlyVec3 }>();
    const firstAt = (parameter: number) => {
      const t = parameter === 1 ? 0 : parameter;
      let result = firstSamples.get(t);
      if (result) return result;
      const origin = boundary.at(t), tangent = boundary instanceof SpatialCurve ? boundary.tangent(t)
        : unit(sub(boundary.at(Math.min(1, t + 1e-5)).position, boundary.at(Math.max(0, t - 1e-5)).position));
      const uv = a.uv(t), inward = unit(a.inward(uv, tangent));
      const target = offset(first, origin, tangent, uv, inward, length, tolerance);
      result = { uv: target, point: atSurface(first, target), origin, tangent };
      firstSamples.set(t, result);
      return result;
    };
    const firstRail = new ChamferRail(t => firstAt(t).point, boundary);
    const samples = new Map<number, { uv: Point[]; points: Vertex[] }>();
    const pair = (parameter: number) => {
      const t = parameter === 1 ? 0 : parameter;
      let result = samples.get(t);
      if (result) return result;
      const { origin: point, tangent, point: p0, uv: targetA } = firstAt(t);
      const uvB = b.uv(t), inwardB = unit(b.inward(uvB, tangent));
      const normal = surfaceFrame(first, targetA).normal;
      const railTangent = first instanceof Face ? tangent : firstRail.tangent(t);
      let across = unit(vec3.cross([0, 0, 0], normal, railTangent));
      if (vec3.dot(across, sub(p0.position, point.position)) < 0) across = vec3.negate([0, 0, 0], across);
      const direction = vec3.scaleAndAdd([0, 0, 0], vec3.scale([0, 0, 0], across, -Math.cos(angleRAD)), normal, -Math.sin(angleRAD));
      const targetB = intersectLine(second, moveUV(second, uvB,
        vec3.scale([0, 0, 0], inwardB, length * Math.tan(angleRAD))), p0, direction, length / Math.cos(angleRAD), tolerance);
      const p1 = atSurface(second, targetB);
      if (vec3.dot(sub(p1.position, point.position), inwardB) <= tolerance) throw new RangeError('Chamfer requires a convex boundary and a compatible angle');
      result = { uv: [targetA, targetB], points: [p0, p1] };
      samples.set(t, result);
      return result;
    };
    const rails = [firstRail, new ChamferRail(t => pair(t).points[1], boundary)];
    for (const rail of rails) for (const { t } of rail.sampleWithParameters()) {
      const tangent = boundary instanceof SpatialCurve ? boundary.tangent(t) : sub(boundary.end.position, boundary.start.position);
      if (vec3.dot(rail.tangent(t), tangent) <= 0) throw new RangeError('Chamfer rail folds or converges; use a smaller length');
    }
    adjacent.forEach((surface, index) => {
      const entries = replacements.get(surface) ?? new Map<SpatialBoundary, Rail>();
      entries.set(boundary, { boundary: rails[index], uv: t => {
        const uv = pair(t).uv[index];
        const side = index === 0 ? a.side : b.side;
        // The two ends of a periodic chart have equal positions, distinct UV coordinates.
        return t === 1 && side ? (side[0] === 'v' ? { ...uv, x: uv.x + 1 } : { ...uv, y: uv.y + 1 }) : uv;
      }, side: index === 0 ? a.side : b.side });
      replacements.set(surface, entries);
    });
    const test = pair(0.37), tangent = rails[0].tangent(0.37);
    const normal = vec3.cross([0, 0, 0], tangent, sub(test.points[1].position, test.points[0].position));
    const outward = vec3.add([0, 0, 0], surfaceFrame(first, a.uv(0.37)).normal, surfaceFrame(second, b.uv(0.37)).normal);
    bevels.push(new RuledSurface({ start: rails[0], end: rails[1], reversed: vec3.dot(normal, outward) < 0 }));
  }
  return [...surfaces.map(surface => {
    const entries = replacements.get(surface);
    if (!entries) return surface;
    const loops = surface.boundaryLoops.map(loop => loop.map(boundary => entries.get(boundary)?.boundary ?? boundary));
    if (surface instanceof Face) return new Face({ outer: loops[0], holes: loops.slice(1), plane: surface.plane });
    const source = surface as SpatialSurface;
    const trims = new Map([...entries.values()].map(rail => [rail.side!, rail]));
    const sides = Object.fromEntries(Object.entries(source.sides).map(([side, boundary]) => [side, entries.get(boundary)?.boundary ?? boundary]));
    const chart = (u: number, v: number): Point => {
      const left = trims.get('u0')?.uv(v) ?? { x: 0, y: v }, right = trims.get('u1')?.uv(v) ?? { x: 1, y: v };
      const bottom = trims.get('v0')?.uv(u) ?? { x: u, y: 0 }, top = trims.get('v1')?.uv(u) ?? { x: u, y: 1 };
      return { x: (1 - v) * bottom.x + v * top.x + (1 - u) * left.x + u * right.x - u,
        y: (1 - v) * bottom.y + v * top.y + (1 - u) * left.y + u * right.y - v };
    };
    return new TrimmedSurface({ surface: source, at: chart, boundaryLoops: loops, sides });
  }), ...bevels];
}
