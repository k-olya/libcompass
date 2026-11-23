import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Plane } from '../Plane.js';
import type { Sketch } from '../Sketch.js';
import type { Solid } from '../Solid.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { SpatialLine } from '../SpatialLine.js';
import { validateVertex, type Vertex } from '../Vertex.js';
import { sketchProfiles } from '../internal/profiles.js';
import { sweepProfiles } from '../internal/sweepProfiles.js';
import { degtorad } from '../util/angles.js';

/**
 * Extrude filled sketch regions by rotating them about a coplanar spatial line.
 * @param options.sketch - Closed planar profiles in their actual world-space placement; never recentered.
 * @param options.axis - Coplanar rotation line, including its origin; direction is normalized internally.
 * @param options.angle - Signed right-hand rotation in degrees, default 360. Must be nonzero and at most one turn.
 * @returns A new solid with exact parametric surfaces and shared physical boundaries.
 * @remarks Full turns have no caps or physical seam edges. Partial turns retain planar caps.
 * Holes and islands use even-odd nesting. Curves retain their evaluators and sample() overrides;
 * sampling creates only temporary analysis/triangulation data. Source geometry is never modified.
 * Profiles must lie on one side of the axis and may touch it. Axis boundaries sweep out
 * no wall, and stationary endpoints become shared poles, allowing cylinders, cones and spheres.
 * Crossing the axis or creating a nonmanifold pinch still throws.
 * @throws {@link RangeError} for invalid angles, noncoplanar axes, axis crossing,
 * or detected folds, self-intersections and unresolved topology.
 * @throws {@link TypeError} if axis is not a SpatialLine.
 * @example
 * ```ts
 * const s = sketch().add(circle({ center: { x: 10, y: 0 }, radius: 2 }));
 * const torus = extrudeRotate({ sketch: s, axis: Y });
 * scene.add(torus);
 * ```
 */
export function extrudeRotate({ sketch, axis, angle: angleDEG = 360 }: {
  /** Filled planar profiles, rotated in their current world-space placement. */
  sketch: Sketch;
  /** Rotation axis lying in the sketch plane; direction is normalized internally. */
  axis: SpatialLine;
  /** Signed right-hand angle in degrees, default 360; 0 < abs(angle) <= 360. */
  angle?: number;
}): Solid {
  if (!(axis instanceof SpatialLine)) throw new TypeError('Rotational extrusion axis must be a SpatialLine');
  if (!Number.isFinite(angleDEG) || angleDEG === 0 || Math.abs(angleDEG) > 360) {
    throw new RangeError('Rotational extrusion angle must be finite, nonzero and no greater than 360 degrees');
  }
  validateVertex({ position: axis }); validateVertex({ position: axis.origin });
  const scale = Math.max(Math.abs(axis[0]), Math.abs(axis[1]), Math.abs(axis[2]));
  if (scale === 0) throw new RangeError('Rotational extrusion axis must be nonzero');
  const unit = vec3.normalize([0, 0, 0], [axis[0] / scale, axis[1] / scale, axis[2] / scale]);
  const origin: ReadonlyVec3 = [axis.origin[0], axis.origin[1], axis.origin[2]];
  const plane = new Plane({ a: [...sketch.plane.origin] as [number, number, number],
    b: vec3.add([0, 0, 0], sketch.plane.origin, sketch.plane.xAxis),
    c: vec3.add([0, 0, 0], sketch.plane.origin, sketch.plane.yAxis) });
  const planeOffset = vec3.subtract([0, 0, 0], origin, plane.origin);
  if (Math.abs(vec3.dot(unit, plane.normal)) > 1e-10 || Math.abs(vec3.dot(planeOffset, plane.normal)) > 1e-8 * Math.max(1, vec3.length(planeOffset))) {
    throw new RangeError('Rotational extrusion axis must lie in the sketch plane');
  }
  const profiles = sketchProfiles(sketch);
  const side = vec3.cross([0, 0, 0], plane.normal, unit);
  const points = profiles.flatMap(profile => profile.points.map(point => plane.toWorld(point).position));
  const distances = points.map(point => vec3.dot(vec3.subtract([0, 0, 0], point, origin), side));
  const nonzero = distances.filter(distance => Math.abs(distance) > 1e-10);
  const orientation = Math.sign(nonzero[0]) * Math.sign(angleDEG);
  if (!nonzero.length || nonzero.some(distance => Math.sign(distance) !== Math.sign(nonzero[0]))) {
    throw new RangeError('Rotational extrusion profiles must lie on one side of the axis; crossing it is unsupported');
  }
  const closed = Math.abs(angleDEG) === 360, angleRAD = degtorad(angleDEG);
  const turnDirection = (value: ReadonlyVec3, t: number): ReadonlyVec3 => {
    const phaseRAD = closed && t === 1 ? 0 : angleRAD * t;
    const cosine = Math.cos(phaseRAD), sine = Math.sin(phaseRAD);
    const axial = vec3.scale([0, 0, 0], unit, vec3.dot(value, unit));
    const radial = vec3.subtract([0, 0, 0], value, axial);
    return vec3.add([0, 0, 0], axial, vec3.scaleAndAdd([0, 0, 0], vec3.scale([0, 0, 0], radial, cosine), vec3.cross([0, 0, 0], unit, radial), sine));
  };
  const poles = new Map<string, Vertex>();
  const stationary = (point: ReadonlyVec3): Vertex | undefined => {
    const relative = vec3.subtract([0, 0, 0], point, origin);
    if (vec3.length(vec3.cross([0, 0, 0], unit, relative)) > 1e-10) return undefined;
    const position = vec3.scaleAndAdd([0, 0, 0], origin, unit, vec3.dot(relative, unit)), key = Array.from(position).join(',');
    let pole = poles.get(key);
    if (!pole) { pole = validateVertex({ position }); poles.set(key, pole); }
    return pole;
  };
  const turn = (point: ReadonlyVec3, t: number) => stationary(point) ?? validateVertex({ position:
    vec3.add([0, 0, 0], origin, turnDirection(vec3.subtract([0, 0, 0], point, origin), t)) });
  const outer = points[distances.reduce((best, distance, i) => Math.abs(distance) > Math.abs(distances[best]) ? i : best, 0)];
  const orbit = new SpatialCurve(t => turn(outer, t));
  const parameters = orbit.sampleWithParameters().map(sample => sample.t);
  return sweepProfiles(profiles, {
    closed, parameters,
    frame: t => ({ origin: turn(plane.origin, t).position, xAxis: turnDirection(plane.xAxis, t),
      yAxis: turnDirection(plane.yAxis, t), normal: turnDirection(plane.normal, t) }),
    place: (point, t) => turn(plane.toWorld(point).position, t),
    stationary: point => stationary(plane.toWorld(point).position),
  }, orientation);
}
