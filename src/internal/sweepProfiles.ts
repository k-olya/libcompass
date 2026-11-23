import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import type { Point } from '../Point.js';
import type { Vertex } from '../Vertex.js';
import { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { SpatialSurface } from '../SpatialSurface.js';
import { Surface } from '../Surface.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import { rememberSample } from './curveSamples.js';
import { profileNesting, type Profile } from './profiles.js';
import { sampleSurface, type SurfaceGrid } from './surfaceSampling.js';
import type { sweepFrames } from './sweepFrames.js';
import { validateSweepMesh } from './validateSweepMesh.js';

/** A sweep seeds its generic surface sampler from both source curve samplers. */
class SweptSurface extends SpatialSurface {
  private sampled?: SurfaceGrid;
  private sampledResolution?: number;
  constructor(options: ConstructorParameters<typeof SpatialSurface>[0], private readonly u: readonly number[], private readonly v: readonly number[]) { super(options); }
  override sample(): SurfaceGrid {
    if (!this.sampled || this.sampledResolution !== TRIANGULATION_RESOLUTION) {
      this.sampled = sampleSurface(this, this.u, this.v);
      this.sampledResolution = TRIANGULATION_RESOLUTION;
    }
    return this.sampled;
  }
}

/** Build exact surfaces and physical topology for a parameterized rigid profile sweep. */
export function sweepProfiles(profiles: Profile[], sweep: Pick<ReturnType<typeof sweepFrames>, 'closed' | 'parameters' | 'frame' | 'place'> & {
  /** Shared fixed vertices where trajectories collapse, e.g. points on a revolution axis. */
  stationary?: (point: Point) => Vertex | undefined;
}, orientation = 1): Solid {
  const { parents, depths } = profileNesting(profiles);
  const surfaces: Surface[] = [];
  const capPlane = (t: number, sign: number) => {
    const frame = sweep.frame(t);
    return new Plane({ a: frame.origin, b: vec3.add([0, 0, 0], frame.origin, frame.xAxis),
      c: vec3.scaleAndAdd([0, 0, 0], frame.origin, frame.yAxis, sign) });
  };
  const lift = (index: number) => {
    const profile = profiles[index], hole = depths[index] % 2 !== 0;
    const reverse = (profile.signedArea > 0) === hole;
    const entries = reverse ? [...profile.boundaries].reverse().map(entry => ({ ...entry, reversed: !entry.reversed })) : profile.boundaries;
    const points = entries.map(({ curve, reversed }) => reversed ? curve.end : curve.start);
    const poles = points.map(point => sweep.stationary?.(point));
    const lowerVertices = points.map((point, i) => poles[i] ?? sweep.place(point, 0));
    const upperVertices = sweep.closed ? lowerVertices : points.map((point, i) => poles[i] ?? sweep.place(point, 1));
    const tracks = points.map((point, i) => {
      if (poles[i]) return undefined;
      const track = new SpatialCurve({ at: v => sweep.place(point, v), start: lowerVertices[i], end: upperVertices[i] });
      track.sample = () => sweep.parameters.map(t => track.at(t));
      return track;
    });
    const lower: SpatialBoundary[] = [], upper: SpatialBoundary[] = [];
    entries.forEach((entry, i) => {
      const next = (i + 1) % entries.length, periodicU = !entry.straight && entry.curve.isLoop();
      const local = (u: number) => entry.curve.at(entry.reversed ? 1 - u : u);
      const sourceSamples = () => {
        const points = entry.straight ? [{ t: 0, point: entry.curve.start }, { t: 1, point: entry.curve.end }]
          : entry.curve.sampleWithParameters({ resolution: TRIANGULATION_RESOLUTION / 2 });
        return entry.reversed ? points.reverse().map(sample => ({ ...sample, t: 1 - sample.t })) : points;
      };
      const rim = (v: number): SpatialBoundary => {
        const vertices = v === 0 ? lowerVertices : upperVertices;
        if (entry.straight) return new Edge({ start: vertices[i], end: vertices[next] });
        const boundary = new SpatialCurve({ at: u => sweep.place(local(u), v), start: vertices[i], end: vertices[next] });
        boundary.sample = () => {
          const samples = sourceSamples();
          return samples.map(({ t, point }, j) => rememberSample(boundary,
            j === 0 ? boundary.start : j === samples.length - 1 ? boundary.end : sweep.place(point, v), t));
        };
        return boundary;
      };
      const stationary = sweep.stationary !== undefined && sourceSamples().every(({ point }) => sweep.stationary?.(point));
      const start = rim(0), end = sweep.closed || stationary ? start : rim(1);
      lower.push(start); upper.push(end);
      // An axis boundary has no swept area. On partial turns it remains one
      // shared boundary between the two end caps, rather than a zero-area wall.
      if (stationary) return;
      const at = (u: number, v: number) => {
        if (!periodicU && u === 0) return poles[i] ?? tracks[i]!.at(v);
        if (!periodicU && u === 1) return poles[next] ?? tracks[next]!.at(v);
        if (!sweep.closed && v === 0) return start.at(u);
        if (!sweep.closed && v === 1) return end.at(u);
        return sweep.place(local(u), v);
      };
      // Check forward motion at sampled boundary points: a reversed axial
      // derivative signals an offset fold before global intersection testing.
      for (const { t: u } of sourceSamples()) for (const v of sweep.parameters) {
        if (sweep.stationary?.(local(u))) continue;
        const h = 1e-5, a = Math.max(0, v - h), b = Math.min(1, v + h);
        const velocity = vec3.subtract([0, 0, 0], at(u, b).position, at(u, a).position);
        if (orientation * vec3.dot(velocity, sweep.frame(v).normal) <= 0) throw new RangeError('Sweep profile folds along the path; offset trimming is required');
      }
      const firstTrack = tracks[i] ? [tracks[i]!] : [], lastTrack = tracks[next] ? [tracks[next]!] : [];
      const boundaryLoops = periodicU ? (sweep.closed ? [] : [[start], [end]])
        : sweep.closed ? [...firstTrack, ...lastTrack].map(track => [track]) : [[start, ...lastTrack, end, ...firstTrack]];
      surfaces.push(new SweptSurface({ at, boundaryLoops, periodicU, periodicV: sweep.closed, reversed: orientation < 0,
        poles: [...new Set([poles[i], poles[next]].filter((pole): pole is Vertex => pole !== undefined))],
        sides: { u0: periodicU ? undefined : tracks[i], u1: periodicU ? undefined : tracks[next],
          v0: sweep.closed ? undefined : start, v1: sweep.closed ? undefined : end } },
        sourceSamples().map(sample => sample.t), sweep.parameters));
    });
    return { lower, upper };
  };
  profiles.forEach((_, index) => {
    if (depths[index] % 2 !== 0) return;
    const region = [index, ...profiles.map((_, i) => i).filter(i => parents[i] === index)];
    const pieces = region.map(lift);
    if (!sweep.closed) {
      surfaces.push(new Face({ outer: pieces[0].lower, holes: pieces.slice(1).map(piece => piece.lower), plane: capPlane(0, -orientation) }));
      surfaces.push(new Face({ outer: pieces[0].upper, holes: pieces.slice(1).map(piece => piece.upper), plane: capPlane(1, orientation) }));
    }
  });
  validateSweepMesh(Surface.triangulateAll(surfaces));
  return new Solid({ surfaces });
}
