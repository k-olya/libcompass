import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { LineSegment } from '../LineSegment.js';
import { PlanarCurve } from '../PlanarCurve.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Point } from '../Point.js';
import type { Vertex } from '../Vertex.js';
import { parameterizedSamples, sampleParameter } from './curveSamples.js';
import { uniqueParameters, type PlanarBoundary } from './curveIntersections.js';

const parameter = (t: number): number => t > 1 ? t - 1 : t;
function retainedParameters(source: { sample(options?: { resolution?: number }): object[] }, start: number, end: number, options: { resolution?: number }): number[] {
  return parameterizedSamples(source, options).flatMap(({ t }) => [t, t + 1])
    .filter(t => t > start && t < end).map(t => (t - start) / (end - start));
}

/** Reparameterize exact equations; derived samplers retain all source samples in the range. */
export function slicePlanarCurve(curve: PlanarBoundary, start: number, end: number, first = start === 0 ? curve.start : curve.at(parameter(start)), last = end === 1 ? curve.end : curve.at(parameter(end))): PlanarBoundary {
  if (curve instanceof LineSegment) return new LineSegment({ start: first, end: last });
  const source = curve;
  class Trim extends PlanarCurve {
    override sample(options: { resolution?: number } = {}): Point[] {
      const own = super.sample(options).map((point, i, points) => sampleParameter(this, point, i, points.length)!);
      return uniqueParameters([...own, ...retainedParameters(source, start, end, options)]).map(t => this.at(t));
    }
  }
  return new Trim({ at: t => curve.at(parameter(start + (end - start) * t)),
    tangent: t => curve.tangent(parameter(start + (end - start) * t)), start: first, end: last });
}

export function sliceSpatialCurve(curve: SpatialBoundary, start: number, end: number, first = start === 0 ? curve.start : curve.at(parameter(start)), last = end === 1 ? curve.end : curve.at(parameter(end))): SpatialBoundary {
  if (curve instanceof Edge) return new Edge({ start: first, end: last });
  class Trim extends SpatialCurve {
    override sample(options: { resolution?: number } = {}): Vertex[] {
      const own = super.sample(options).map((point, i, points) => sampleParameter(this, point, i, points.length)!);
      return uniqueParameters([...own, ...retainedParameters(curve, start, end, options)]).map(t => this.at(t));
    }
  }
  return new Trim({ at: t => curve.at(parameter(start + (end - start) * t)),
    tangent: curve instanceof SpatialCurve ? t => curve.tangent(parameter(start + (end - start) * t)) : undefined, start: first, end: last });
}

/** Closest parameter refines sampled candidates against the original curve. */
export function curveParameter(curve: SpatialBoundary, point: ReadonlyVec3): number {
  const samples = parameterizedSamples(curve); let best = 0, error = Infinity;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i], direction = vec3.subtract([0, 0, 0], b.point.position, a.point.position);
    const fraction = Math.max(0, Math.min(1, vec3.dot(vec3.subtract([0, 0, 0], point, a.point.position), direction) / vec3.squaredLength(direction)));
    const d = vec3.squaredDistance(vec3.lerp([0, 0, 0], a.point.position, b.point.position, fraction), point);
    if (d < error) { error = d; best = a.t + (b.t - a.t) * fraction; }
  }
  for (let i = 0; i < 20; i++) {
    const low = Math.max(0, best - 1e-6), high = Math.min(1, best + 1e-6);
    const derivative = vec3.scale([0, 0, 0], vec3.subtract([0, 0, 0], curve.at(high).position, curve.at(low).position), 1 / (high - low));
    const delta = vec3.dot(vec3.subtract([0, 0, 0], point, curve.at(best).position), derivative) / vec3.squaredLength(derivative);
    best = Math.max(0, Math.min(1, best + delta)); if (Math.abs(delta) < 1e-12) break;
  }
  return best;
}
