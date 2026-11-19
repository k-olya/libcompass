import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Edge } from './Edge.js';
import { Face } from './Face.js';
import { Plane } from './Plane.js';
import type { Sketch } from './Sketch.js';
import { Solid } from './Solid.js';
import type { SpatialBoundary } from './SpatialBoundary.js';
import { SpatialCurve } from './SpatialCurve.js';
import { SpatialSurface } from './SpatialSurface.js';
import type { Surface } from './Surface.js';
import { validateVertex, type Vertex } from './Vertex.js';
import { signedArea } from './util/polygon.js';
import { profileAnchor, profileArea, profileContains, sketchProfiles, type Profile } from './util/profiles.js';

/**
 * Extrude all filled sketch regions into exact planar and curved surfaces.
 *
 * @remarks
 * Even-odd nesting determines material, holes, and islands independently of
 * contour winding and insertion order. Points and infinite lines are ignored
 * as construction geometry. Circles remain circular spatial boundaries with
 * ruled side surfaces. No curve sampling or triangulation occurs here.
 *
 * The result is a snapshot with shared boundary and vertex identities. Only
 * triangulation introduces facets, at the library-wide resolution of 0.001.
 *
 * @param options - Sketch and world-space displacement.
 * @param options.sketch - Closed segment profiles and analytic circles.
 * @param options.direction - Finite displacement with a nonzero normal component;
 * oblique and negative extrusion are supported. The normal component must
 * exceed `1e-10` times its length.
 * @returns A solid with planar caps and exact planar or ruled side surfaces.
 * @throws {@link RangeError} if direction or profiles are invalid, open,
 * branched, degenerate, intersecting, or touching.
 * @throws {@link TypeError} if a noncircular planar curve is present.
 *
 * @example
 * ```ts
 * const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 5 }));
 * const body = extrude({ sketch: s, direction: [0, 0, 10] });
 * const positions = body.triangulate(); // Facets are created only here.
 * ```
 */
export function extrude({ sketch, direction }: { sketch: Sketch; direction: ReadonlyVec3 }): Solid {
  if (![direction[0], direction[1], direction[2]].every(Number.isFinite)) throw new RangeError('Extrusion direction must be finite');
  const displacement = Array.from(direction) as [number, number, number];
  const depth = vec3.dot(sketch.plane.normal, displacement);
  if (Math.abs(depth) <= vec3.length(displacement) * 1e-10 || !Number.isFinite(depth)) throw new RangeError('Extrusion direction must leave the sketch plane');
  const profiles = sketchProfiles(sketch);
  const areas = profiles.map(profileArea);
  const parents = profiles.map((profile, i) => {
    let parent = -1;
    profiles.forEach((candidate, j) => {
      if (i !== j && areas[j] > areas[i] && profileContains(candidate, profileAnchor(profile)) &&
          (parent === -1 || areas[j] < areas[parent])) parent = j;
    });
    return parent;
  });
  const depths = parents.map(parent => {
    let depth = 0;
    for (let index = parent; index !== -1; index = parents[index]) depth++;
    return depth;
  });
  const frame = (offset: ReadonlyVec3, sign = 1) => new Plane({
    a: vec3.add([0, 0, 0], sketch.plane.origin, offset),
    b: Array.from(sketch.plane.origin).map((value, i) => value + offset[i] + sketch.plane.xAxis[i]) as [number, number, number],
    c: Array.from(sketch.plane.origin).map((value, i) => value + offset[i] + sign * sketch.plane.yAxis[i]) as [number, number, number],
  });
  const bottomFrame = frame([0, 0, 0]), topFrame = frame(displacement);
  const surfaces: Surface[] = [];
  const lift = (profile: Profile, hole: boolean): { bottom: SpatialBoundary[]; top: SpatialBoundary[]; sides: Face | SpatialSurface }[] => {
    if (profile.circle) {
      const bottom = SpatialCurve.fromPlanarCurve({ curve: profile.circle, plane: bottomFrame });
      const top = SpatialCurve.fromPlanarCurve({ curve: profile.circle, plane: topFrame });
      return [{ bottom: [bottom], top: [top], sides: new SpatialSurface({ start: bottom, end: top, reversed: (depth < 0) !== hole }) }];
    }
    const points = (signedArea(profile.points) > 0) !== hole ? profile.points : [...profile.points].reverse();
    const bottom = points.map(point => bottomFrame.toWorld(point));
    const top = bottom.map(vertex => validateVertex({ position: vec3.add([0, 0, 0], vertex.position, displacement) }));
    const vertical = bottom.map((vertex, i) => new Edge({ start: vertex, end: top[i] }));
    return bottom.map((vertex, i) => {
      const next = (i + 1) % bottom.length;
      const lower = new Edge({ start: vertex, end: bottom[next] });
      const upper = new Edge({ start: top[i], end: top[next] });
      const outer = [lower, vertical[next], upper, vertical[i]];
      return { bottom: [lower], top: [upper], sides: new Face({ outer: depth > 0 ? outer : [...outer].reverse() }) };
    });
  };
  profiles.forEach((outer, index) => {
    if (depths[index] % 2 !== 0) return;
    const region = [outer, ...profiles.filter((_, i) => parents[i] === index)];
    const pieces = region.map((profile, i) => lift(profile, i !== 0));
    const bottom = pieces.map(loop => loop.flatMap(piece => piece.bottom));
    const top = pieces.map(loop => loop.flatMap(piece => piece.top));
    surfaces.push(
      new Face({ outer: bottom[0], holes: bottom.slice(1), plane: frame([0, 0, 0], depth > 0 ? -1 : 1) }),
      new Face({ outer: top[0], holes: top.slice(1), plane: frame(displacement, depth > 0 ? 1 : -1) }),
      ...pieces.flatMap(loop => loop.map(piece => piece.sides)),
    );
  });
  return new Solid({ surfaces });
}
