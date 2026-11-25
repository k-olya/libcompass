import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import { SpatialSurface } from '../SpatialSurface.js';
import { SurfaceRegion } from '../SurfaceRegion.js';
import type { Vertex } from '../Vertex.js';

export type ParametricFace = Face | SpatialSurface | SurfaceRegion;
export const atSurface = (surface: ParametricFace, uv: Point): Vertex => surface instanceof Face
  ? surface.plane.toWorld(uv) : surface.at(surface.periodicU ? (uv.x % 1 + 1) % 1 : uv.x,
    surface.periodicV ? (uv.y % 1 + 1) % 1 : uv.y);

/** Numerical differential frame; source evaluators remain authoritative. */
export function surfaceFrame(surface: ParametricFace, uv: Point) {
  if (surface instanceof Face) return { du: surface.plane.xAxis, dv: surface.plane.yAxis, normal: surface.plane.normal };
  const derivative = (axis: 'x' | 'y') => {
    const periodic = axis === 'x' ? surface.periodicU : surface.periodicV;
    if (!periodic && (uv[axis] < 1e-5 || uv[axis] > 1 - 1e-5)) {
      const sign = uv[axis] < 0.5 ? 1 : -1, h = 1e-5;
      const a = atSurface(surface, uv).position, b = atSurface(surface, { ...uv, [axis]: uv[axis] + sign * h }).position;
      const c = atSurface(surface, { ...uv, [axis]: uv[axis] + sign * 2 * h }).position;
      return [0, 1, 2].map(i => sign * (4 * (b[i] - a[i]) - (c[i] - a[i])) / (2 * h)) as vec3;
    }
    const a = periodic ? uv[axis] - 1e-5 : Math.max(0, uv[axis] - 1e-5);
    const b = periodic ? uv[axis] + 1e-5 : Math.min(1, uv[axis] + 1e-5);
    if (a === b) throw new RangeError('Cannot resolve surface derivatives');
    return vec3.scale([0, 0, 0], vec3.subtract([0, 0, 0], atSurface(surface, { ...uv, [axis]: b }).position,
      atSurface(surface, { ...uv, [axis]: a }).position), 1 / (b - a));
  };
  const du = derivative('x'), dv = derivative('y');
  const normal = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], du, dv));
  if (vec3.length(normal) === 0) throw new RangeError('Operation reaches a singular surface');
  if (surface.reversed) vec3.negate(normal, normal);
  return { du, dv, normal };
}

/** Solve a small differential system without reducing coordinates to Float32. */
export function solve3(a: ReadonlyVec3, b: ReadonlyVec3, c: ReadonlyVec3, rhs: ReadonlyVec3): number[] {
  const bc = vec3.cross([0, 0, 0], b, c), determinant = vec3.dot(a, bc);
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12 * vec3.length(a) * vec3.length(b) * vec3.length(c)) {
    throw new RangeError('Surface intersection is tangent or unresolved');
  }
  return [vec3.dot(rhs, bc), vec3.dot(a, vec3.cross([0, 0, 0], rhs, c)),
    vec3.dot(a, vec3.cross([0, 0, 0], b, rhs))].map(value => value / determinant);
}

export function checkedUV(surface: ParametricFace, uv: Point): Point {
  if (![uv.x, uv.y].every(Number.isFinite)) throw new RangeError('Surface operation produced nonfinite parameters');
  if (surface instanceof Face) return uv;
  if ([uv.x, uv.y].some((t, i) => !(i === 0 ? surface.periodicU : surface.periodicV) && (t < -1e-7 || t > 1 + 1e-7))) {
    throw new RangeError('Surface operation exceeds a parameter domain; corner intersection trimming is required');
  }
  return { x: surface.periodicU ? uv.x : Math.max(0, Math.min(1, uv.x)),
    y: surface.periodicV ? uv.y : Math.max(0, Math.min(1, uv.y)) };
}
