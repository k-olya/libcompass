import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface, type SurfaceSides } from '../SpatialSurface.js';
import type { Vertex } from '../Vertex.js';
import { parameterizedSamples } from './curveSamples.js';
import { signedArea } from './polygon.js';
import { SurfaceRail } from './surfaceRails.js';

type Side = keyof SurfaceSides;
export type RoundRail = { boundary?: SpatialBoundary; at(t: number): Vertex };
export const sub = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.subtract([0, 0, 0], a, b);
export const unit = (a: ReadonlyVec3) => {
  if (vec3.length(a) < 1e-12) throw new RangeError('Round reaches a singular direction');
  return vec3.normalize([0, 0, 0], a);
};
/** Great-circle interpolation keeps every fillet cross section at the specified radius. */
export function spherical(a: ReadonlyVec3, b: ReadonlyVec3, t: number): vec3 {
  const turnRAD = Math.acos(Math.max(-1, Math.min(1, vec3.dot(a, b))));
  if (turnRAD > Math.PI - 1e-7) throw new RangeError('Round encounters opposing surface normals');
  if (turnRAD < 1e-7) return unit(vec3.lerp([0, 0, 0], a, b, t));
  return vec3.add([0, 0, 0], vec3.scale([0, 0, 0], a, Math.sin((1 - t) * turnRAD) / Math.sin(turnRAD)),
    vec3.scale([0, 0, 0], b, Math.sin(t * turnRAD) / Math.sin(turnRAD)));
}

/** Sew tangent-limit rails and singular poles before creating physical topology. */
export class RoundTopology {
  readonly tolerance: number;
  private readonly vertices = new Map<string, Vertex[]>();
  private readonly rails: SpatialBoundary[] = [];
  constructor(radius: number) { this.tolerance = Math.max(1e-10, radius * 1e-8); }

  vertex(position: ReadonlyVec3): Vertex {
    const cell = Array.from(position, value => Math.round(value / this.tolerance));
    for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
      const points = this.vertices.get([cell[0] + x, cell[1] + y, cell[2] + z].join(','));
      const match = points?.find(point => vec3.distance(position, point.position) <= this.tolerance);
      if (match) return match;
    }
    const vertex = { position: [...position] as vec3 }, key = cell.join(',');
    this.vertices.set(key, [...(this.vertices.get(key) ?? []), vertex]);
    return vertex;
  }

  rail(evaluate: (t: number) => Vertex, source?: SpatialBoundary, straight = false): RoundRail {
    const start = this.vertex(evaluate(0).position), end = this.vertex(evaluate(1).position);
    const at = (t: number) => t === 0 ? start : t === 1 ? end : evaluate(t);
    const candidate = source ? new SurfaceRail(at, source, { start, end }) : new SpatialCurve({ at, start, end });
    const samples = candidate.sample();
    if (samples.every(point => vec3.distance(point.position, start.position) <= this.tolerance)) return { at: () => start };
    const boundary = straight ? new Edge({ start, end }) : candidate;
    for (const previous of this.rails) {
      const reverse = previous.start === end && previous.end === start;
      if (!reverse && !(previous.start === start && previous.end === end)) continue;
      const parameters = [...new Set([...parameterizedSamples(boundary).map(({ t }) => t),
        ...parameterizedSamples(previous).map(({ t }) => reverse ? 1 - t : t)])];
      // Closed rims have the same start and end in both directions; test both lifts.
      for (const flipped of previous.isLoop() ? [false, true] : [reverse]) {
        if (parameters.every(t => vec3.distance(boundary.at(t).position, previous.at(flipped ? 1 - t : t).position) <= this.tolerance)) {
          return { boundary: previous, at: t => previous.at(flipped ? 1 - t : t) };
        }
      }
    }
    this.rails.push(boundary);
    return { boundary, at: t => boundary.at(t) };
  }

  face(source: Face, loops: readonly (readonly SpatialBoundary[])[]): Face | undefined {
    const area = (loop: readonly SpatialBoundary[]) => {
      if (!loop.length) return 0;
      // Loop order supplies direction, while an individual shared boundary may run backwards.
      const points: Vertex[] = [];
      let current = loop[0].start;
      if (loop.length > 1 && loop[0].end !== loop[1].start && loop[0].end !== loop[1].end) current = loop[0].end;
      for (const boundary of loop) {
        const reversed = boundary.start !== current, samples = boundary.sample();
        points.push(...(reversed ? samples.reverse() : samples).slice(0, -1));
        current = reversed ? boundary.start : boundary.end;
      }
      return Math.abs(signedArea(points.map(point => source.plane.toLocal(point))));
    };
    const areas = loops.map(area), material = (areas[0] ?? 0) - areas.slice(1).reduce((a, b) => a + b, 0);
    const tolerance = this.tolerance * Math.max(1, Math.sqrt(areas[0] ?? 0));
    if (material < -tolerance) throw new RangeError('Round radius consumes or inverts a face');
    if (material <= tolerance) return undefined;
    return new Face({ plane: source.plane, outer: loops[0], holes: loops.slice(1).filter((_, i) => areas[i + 1] > tolerance) });
  }

  patch(evaluate: (u: number, v: number) => Vertex, rails: Partial<Record<Side, RoundRail>>,
    outward: (u: number, v: number) => ReadonlyVec3, periodicU = false): SpatialSurface | undefined {
    const side = (key: Side) => rails[key]?.boundary;
    const at = (u: number, v: number) => {
      if (v === 0 && rails.v0) return rails.v0.at(u);
      if (v === 1 && rails.v1) return rails.v1.at(u);
      if (u === 0 && rails.u0) return rails.u0.at(v);
      if (u === 1 && rails.u1) return rails.u1.at(v);
      return evaluate(u, v);
    };
    // A whole patch can converge to a rail when opposing rounds consume its source face.
    const du = sub(at(0.501, 0.37).position, at(0.499, 0.37).position);
    const dv = sub(at(0.5, 0.371).position, at(0.5, 0.369).position);
    const normal = vec3.cross([0, 0, 0], du, dv);
    if (vec3.length(normal) <= this.tolerance ** 2) return undefined;
    const sides: SurfaceSides = { u0: side('u0'), u1: side('u1'), v0: side('v0'), v1: side('v1') };
    const boundaryLoops = periodicU ? [side('v0'), side('v1')].filter((b): b is SpatialBoundary => !!b).map(b => [b])
      : [[side('v0'), side('u1'), side('v1'), side('u0')].filter((b): b is SpatialBoundary => !!b)];
    const poles = [...new Set(Object.values(rails).filter(rail => !rail.boundary).map(rail => rail.at(0)))];
    return new SpatialSurface({ at, sides, boundaryLoops, periodicU, poles, reversed: vec3.dot(normal, outward(0.5, 0.37)) < 0 });
  }
}
