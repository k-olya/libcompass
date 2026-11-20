import { vec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import type { Sketch } from '../Sketch.js';
import { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { SpatialSurface } from '../SpatialSurface.js';
import { Surface } from '../Surface.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import { rememberSample } from '../internal/curveSamples.js';
import { sketchProfiles, profileNesting } from '../internal/profiles.js';
import { sampleSurface, type SurfaceGrid } from '../internal/surfaceSampling.js';
import { sweepFrames } from '../internal/sweepFrames.js';
import { validateSweepMesh } from '../internal/validateSweepMesh.js';

/** A sweep seeds its generic surface sampler from both source curve samplers. */
class SweptSurface extends SpatialSurface {
  private sampled?: SurfaceGrid;
  constructor(options: ConstructorParameters<typeof SpatialSurface>[0], private readonly u: readonly number[], private readonly v: readonly number[]) { super(options); }
  override sample(): SurfaceGrid { return this.sampled ??= sampleSurface(this, this.u, this.v); }
}

/**
 * Extrude filled sketch regions along a smooth, regular spatial curve.
 *
 * @remarks
 * Local (0, 0) follows the path. The sketch plane is rotated onto the starting
 * tangent, then transported with minimal twist; its original position is ignored.
 * Closed paths distribute residual frame rotation by sampled arc length and have
 * no caps or seam edges. Sampling never introduces intermediate solid topology.
 * Validation uses temporary polylines and a mesh at the library resolution;
 * arbitrary oscillations hidden by sampling overrides cannot be certified.
 *
 * @param options - Sketch and smooth spatial path; holes and islands use even-odd nesting.
 * @param options.sketch - Closed planar profiles to sweep, preserving local coordinates.
 * @param options.curve - Smooth regular path, open or smoothly closed.
 * @returns A solid retaining parametric surfaces and shared physical boundaries.
 * @throws {@link RangeError} for corners, cusps, unresolved sampling, local folds,
 * or intersections detected in the validation mesh. Offset trimming is not supported.
 *
 * @example
 * ```ts
 * const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 2 }));
 * const curve = spatialCurve({ at: t => ({ position: [20 * t, 0, 10 * t * t] }) });
 * scene.add(extrudeAlongCurve({ sketch: s, curve }));
 * ```
 */
export function extrudeAlongCurve({ sketch, curve }: {
  /** Sketch providing the filled local profiles and initial orientation. */
  sketch: Sketch;
  /** Smooth, regular spatial path. */
  curve: SpatialCurve;
}): Solid {
  const profiles = sketchProfiles(sketch), { parents, depths } = profileNesting(profiles);
  const radius = Math.max(...profiles.flatMap(profile => profile.points.map(point => Math.hypot(point.x, point.y))));
  const sweep = sweepFrames(curve, sketch.plane, radius);
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
    const lowerVertices = points.map(point => sweep.place(point, 0));
    const upperVertices = sweep.closed ? lowerVertices : points.map(point => sweep.place(point, 1));
    const tracks = points.map((point, i) => {
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
      const start = rim(0), end = sweep.closed ? start : rim(1);
      lower.push(start); upper.push(end);
      const at = (u: number, v: number) => {
        if (!periodicU && u === 0) return tracks[i].at(v);
        if (!periodicU && u === 1) return tracks[next].at(v);
        if (!sweep.closed && v === 0) return start.at(u);
        if (!sweep.closed && v === 1) return end.at(u);
        return sweep.place(local(u), v);
      };
      // Check forward motion at sampled boundary points: a reversed axial
      // derivative signals an offset fold before global intersection testing.
      for (const { t: u } of sourceSamples()) for (const v of sweep.parameters) {
        const h = 1e-5, a = Math.max(0, v - h), b = Math.min(1, v + h);
        const velocity = vec3.subtract([0, 0, 0], at(u, b).position, at(u, a).position);
        if (vec3.dot(velocity, sweep.frame(v).normal) <= 0) throw new RangeError('Sweep profile folds along the path; offset trimming is required');
      }
      const boundaryLoops = periodicU ? (sweep.closed ? [] : [[start], [end]])
        : sweep.closed ? [[tracks[i]], [tracks[next]]] : [[start, tracks[next], end, tracks[i]]];
      surfaces.push(new SweptSurface({ at, boundaryLoops, periodicU, periodicV: sweep.closed,
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
      surfaces.push(new Face({ outer: pieces[0].lower, holes: pieces.slice(1).map(piece => piece.lower), plane: capPlane(0, -1) }));
      surfaces.push(new Face({ outer: pieces[0].upper, holes: pieces.slice(1).map(piece => piece.upper), plane: capPlane(1, 1) }));
    }
  });
  validateSweepMesh(Surface.triangulateAll(surfaces));
  return new Solid({ surfaces });
}
