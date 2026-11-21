import { parameterizedSamples } from './curveSamples.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import { vec3 } from 'gl-matrix';

/** Per-mesh shared subdivision and vertex storage; never changes analytic topology. */
export class Tessellation {
  revision = 0;
  private requests = new Map<SpatialBoundary, Set<number>>();
  private source = new Map<SpatialBoundary, { t: number; point: Vertex }[]>();
  private groups = new Map<SpatialBoundary, Set<SpatialBoundary>>();
  private samples = new Map<SpatialBoundary, Vertex[]>();
  /** Synchronize the two parameter directions of a ruled surface before sampling. */
  link(a: SpatialBoundary, b: SpatialBoundary): void {
    const first = this.groups.get(a) ?? new Set([a]), second = this.groups.get(b) ?? new Set([b]);
    const size = first.size;
    for (const boundary of second) first.add(boundary);
    if (first.size !== size) { this.revision++; this.samples.clear(); }
    for (const boundary of first) this.groups.set(boundary, first);
  }

  /** Request matching normalized parameters while retaining sample() overrides. */
  request(boundary: SpatialBoundary, values: readonly number[]): void {
    const group = this.groups.get(boundary) ?? new Set([boundary]);
    for (const item of group) {
      const requested = this.requests.get(item) ?? new Set<number>();
      const size = requested.size;
      const existing = this.parameters(item);
      for (const value of values) requested.add(existing.find(t => Math.abs(t - value) < 1e-10) ?? value);
      this.requests.set(item, requested);
      if (requested.size !== size) { this.revision++; this.samples.clear(); }
    }
  }

  parameters(boundary: SpatialBoundary): number[] {
    const group = this.groups.get(boundary) ?? new Set([boundary]);
    return [...new Set([...group].flatMap(item => {
      let samples = this.source.get(item);
      if (!samples) this.source.set(item, samples = parameterizedSamples(item));
      return [...samples.map(sample => sample.t), ...(this.requests.get(item) ?? [])];
    }))].sort((a, b) => a - b);
  }

  vertices(boundary: SpatialBoundary): Vertex[] {
    const existing = this.samples.get(boundary);
    if (existing) return existing;
    const group = this.groups.get(boundary) ?? new Set([boundary]);
    if ([...group].some(item => this.requests.has(item))) {
      const parameters = this.parameters(boundary);
      for (const item of group) {
        const samples = this.source.get(item)!;
        let i = 0;
        const points = parameters.map(t => {
          while (i + 1 < samples.length - 1 && samples[i + 1].t < t) i++;
          if (t === samples[i].t) return samples[i].point;
          if (t === samples[i + 1].t) return samples[i + 1].point;
          const fraction = (t - samples[i].t) / (samples[i + 1].t - samples[i].t);
          return { position: vec3.lerp([0, 0, 0], samples[i].point.position, samples[i + 1].point.position, fraction) };
        });
        this.samples.set(item, points);
      }
      return this.samples.get(boundary)!;
    }
    const polylines = [...group].map(item => {
      const points = item.sample();
      if (points.length < 2) throw new RangeError('Boundary sampling must include both endpoints');
      return { boundary: item, points };
    });
    // Pair polylines by sample order, retaining every supplied vertex. New
    // vertices interpolate segments; consumers never reevaluate curve equations.
    const fractions = [...new Set(polylines.flatMap(({ points }) => points.map((_, i) => i / (points.length - 1))))].sort((a, b) => a - b);
    for (const { boundary: item, points } of polylines) {
      const vertices = fractions.map(fraction => {
        const index = fraction * (points.length - 1), nearest = Math.round(index);
        if (Math.abs(index - nearest) < 1e-12) return points[nearest];
        const start = Math.floor(index);
        return { position: vec3.lerp([0, 0, 0], points[start].position, points[start + 1].position, index - start) };
      });
      this.samples.set(item, vertices);
    }
    return this.samples.get(boundary)!;
  }
}
