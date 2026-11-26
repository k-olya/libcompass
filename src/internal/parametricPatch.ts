import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { SpatialSurface } from '../SpatialSurface.js';
import { SurfaceRegion, type SurfaceTrim } from '../SurfaceRegion.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import { orientLoop } from './boundaryLoops.js';
import { parameterizedSamples } from './curveSamples.js';
import { containsPoint } from './polygon.js';

export type PatchPath = SurfaceTrim & { physical: boolean };
export type PatchTriangle = { uv: Point[]; points: ReadonlyVec3[]; min: number[]; max: number[] };
const wrap = (t: number) => (t % 1 + 1) % 1;

/** A chart used for analysis, with the original evaluator and physical trims. */
export class ParametricPatch {
  readonly surface: SpatialSurface;
  readonly paths: PatchPath[] = [];
  readonly polygons: Point[][][];
  readonly triangles: PatchTriangle[] = [];
  readonly reversed: boolean;
  private readonly planeAt?: (uv: Point) => Vertex;
  private readonly planeProject?: (point: ReadonlyVec3) => Point;
  constructor(readonly source: Surface, extent: readonly ReadonlyVec3[] = []) {
    if (source instanceof Face) {
      const project = (point: ReadonlyVec3): Point => {
        const d = vec3.subtract([0, 0, 0], point, source.plane.origin);
        return { x: vec3.dot(d, source.plane.xAxis), y: vec3.dot(d, source.plane.yAxis) };
      };
      const loops = source.boundaryLoops.map(loop => orientLoop(loop).flatMap(({ boundary, reversed }) => {
        const points = boundary.sample().map(vertex => project(vertex.position));
        return (reversed ? points.reverse() : points).slice(0, -1);
      }));
      const points = [...loops.flat(), ...extent.map(project)], min = ['x', 'y'].map(k => Math.min(...points.map(p => p[k as keyof Point])));
      const span = ['x', 'y'].map((k, i) => Math.max(...points.map(p => p[k as keyof Point])) - min[i]);
      for (let i = 0; i < 2; i++) { min[i] -= span[i] * 0.1; span[i] *= 1.2; }
      const uv = (p: Point): Point => ({ x: (p.x - min[0]) / span[0], y: (p.y - min[1]) / span[1] });
      this.planeAt = p => source.plane.toWorld({ x: min[0] + span[0] * p.x, y: min[1] + span[1] * p.y });
      this.planeProject = p => uv(project(p));
      this.surface = new SpatialSurface({ at: (u, v) => source.plane.toWorld({ x: min[0] + span[0] * u, y: min[1] + span[1] * v }) });
      this.polygons = [loops.map(loop => loop.map(uv))];
      for (const boundary of source.boundaries) this.paths.push({ boundary, at: t => uv(project(boundary.at(t).position)), physical: true });
      this.reversed = false;
    } else if (source instanceof SurfaceRegion) {
      this.surface = source.surface; this.reversed = source.reversed;
      this.polygons = source.regions.map(chart => [chart.outer, ...(chart.holes ?? [])].map(loop => loop.flatMap(trim => {
        let samples = parameterizedSamples(trim.boundary).map(({ t }) => t).filter(t => t >= (trim.start ?? 0) && t <= (trim.end ?? 1));
        samples = [...new Set([trim.start ?? 0, ...samples, trim.end ?? 1])].sort((a, b) => a - b);
        if (trim.reversed) samples.reverse();
        return samples.slice(0, -1).map(trim.at);
      })));
      this.paths.push(...source.regions.flatMap(chart => [chart.outer, ...(chart.holes ?? [])].flatMap(loop => loop.map(trim => ({ ...trim, physical: trim.physical !== false })))));
    } else if (source instanceof SpatialSurface) {
      this.surface = source; this.reversed = source.reversed;
      this.polygons = [[[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]]];
      for (const [side, at] of Object.entries({ u0: (t: number) => ({ x: 0, y: t }), u1: (t: number) => ({ x: 1, y: t }),
        v0: (t: number) => ({ x: t, y: 0 }), v1: (t: number) => ({ x: t, y: 1 }) })) {
        const boundary = source.sides[side as keyof typeof source.sides];
        if (boundary) this.paths.push({ boundary, at, physical: true });
      }
    } else throw new RangeError('Boolean requires a planar face or a regular parametric surface');
    // Rectangle seams close charts, but never become physical solid edges.
    const seams = new Map<string, SpatialCurve>();
    for (const [axis, value] of [['x', 0], ['x', 1], ['y', 0], ['y', 1]] as const) {
      const periodic = axis === 'x' ? this.surface.periodicU : this.surface.periodicV;
      const at = (t: number): Point => axis === 'x' ? { x: value, y: t } : { x: t, y: value };
      const key = `${axis}:${periodic ? 0 : value}`;
      let boundary = seams.get(key);
      // A collapsed chart side can evaluate to the same pole at every t.
      // Analysis seams need distinct sample identities to retain their UV parameters.
      if (!boundary) { boundary = new SpatialCurve({ at: t => ({ position: this.at(at(t)).position }) }); seams.set(key, boundary); }
      this.paths.push({ boundary, at, physical: false });
    }
    const grid = this.surface.sample();
    const u = new Set(grid.u), v = new Set(grid.v);
    if (source instanceof SpatialSurface) for (const [name, boundary] of Object.entries(source.sides)) if (boundary) {
      const values = name.startsWith('u') ? v : u;
      for (const { t } of parameterizedSamples(boundary)) values.add(t);
    }
    const us = [...u].sort((a, b) => a - b), vs = [...v].sort((a, b) => a - b);
    for (let i = 1; i < us.length; i++) for (let j = 1; j < vs.length; j++) {
      const corners = [{ x: us[i - 1], y: vs[j - 1] }, { x: us[i], y: vs[j - 1] }, { x: us[i], y: vs[j] }, { x: us[i - 1], y: vs[j] }];
      for (const indices of [[0, 1, 2], [0, 2, 3]]) {
        const uv = indices.map(k => corners[k]), points = uv.map(p => this.at(p).position);
        if (vec3.length(vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], points[1], points[0]), vec3.subtract([0, 0, 0], points[2], points[0]))) < 1e-20) continue;
        this.triangles.push({ uv, points, min: [0, 1, 2].map(k => Math.min(...points.map(p => p[k]))), max: [0, 1, 2].map(k => Math.max(...points.map(p => p[k]))) });
      }
    }
  }
  at(uv: Point): Vertex {
    if (this.planeAt) return this.planeAt(uv);
    return this.surface.at(this.surface.periodicU ? wrap(uv.x) : Math.max(0, Math.min(1, uv.x)),
      this.surface.periodicV ? wrap(uv.y) : Math.max(0, Math.min(1, uv.y)));
  }
  contains(uv: Point): boolean { return this.polygons.some(([outer, ...holes]) => containsPoint(outer, uv) && !holes.some(hole => containsPoint(hole, uv))); }
  derivatives(uv: Point): ReadonlyVec3[] {
    return (['x', 'y'] as const).map((axis, i) => {
      const periodic = i ? this.surface.periodicV : this.surface.periodicU;
      const a = periodic ? uv[axis] - 1e-5 : Math.max(0, uv[axis] - 1e-5), b = periodic ? uv[axis] + 1e-5 : Math.min(1, uv[axis] + 1e-5);
      return vec3.scale([0, 0, 0], vec3.subtract([0, 0, 0], this.at({ ...uv, [axis]: b }).position, this.at({ ...uv, [axis]: a }).position), 1 / (b - a));
    });
  }
  project(point: ReadonlyVec3, initial?: Point): Point {
    if (this.planeProject) return this.planeProject(point);
    let uv = initial ? { ...initial } : { x: 0.5, y: 0.5 };
    if (!initial) {
      let distance = Infinity;
      for (const triangle of this.triangles) for (let i = 0; i < 3; i++) {
        const d = vec3.squaredDistance(triangle.points[i], point);
        if (d < distance) { distance = d; uv = triangle.uv[i]; }
      }
    }
    for (let i = 0; i < 30; i++) {
      const [du, dv] = this.derivatives(uv), d = vec3.subtract([0, 0, 0], point, this.at(uv).position);
      const a = vec3.dot(du, du), b = vec3.dot(du, dv), c = vec3.dot(dv, dv), determinant = a * c - b * b;
      if (Math.abs(determinant) < a * c * 1e-14) throw new RangeError('Surface projection reaches a singular parameterization');
      const u = (vec3.dot(d, du) * c - vec3.dot(d, dv) * b) / determinant, v = (vec3.dot(d, dv) * a - vec3.dot(d, du) * b) / determinant;
      uv = { x: uv.x + Math.max(-0.2, Math.min(0.2, u)), y: uv.y + Math.max(-0.2, Math.min(0.2, v)) };
      uv = { x: this.surface.periodicU ? uv.x : Math.max(0, Math.min(1, uv.x)), y: this.surface.periodicV ? uv.y : Math.max(0, Math.min(1, uv.y)) };
      if (Math.abs(u) + Math.abs(v) < 1e-12) break;
    }
    return uv;
  }
}
