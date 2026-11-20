import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import { vec3 } from 'gl-matrix';

/** Per-mesh shared subdivision and vertex storage; never changes analytic topology. */
export class Tessellation {
  private groups = new Map<SpatialBoundary, Set<SpatialBoundary>>();
  private samples = new Map<SpatialBoundary, Vertex[]>();
  /** Synchronize the two parameter directions of a ruled surface before sampling. */
  link(a: SpatialBoundary, b: SpatialBoundary): void {
    const first = this.groups.get(a) ?? new Set([a]), second = this.groups.get(b) ?? new Set([b]);
    for (const boundary of second) first.add(boundary);
    for (const boundary of first) this.groups.set(boundary, first);
  }

  vertices(boundary: SpatialBoundary): Vertex[] {
    const existing = this.samples.get(boundary);
    if (existing) return existing;
    const group = this.groups.get(boundary) ?? new Set([boundary]);
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
