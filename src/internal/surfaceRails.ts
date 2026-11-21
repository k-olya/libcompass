import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { SurfaceSides } from '../SpatialSurface.js';
import type { Vertex } from '../Vertex.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import { parameterizedSamples } from './curveSamples.js';
import { signedArea } from './polygon.js';
import { checkedUV, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';
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
    const hole = surface.holes.some(loop => loop.includes(boundary));
    const area = signedArea(boundary.sample().slice(0, -1).map(point => surface.plane.toLocal(point)));
    return { uv: (t: number) => surface.plane.toLocal(boundary.at(t)),
      inward: (_uv: Point, tangent: ReadonlyVec3) => vec3.scale([0, 0, 0],
        vec3.cross([0, 0, 0], surface.plane.normal, tangent), Math.sign(area) * (hole ? -1 : 1)), side: undefined };
  }
  const side = (Object.keys(surface.sides) as Side[]).find(key => surface.sides[key] === boundary);
  if (!side) throw new RangeError('Surface trimming requires the curved boundary to have a surface parameter side');
  const uv = (t: number): Point => side === 'v0' ? { x: t, y: 0 } : side === 'v1' ? { x: t, y: 1 }
    : side === 'u0' ? { x: 0, y: t } : { x: 1, y: t };
  return { uv, side, inward: (at: Point, tangent: ReadonlyVec3) => {
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

