import { vec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { SpatialSurface } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import { SurfaceRegion, type SurfaceTrim } from '../SurfaceRegion.js';
import { orientLoop } from './boundaryLoops.js';
import { parameterizedSamples, sampleParameter } from './curveSamples.js';
import { curveParameter, sliceSpatialCurve } from './curveTrimming.js';
import type { RigidContext } from './rigidContext.js';
import type { Tessellation } from './Tessellation.js';
import type { RoundTopology } from './roundTopology.js';
import { boundaryPlacement } from './surfaceRails.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import { assembleFaces } from './trimFace.js';

type Piece = { start: number; end: number; boundary: SpatialBoundary; parameter(t: number): number; inverse(t: number): number; shared: boolean };

/** Split only at the ends of coincident contact intervals, never at mesh stations. */
export class RoundContacts {
  private readonly pieces = new Map<SpatialBoundary, Piece[]>();
  constructor(private readonly topology: RoundTopology) {}

  private piece(source: SpatialBoundary, start: number, end: number, boundary: SpatialBoundary,
    parameter: (t: number) => number, shared: boolean, linear = true): Piece {
    const forward = new Map<number, number>(), backward = new Map<number, number>();
    const remember = (t: number, value: number) => {
      if (!forward.has(t)) forward.set(t, value);
      backward.set(value, t); return forward.get(t)!;
    };
    remember(0, parameter(0)); remember(1, parameter(1));
    return { start, end, boundary, shared, parameter: t => forward.get(t) ?? remember(t, parameter(t)),
      inverse: value => {
        const cached = backward.get(value);
        if (cached !== undefined) return cached;
        const t = linear ? (value - start) / (end - start) : curveParameter(boundary, source.at(value).position);
        remember(t, value); return t;
      } };
  }

  face(source: Face, loops: readonly (readonly SpatialBoundary[])[], rails: ReadonlySet<SpatialBoundary>): Face[] {
    const boundaries = loops.flat(), tolerance = this.topology.tolerance * 0.01;
    for (let i = 0; i < boundaries.length; i++) for (let j = i + 1; j < boundaries.length; j++) {
      const a = boundaries[i], b = boundaries[j];
      if (!rails.has(a) || !rails.has(b) || !a.isLoop() || !b.isLoop() || a === b) continue;
      const samplesA = parameterizedSamples(a), samplesB = parameterizedSamples(b);
      const near = (firstSamples: typeof samplesA, secondSamples: typeof samplesA) => firstSamples.some(({ point }) => secondSamples.slice(1).some((last, k) => {
        const first = secondSamples[k].point.position, delta = vec3.subtract([0, 0, 0], last.point.position, first);
        const t = Math.max(0, Math.min(1, vec3.dot(vec3.subtract([0, 0, 0], point.position, first), delta) / vec3.squaredLength(delta)));
        return vec3.distance(point.position, vec3.scaleAndAdd([0, 0, 0], first, delta, t)) <= 2 * TRIANGULATION_RESOLUTION;
      }));
      if (!near(samplesA, samplesB) && !near(samplesB, samplesA)) continue;
      const projected = new Map<number, number>();
      const project = (t: number) => {
        let parameter = projected.get(t);
        if (parameter === undefined) { parameter = curveParameter(b, a.at(t).position); projected.set(t, parameter); }
        return parameter;
      };
      const gap = (t: number) => vec3.distance(a.at(t).position, b.at(project(t)).position);
      const seeds = [...new Set([0, 1, ...samplesA.map(s => s.t),
        ...samplesB.map(s => curveParameter(a, s.point.position))])].sort((x, y) => x - y);
      const matches = seeds.slice(1).map((end, k) => {
        const start = seeds[k];
        return end - start > 1e-10 && [start, (start + end) / 2, end].every(t => gap(t) <= tolerance);
      });
      const ranges: [number, number][] = [];
      for (let k = 0; k < matches.length; k++) if (matches[k]) {
        const first = k;
        while (matches[k + 1]) k++;
        const extend = (inside: number, outside: number) => {
          for (let iteration = 0; iteration < 40; iteration++) {
            const mid = (inside + outside) / 2;
            if (gap(mid) <= tolerance) inside = mid; else outside = mid;
          }
          return inside;
        };
        const start = first ? extend(seeds[first], seeds[first - 1]) : 0;
        const end = k + 1 < seeds.length - 1 ? extend(seeds[k + 1], seeds[k + 2]) : 1;
        // A closed curve's parameter seam is also a cut on its coincident mate.
        const seam = curveParameter(a, b.start.position);
        const cuts = seam > start + 1e-9 && seam < end - 1e-9 && gap(seam) <= tolerance ? [start, seam, end] : [start, end];
        for (let n = 1; n < cuts.length; n++) ranges.push([cuts[n - 1], cuts[n]]);
      }
      for (const [start, end] of ranges) {
        const middle = project((start + end) / 2);
        const lift = (t: number) => { let value = project(t); if (value - middle > 0.5) value -= 1; if (value - middle < -0.5) value += 1; return Math.max(0, Math.min(1, value)); };
        const first = lift(start), last = lift(end);
        const vertex = (t: number) => this.topology.vertex(a.at(t).position);
        const boundary = sliceSpatialCurve(a, start, end, vertex(start), vertex(end));
        // Both samplers remain authoritative even when parameter speeds differ.
        const sample = (boundary.sample as SpatialCurve['sample']).bind(boundary);
        const sampledByResolution = new Map<number, Vertex[]>();
        boundary.sample = ({ resolution = TRIANGULATION_RESOLUTION } = {}) => {
          const cached = sampledByResolution.get(resolution);
          if (cached) return [...cached];
          const options = { resolution }, sampled = sample(options);
          const values = [...sampled.map((point, i) => sampleParameter(boundary, point, i, sampled.length)!),
            ...parameterizedSamples(b, options).filter(s => s.t > Math.min(first, last) && s.t < Math.max(first, last))
              .map(s => (curveParameter(a, s.point.position) - start) / (end - start))];
          const parameters = values.filter(t => t >= 0 && t <= 1).sort((x, y) => x - y)
            .filter((t, i, all) => !i || t - all[i - 1] > 256 * Number.EPSILON);
          const points = parameters.map(t => boundary.at(t));
          sampledByResolution.set(resolution, points); return [...points];
        };
        const add = (curve: SpatialBoundary, piece: Piece) => this.pieces.set(curve, [...this.pieces.get(curve) ?? [], piece]);
        add(a, this.piece(a, start, end, boundary, t => start + (end - start) * t, true));
        add(b, this.piece(b, Math.min(first, last), Math.max(first, last), boundary,
          t => t === 0 ? first : t === 1 ? last : lift(start + (end - start) * t), true, false));
      }
    }
    if (!boundaries.some(boundary => this.pieces.has(boundary))) {
      const face = this.topology.face(source, loops); return face ? [face] : [];
    }
    for (const boundary of boundaries) {
      const shared = this.pieces.get(boundary);
      if (!shared) continue;
      shared.sort((a, b) => a.start - b.start);
      const all: Piece[] = [], cuts = [0, ...shared.flatMap(piece => [piece.start, piece.end]), 1];
      for (let i = 1; i < cuts.length; i++) {
        const start = cuts[i - 1], end = cuts[i];
        if (end - start <= 1e-10) continue;
        const match = shared.find(piece => Math.abs(piece.start - start) < 1e-10 && Math.abs(piece.end - end) < 1e-10);
        if (match) { all.push(match); continue; }
        const first = this.topology.vertex(boundary.at(start).position), last = this.topology.vertex(boundary.at(end).position);
        all.push(this.piece(boundary, start, end, sliceSpatialCurve(boundary, start, end, first, last),
          t => start + (end - start) * t, false));
      }
      this.pieces.set(boundary, all);
    }
    return assembleFaces(boundaries.flatMap(boundary => this.pieces.get(boundary)?.filter(piece => !piece.shared).map(piece => piece.boundary) ?? [boundary]), source);
  }

  /** Give adjoining fillets the same exact split rails without adding physical chart seams. */
  surface(surface: Surface): Surface {
    if (!surface.boundaries.some(boundary => this.pieces.has(boundary))) return surface;
    if (!(surface instanceof SpatialSurface)) throw new RangeError('Converging round contacts require a regular fillet chart');
    const replace = (trim: SurfaceTrim): SurfaceTrim[] => this.pieces.get(trim.boundary)?.map(piece => ({
      boundary: piece.boundary, at: (t: number) => trim.at(piece.parameter(t)),
      reversed: !!trim.reversed !== (piece.parameter(1) < piece.parameter(0)),
    })).sort((a, b) => {
      const pa = a.at(a.reversed ? 1 : 0), pb = b.at(b.reversed ? 1 : 0);
      const first = trim.at(trim.reversed ? 1 : 0), last = trim.at(trim.reversed ? 0 : 1);
      return (pa.x - pb.x) * (last.x - first.x) + (pa.y - pb.y) * (last.y - first.y);
    }) ?? [trim];
    const seam = new SpatialCurve({ at: t => surface.at(0, t) });
    const trims: SurfaceTrim[] = [];
    for (const side of ['v0', 'u1', 'v1', 'u0'] as const) {
      const boundary = surface.sides[side], reversed = side === 'v1' || side === 'u0';
      if (boundary) {
        const placement = boundaryPlacement(surface, boundary);
        trims.push(...replace({ boundary, at: placement.uv, reversed: reversed !== placement.reversed }));
      } else {
        if (!surface.periodicU || (side !== 'u0' && side !== 'u1')) throw new RangeError('Converging contacts encounter an unsupported collapsed chart');
        trims.push({ boundary: seam, at: t => ({ x: side === 'u0' ? 0 : 1, y: t }), reversed, physical: false });
      }
    }
    const boundaryLoops = surface.boundaryLoops.map(loop => orientLoop(loop).flatMap(({ boundary, reversed }) => {
      const pieces = this.pieces.get(boundary);
      if (!pieces) return [boundary];
      return (reversed ? [...pieces].reverse() : pieces).map(piece => piece.boundary);
    }));
    return contactRegion(surface, this.pieces, trims, boundaryLoops);
  }
}


/** Retain the full fillet grid while synchronizing its sides with split physical rails. */
function contactGrid(surface: SpatialSurface, pieces: ReadonlyMap<SpatialBoundary, readonly Piece[]>) {
  const bindings: { boundary: SpatialBoundary; pieces: readonly Piece[] }[] = [];
  const sides = Object.fromEntries(Object.entries(surface.sides).map(([side, source]) => {
    const split = source && pieces.get(source);
    if (!split) return [side, source];
    const pieceAt = (t: number) => split.find(piece => t >= piece.start - 1e-12 && t <= piece.end + 1e-12)!;
    const at = (t: number) => {
      const piece = pieceAt(t); return piece.boundary.at(Math.max(0, Math.min(1, piece.inverse(t))));
    };
    const start = at(0), boundary = new SpatialCurve({ at, start, end: source.isLoop() ? start : at(1) });
    const sampled = new Map<number, Vertex[]>();
    boundary.sample = ({ resolution = TRIANGULATION_RESOLUTION } = {}) => {
      const cached = sampled.get(resolution);
      if (cached) return [...cached];
      const values = [...parameterizedSamples(source, { resolution }).map(s => s.t),
        ...split.flatMap(piece => parameterizedSamples(piece.boundary, { resolution }).map(s => piece.parameter(s.t)))].sort((a, b) => a - b);
      const points = values.filter((t, i) => !i || t - values[i - 1] > 256 * Number.EPSILON).map(t => boundary.at(t));
      sampled.set(resolution, points); return [...points];
    };
    bindings.push({ boundary, pieces: split }); return [side, boundary];
  }));
  return new class extends SpatialSurface {
    override sample() { return surface.sample(); }
    private synchronize(context: Tessellation) {
      for (const { boundary, pieces } of bindings) for (const piece of pieces) {
        context.request(boundary, context.parameters(piece.boundary).map(t => piece.parameter(t)));
        context.request(piece.boundary, context.parameters(boundary).filter(t => t >= piece.start && t <= piece.end).map(t => piece.inverse(t)));
      }
    }
    prepareShared(context: Tessellation) { this.synchronize(context); super.prepare(context); this.synchronize(context); }
    meshShared(context: Tessellation) { return super.mesh(context); }
  }({ at: (u, v) => surface.at(u, v), sides, periodicU: surface.periodicU, periodicV: surface.periodicV,
    reversed: surface.reversed, poles: surface.poles });
}


function contactRegion(surface: SpatialSurface, pieces: ReadonlyMap<SpatialBoundary, readonly Piece[]>,
  trims: readonly SurfaceTrim[], boundaryLoops: readonly (readonly SpatialBoundary[])[]): SurfaceRegion {
  const grid = contactGrid(surface, pieces);
  return new class extends SurfaceRegion {
    protected override prepare(context: Tessellation): void { grid.prepareShared(context); }
    protected override mesh(context: Tessellation): Float32Array { return grid.meshShared(context); }
    protected override copyTransformed({ map }: RigidContext): SurfaceRegion {
      return contactRegion(map(surface), new Map([...pieces].map(([boundary, items]) => [map(boundary),
        items.map(piece => ({ ...piece, boundary: map(piece.boundary) }))])),
      trims.map(trim => ({ ...trim, boundary: map(trim.boundary) })), boundaryLoops.map(loop => loop.map(map)));
    }
  }({ surface, regions: [{ outer: trims }], boundaryLoops });
}
