import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import { SurfaceRegion } from '../SurfaceRegion.js';
import type { Point } from '../Point.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { SurfaceSides } from '../SpatialSurface.js';
import type { Vertex } from '../Vertex.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import { parameterizedSamples } from './curveSamples.js';
import { signedArea } from './polygon.js';
import { orientLoop } from './boundaryLoops.js';
import { atSurface, checkedUV, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';
type Side = keyof SurfaceSides;
const unit = (v: ReadonlyVec3) => {
  if (vec3.length(v) < 1e-12) throw new RangeError('Surface rail encountered a singular boundary');
  return vec3.normalize([0, 0, 0], v);
};

/** Respect source samplers, then refine only where the new rail needs it. */
export class SurfaceRail extends SpatialCurve {
  private readonly samples = new Map<number, Vertex[]>();
  constructor(at: (t: number) => Vertex, private readonly source: SpatialBoundary, endpoints: { start?: Vertex; end?: Vertex } = {}) { super({ at, ...endpoints }); }
  override sample({ resolution = TRIANGULATION_RESOLUTION }: { resolution?: number } = {}): Vertex[] {
    if (!Number.isFinite(resolution) || resolution <= 0) throw new RangeError('Triangulation resolution must be positive and finite');
    const cached = this.samples.get(resolution);
    if (cached) return [...cached];
    const seeds = parameterizedSamples(this.source, { resolution }), points = [this.at(0)];
    const refine = (a: number, b: number, start: Vertex, end: Vertex, depth: number): void => {
      const t = (a + b) / 2, middle = this.at(t);
      if (vec3.distance(middle.position, vec3.lerp([0, 0, 0], start.position, end.position, 0.5)) > resolution) {
        if (depth >= 20) throw new RangeError('Surface rail cannot be sampled at the triangulation resolution');
        refine(a, t, start, middle, depth + 1); refine(t, b, middle, end, depth + 1);
      } else points.push(end);
    };
    for (let i = 0; i + 1 < seeds.length; i++) refine(seeds[i].t, seeds[i + 1].t, points[points.length - 1], this.at(seeds[i + 1].t), 0);
    this.samples.set(resolution, points);
    return [...points];
  }
}

export function boundaryPlacement(surface: ParametricFace, boundary: SpatialBoundary) {
  if (surface instanceof Face) {
    const loop = surface.boundaryLoops.find(loop => loop.includes(boundary));
    if (!loop) throw new RangeError('Boundary does not belong to the face');
    const pieces = orientLoop(loop), reversed = pieces.find(piece => piece.boundary === boundary)!.reversed;
    const area = signedArea(pieces.flatMap(piece => {
      const points = piece.boundary.sample();
      return (piece.reversed ? [...points].reverse() : points).slice(0, -1).map(point => surface.plane.toLocal(point));
    }));
    const sign = Math.sign(area) * (surface.holes.includes(loop) ? -1 : 1) * (reversed ? -1 : 1);
    return { uv: (t: number) => surface.plane.toLocal(boundary.at(t)),
      inward: (_uv: Point, tangent: ReadonlyVec3) => vec3.scale([0, 0, 0],
        vec3.cross([0, 0, 0], surface.plane.normal, tangent), sign), side: undefined, reversed: false };
  }
  if (surface instanceof SurfaceRegion) {
    const parameters = new Map<SpatialBoundary, number[]>();
    const sampled = (boundary: SpatialBoundary) => {
      let values = parameters.get(boundary);
      if (!values) { values = parameterizedSamples(boundary).map(({ t }) => t); parameters.set(boundary, values); }
      return values;
    };
    const paths = surface.regions.flatMap(chart => [chart.outer, ...(chart.holes ?? [])].flatMap((loop, index) => {
      const polygon = loop.flatMap(trim => {
        const values = [...new Set([trim.start ?? 0, ...sampled(trim.boundary)
          .filter(t => t > (trim.start ?? 0) && t < (trim.end ?? 1)), trim.end ?? 1])].sort((a, b) => a - b);
        if (trim.reversed) values.reverse();
        return values.slice(0, -1).map(trim.at);
      });
      return loop.filter(trim => trim.physical !== false && trim.boundary === boundary).map(trim => ({ trim,
        sign: Math.sign(signedArea(polygon)) * (index ? -1 : 1) * (trim.reversed ? -1 : 1) * (surface.reversed ? -1 : 1) }));
    })).sort((a, b) => (a.trim.start ?? 0) - (b.trim.start ?? 0));
    if (!paths.length) throw new RangeError('Boundary does not belong to the surface region');
    let end = paths[0].trim.at(paths[0].trim.start ?? 0);
    const lifted = paths.map(({ trim, sign }) => {
      const start = trim.at(trim.start ?? 0), shift = { x: surface.periodicU ? Math.round(end.x - start.x) : 0,
        y: surface.periodicV ? Math.round(end.y - start.y) : 0 };
      const at = (t: number) => { const p = trim.at(t); return { x: p.x + shift.x, y: p.y + shift.y }; };
      end = at(trim.end ?? 1); return { trim, sign, at };
    });
    const path = (t: number) => {
      const found = lifted.find(({ trim }) => t >= (trim.start ?? 0) - 1e-10 && t <= (trim.end ?? 1) + 1e-10);
      if (!found) throw new RangeError('Surface region does not retain the full boundary interval');
      return found;
    };
    return { uv: (t: number) => path(t).at(t), side: undefined, reversed: false,
      inward: (uv: Point, tangent: ReadonlyVec3) => vec3.scale([0, 0, 0],
        vec3.cross([0, 0, 0], surfaceFrame(surface, uv).normal, tangent), lifted[0].sign) };
  }
  const side = (Object.keys(surface.sides) as Side[]).find(key => surface.sides[key] === boundary);
  if (!side) throw new RangeError('Surface trimming requires the curved boundary to have a surface parameter side');
  const nativeUV = (t: number): Point => side === 'v0' ? { x: t, y: 0 } : side === 'v1' ? { x: t, y: 1 }
    : side === 'u0' ? { x: 0, y: t } : { x: 1, y: t };
  const probes = boundary.isLoop() ? [0.25, 0.75] : [0, 1];
  const error = (reverse: boolean) => probes.reduce((sum, t) => sum + vec3.squaredDistance(
    boundary.at(t).position, atSurface(surface, nativeUV(reverse ? 1 - t : t)).position), 0);
  const reversed = error(true) < error(false), uv = (t: number) => nativeUV(reversed ? 1 - t : t);
  return { uv, side, reversed, inward: (at: Point, tangent: ReadonlyVec3) => {
    const frame = surfaceFrame(surface, at);
    const derivative = side[0] === 'v' ? frame.dv : frame.du;
    const direction = vec3.scale([0, 0, 0], derivative, side[1] === '0' ? 1 : -1);
    return unit(vec3.scaleAndAdd(direction, direction, tangent, -vec3.dot(direction, tangent)));
  } };
}

export function moveSurfaceUV(surface: ParametricFace, uv: Point, displacement: ReadonlyVec3): Point {
  const { du, dv } = surfaceFrame(surface, uv);
  const a = vec3.dot(du, du), b = vec3.dot(du, dv), c = vec3.dot(dv, dv), determinant = a * c - b * b;
  if (determinant < 1e-20) throw new RangeError('Surface rail reaches a singular surface chart');
  const x = vec3.dot(du, displacement), y = vec3.dot(dv, displacement);
  return checkedUV(surface, { x: uv.x + (c * x - b * y) / determinant, y: uv.y + (a * y - b * x) / determinant });
}

