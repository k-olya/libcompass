import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import { parameterizedSamples, rememberSample, sampleParameterTolerance } from './curveSamples.js';

export type BoundaryJoin = {
  boundary: SpatialBoundary;
  split: number;
  pieces: { source: SpatialBoundary; to: (t: number) => number; from: (t: number) => number }[];
};

/** Compose tangent equations, preserving original parameterized samples. */
export function joinSpatialBoundaries(a: SpatialBoundary, b: SpatialBoundary, vertex: Vertex, tolerance: number): BoundaryJoin | undefined {
  if (a.isLoop() || b.isLoop()) return;
  const reversed = [a.start === vertex, b.end === vertex];
  const sources = [a, b], first = reversed[0] ? a.end : a.start, last = reversed[1] ? b.start : b.end;
  const tangent = (source: SpatialBoundary, t: number, reverse: boolean) => {
    const direction = source instanceof SpatialCurve ? source.tangent(t) : vec3.normalize([0, 0, 0], vec3.subtract([0, 0, 0], source.end.position, source.start.position));
    return reverse ? vec3.negate([0, 0, 0], direction) : direction;
  };
  const smooth = (ta: number, tb: number) => vec3.dot(tangent(a, ta, reversed[0]), tangent(b, tb, reversed[1])) > 0
    && vec3.length(vec3.cross([0, 0, 0], tangent(a, ta, reversed[0]), tangent(b, tb, reversed[1]))) <= 1e-7;
  if (!smooth(reversed[0] ? 0 : 1, reversed[1] ? 1 : 0)) return;
  if (first === last && !smooth(reversed[0] ? 1 : 0, reversed[1] ? 0 : 1)) return;
  const lengths = sources.map(source => {
    const samples = source.sample();
    return samples.slice(1).reduce((length, point, i) => length + vec3.distance(samples[i].position, point.position), 0);
  });
  const split = lengths[0] / (lengths[0] + lengths[1]);
  const pieces = sources.map((source, i) => {
    const start = i ? split : 0, width = i ? 1 - split : split;
    return { source, to: (t: number) => start + width * (reversed[i] ? 1 - t : t),
      from: (t: number) => Math.max(0, Math.min(1, reversed[i] ? 1 - (t - start) / width : (t - start) / width)) };
  });
  const locate = (t: number) => pieces[t <= split ? 0 : 1];
  const boundary = a instanceof Edge && b instanceof Edge ? new Edge({ start: first, end: last }) : new SpatialCurve({ start: first, end: last,
    at: t => { const piece = locate(t); return piece.source.at(piece.from(t)); },
    tangent: t => { const index = t <= split ? 0 : 1; return tangent(sources[index], pieces[index].from(t), reversed[index]); },
  });
  boundary.sample = (options = {}) => pieces.flatMap((piece, index) => {
    const samples = parameterizedSamples(piece.source, options);
    if (reversed[index]) samples.reverse();
    return samples.flatMap(({ point, t }, i) => {
      if (index && !i) return [];
      const parameter = piece.to(t);
      return [rememberSample(boundary, parameter === 0 ? first : parameter === 1 ? last : point, parameter)];
    });
  });
  // Native charts can round-trip a sample parameter through several affine
  // trims. Keep that same station instead of requesting a neighboring sliver.
  const samples = parameterizedSamples(boundary);
  for (const piece of pieces) {
    const to = piece.to;
    piece.to = value => {
      const t = to(value), point = boundary.at(t);
      const closest = samples.find(sample => Math.abs(sample.t - t) <= sampleParameterTolerance
        && vec3.distance(sample.point.position, point.position) <= tolerance);
      return closest?.t ?? t;
    };
  }
  return { boundary, split, pieces };
}
