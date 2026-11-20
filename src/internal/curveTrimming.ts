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
