import { parameterizedSamples } from './curveSamples.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import { vec3 } from 'gl-matrix';

type Group = { members: Map<SpatialBoundary, boolean>; symmetric: boolean };
const parameterTolerance = 16 * Number.EPSILON;

/** Per-mesh shared subdivision and vertex storage; never changes analytic topology. */
export class Tessellation {
  revision = 0;
  private requests = new Map<SpatialBoundary, Set<number>>();
  private source = new Map<SpatialBoundary, { t: number; point: Vertex }[]>();
  private groups = new Map<SpatialBoundary, Group>();
  private samples = new Map<SpatialBoundary, Vertex[]>();
  private group(boundary: SpatialBoundary): Group {
    let group = this.groups.get(boundary);
    if (!group) {
      group = { members: new Map([[boundary, false]]), symmetric: false };
      this.groups.set(boundary, group);
    }
    return group;
  }

  /** Synchronize subdivisions, retaining each boundary's direction relative to the group. */
  link(a: SpatialBoundary, b: SpatialBoundary, reversed = false): void {
    const first = this.group(a), second = this.group(b);
    const flip = (first.members.get(a)! !== second.members.get(b)!) !== reversed;
    if (first === second) {
      // A closed chain can identify t with 1-t; its subdivision then needs both.
      if (!flip || first.symmetric) return;
      first.symmetric = true;
    } else {
      for (const [boundary, direction] of second.members) {
        first.members.set(boundary, direction !== flip);
        this.groups.set(boundary, first);
      }
      first.symmetric ||= second.symmetric;
    }
    this.revision++; this.samples.clear();
  }

  /** Request native boundary parameters, retaining sampling overrides and group directions. */
  request(boundary: SpatialBoundary, values: readonly number[]): void {
    const known = this.requests.has(boundary), requested = this.requests.get(boundary) ?? new Set<number>();
    const size = requested.size, existing = this.parameters(boundary);
    for (const value of values) if (!existing.some(t => Math.abs(t - value) <= parameterTolerance)) requested.add(value);
    this.requests.set(boundary, requested);
    if (!known || requested.size !== size) { this.revision++; this.samples.clear(); }
  }

  parameters(boundary: SpatialBoundary): number[] {
    const group = this.group(boundary);
    let values = [...group.members].flatMap(([item, reversed]) => {
      let samples = this.source.get(item);
      if (!samples) this.source.set(item, samples = parameterizedSamples(item));
      return [...samples.map(sample => sample.t), ...(this.requests.get(item) ?? [])].map(t => reversed ? 1 - t : t);
    });
    if (group.symmetric) values = [...values, ...values.map(t => 1 - t)];
    values = values.map(t => t < parameterTolerance ? 0 : t > 1 - parameterTolerance ? 1 : t).sort((a, b) => a - b);
    values = values.filter((t, i) => !i || t - values[i - 1] > parameterTolerance);
    return group.members.get(boundary) ? values.map(t => 1 - t).reverse() : values;
  }

  vertices(boundary: SpatialBoundary): Vertex[] {
    const existing = this.samples.get(boundary);
    if (existing) return existing;
    const group = this.group(boundary);
    if ([...group.members.keys()].some(item => this.requests.has(item))) {
      for (const item of group.members.keys()) {
        const parameters = this.parameters(item);
        const samples = this.source.get(item)!;
        let i = 0;
        const points = parameters.map(t => {
          while (i + 1 < samples.length - 1 && samples[i + 1].t < t - parameterTolerance) i++;
          if (Math.abs(t - samples[i].t) <= parameterTolerance) return samples[i].point;
          if (Math.abs(t - samples[i + 1].t) <= parameterTolerance) return samples[i + 1].point;
          const fraction = (t - samples[i].t) / (samples[i + 1].t - samples[i].t);
          return { position: vec3.lerp([0, 0, 0], samples[i].point.position, samples[i + 1].point.position, fraction) };
        });
        this.samples.set(item, points);
      }
      return this.samples.get(boundary)!;
    }
    const polylines = [...group.members].map(([item, reversed]) => {
      const points = item.sample();
      if (points.length < 2) throw new RangeError('Boundary sampling must include both endpoints');
      return { boundary: item, points: reversed ? [...points].reverse() : points };
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
      this.samples.set(item, group.members.get(item) ? vertices.reverse() : vertices);
    }
    return this.samples.get(boundary)!;
  }
}
