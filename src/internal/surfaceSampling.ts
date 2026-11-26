import { vec3 } from 'gl-matrix';
import type { Vertex } from '../Vertex.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import { sampleParameterTolerance } from './curveSamples.js';

export type SurfaceGrid = { u: number[]; v: number[]; vertices: Vertex[][] };

/** Conforming tensor grid: refine entire parameter lines to avoid internal T junctions. */
export function sampleSurface(surface: { at(u: number, v: number): Vertex }, uSeeds: readonly number[] = [], vSeeds: readonly number[] = []): SurfaceGrid {
  if ([...uSeeds, ...vSeeds].some(t => !Number.isFinite(t) || t < 0 || t > 1)) throw new RangeError('Surface sample parameters must be in [0, 1]');
  // Reversing t twice can differ by a few ulps; those are one grid station.
  const tolerance = sampleParameterTolerance;
  const sorted = (values: readonly number[]) => [0, 0.5, 1, ...values]
    .map(t => t < tolerance ? 0 : t > 1 - tolerance ? 1 : t).sort((a, b) => a - b)
    .filter((t, i, all) => !i || t - all[i - 1] > tolerance);
  let u = sorted(uSeeds), v = sorted(vSeeds);
  const cache = new Map<number, Map<number, Vertex>>();
  const at = (a: number, b: number) => {
    let row = cache.get(a);
    if (!row) { row = new Map(); cache.set(a, row); }
    let point = row.get(b);
    if (!point) row.set(b, point = surface.at(a, b));
    return point;
  };
  for (let level = 0; level < 20; level++) {
    if (u.length * v.length > 1_000_000) throw new RangeError('Surface cannot be tessellated within the sampling budget');
    const addU = new Set<number>(), addV = new Set<number>();
    for (let i = 0; i + 1 < u.length; i++) for (let j = 0; j + 1 < v.length; j++) {
      const a = at(u[i], v[j]).position, b = at(u[i + 1], v[j]).position;
      const c = at(u[i], v[j + 1]).position, d = at(u[i + 1], v[j + 1]).position;
      const um = (u[i] + u[i + 1]) / 2, vm = (v[j] + v[j + 1]) / 2;
      const error = (actual: Vertex, x: typeof a, y: typeof a) => vec3.distance(actual.position, vec3.lerp([0, 0, 0], x, y, 0.5));
      const refineU = Math.max(error(at(um, v[j]), a, b), error(at(um, v[j + 1]), c, d)) > TRIANGULATION_RESOLUTION;
      const refineV = Math.max(error(at(u[i], vm), a, c), error(at(u[i + 1], vm), b, d)) > TRIANGULATION_RESOLUTION;
      if (refineU) addU.add(um);
      if (refineV) addV.add(vm);
      // Include the diagonal used by the triangles, not just the bilinear patch.
      // Resolve known directional curvature first. Otherwise a cylindrical
      // trim needlessly subdivides its perfectly straight direction too.
      if (!refineU && !refineV && error(at(um, vm), a, d) > TRIANGULATION_RESOLUTION) { addU.add(um); addV.add(vm); }
    }
    if (!addU.size && !addV.size) return { u, v, vertices: u.map(a => v.map(b => at(a, b))) };
    u = sorted([...u, ...addU]); v = sorted([...v, ...addV]);
  }
  throw new RangeError('Surface sampling did not converge at the triangulation resolution');
}
