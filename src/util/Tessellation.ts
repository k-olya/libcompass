import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import { curveParameters } from './curveSampling.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';

/** Per-mesh shared subdivision and vertex storage; never changes analytic topology. */
export class Tessellation {
  private groups = new Map<SpatialBoundary, Set<SpatialBoundary>>();
  private parameters = new Map<Set<SpatialBoundary>, number[]>();
  private samples = new Map<SpatialBoundary, Vertex[]>();
  private resolutions = new Map<SpatialBoundary, number>();
  private pairs: [SpatialBoundary, SpatialBoundary][] = [];

  /** Refine narrow features below the global maximum deviation to preserve trim separation. */
  requestResolution(boundary: SpatialBoundary, resolution: number): void {
    if (resolution > 0) this.resolutions.set(boundary, Math.min(this.resolutions.get(boundary) ?? TRIANGULATION_RESOLUTION, resolution));
  }

  /** Synchronize the two parameter directions of a ruled surface before sampling. */
  link(a: SpatialBoundary, b: SpatialBoundary): void {
    this.pairs.push([a, b]);
    const first = this.groups.get(a) ?? new Set([a]), second = this.groups.get(b) ?? new Set([b]);
    for (const boundary of second) first.add(boundary);
    for (const boundary of first) this.groups.set(boundary, first);
  }

  vertices(boundary: SpatialBoundary): Vertex[] {
    const existing = this.samples.get(boundary);
    if (existing) return existing;
    const group = this.groups.get(boundary) ?? new Set([boundary]);
    let parameters = this.parameters.get(group);
    if (!parameters) {
      const resolution = Math.min(TRIANGULATION_RESOLUTION, ...[...group].map(item => this.resolutions.get(item) ?? TRIANGULATION_RESOLUTION));
      const initial = [...new Set([...group].flatMap(item => item instanceof SpatialCurve ? [...curveParameters(item, resolution)] : [0, 1]))].sort((a, b) => a - b);
      const pairs = this.pairs.filter(([a]) => group.has(a));
      parameters = [0];
      const refine = (a: number, b: number, depth: number): void => {
        const error = Math.max(0, ...pairs.map(([start, end]) => {
          const p = start.at(a).position, q = start.at(b).position;
          const r = end.at(a).position, s = end.at(b).position;
          const curvature = Math.max(...[start, end].flatMap(boundary => {
            const from = boundary === start ? p : r, to = boundary === start ? q : s;
            return [0.25, 0.5, 0.75].map(t => {
              const point = boundary.at(a + (b - a) * t).position;
              return Math.hypot(...[0, 1, 2].map(i => point[i] - (from[i] + (to[i] - from[i]) * t)));
            });
          }));
          // A conservative bound on the bilinear strip's deviation from its two triangles.
          const twist = Math.hypot(...[0, 1, 2].map(i => (s[i] - q[i]) - (r[i] - p[i]))) / 4;
          return curvature + twist;
        }));
        if (error > resolution) {
          if (depth >= 20) throw new RangeError('Surface cannot be triangulated at the library resolution');
          const middle = (a + b) / 2;
          refine(a, middle, depth + 1); refine(middle, b, depth + 1);
        } else parameters!.push(b);
      };
      for (let i = 0; i + 1 < initial.length; i++) refine(initial[i], initial[i + 1], 0);
      this.parameters.set(group, parameters);
    }
    const result = parameters.map(t => t === 0 ? boundary.start : t === 1 ? boundary.end : boundary.at(t));
    this.samples.set(boundary, result);
    return result;
  }
}
