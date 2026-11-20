import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import type { Sketch } from '../Sketch.js';
import { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { RuledSurface } from '../RuledSurface.js';
import type { Surface } from '../Surface.js';
import { validateVertex } from '../Vertex.js';
import { profileAnchor, profileContains, profileNesting, sketchProfiles, type Profile } from '../internal/profiles.js';
import { draftProfile } from '../internal/draft.js';
import { containsInterior, validateLoops } from '../internal/polygon.js';
import { degtorad } from '../util/angles.js';

/**
 * Extrude all filled sketch regions into exact planar and curved surfaces.
 *
 * @remarks
 * Even-odd nesting determines material, holes, and islands independently of
 * contour winding and insertion order. Points and infinite lines are ignored
 * as construction geometry. Curves remain mathematical spatial boundaries with
 * ruled side surfaces. Temporary sampled polylines determine profile area,
 * intersections, and nesting; no triangle mesh is created here.
 *
 * The placement is copied; treat source curve evaluators as immutable. Boundary
 * and vertex identities are shared. Only triangulation introduces facets,
 * at the library-wide resolution of 0.001.
 *
 * @param options - Sketch, signed length, and optional world-space axis.
 * @param options.sketch - Closed profiles of planar curves and line segments.
 * @param options.axis - Finite, nonzero vector, normalized internally without
 * modifying it; defaults to the sketch plane normal. After normalization, its
 * normal component must exceed `1e-10` in magnitude; oblique axes are supported.
 * @param options.length - Finite, nonzero extrusion length. Negative values
 * extrude opposite to the axis. Displacement is `normalize(axis) * length`.
 * @param options.angle - Draft angle in degrees, strictly between -90 and 90;
 * defaults to zero. Positive expands material, negative contracts it, regardless
 * of the length's sign. Length is clamped when a boundary converges to an apex.
 * Curved boundaries use tangent(), with a numerical default and exact overrides.
 * Sharp curved joins and intersecting offsets require trimming and are unsupported.
 * @returns A solid with planar caps and exact planar or ruled side surfaces.
 * @throws {@link RangeError} if axis, length, or profiles are invalid, open,
 * branched, degenerate, intersecting, or touching.
 *
 * @example
 * ```ts
 * const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 5 }));
 * const body = extrude({ sketch: s, length: 10 });
 * const positions = body.triangulate(); // Facets are created only here.
 * ```
 */
export function extrude({ sketch, axis = sketch.plane.normal, length, angle: angleDEG = 0 }: {
  /** Sketch supplying closed profiles and the default axis. */
  sketch: Sketch;
  /** World-space direction, normalized internally; defaults to the sketch plane normal. */
  axis?: ReadonlyVec3;
  /** Finite, nonzero signed length; negative values reverse the extrusion. */
  length: number;
  /** Draft angle in degrees; positive expands, negative contracts; defaults to zero. */
  angle?: number;
}): Solid {
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Extrusion length must be finite and nonzero');
  if (!Number.isFinite(angleDEG) || Math.abs(angleDEG) >= 90) throw new RangeError('Extrusion angle must be finite and strictly between -90 and 90 degrees');
  const angleRAD = degtorad(angleDEG);
  if (![axis[0], axis[1], axis[2]].every(Number.isFinite)) throw new RangeError('Extrusion axis must be finite');
  const scale = Math.max(Math.abs(axis[0]), Math.abs(axis[1]), Math.abs(axis[2]));
  if (scale === 0) throw new RangeError('Extrusion axis must be nonzero');
  const unitAxis = vec3.normalize([0, 0, 0], [axis[0] / scale, axis[1] / scale, axis[2] / scale]);
  if (Math.abs(vec3.dot(sketch.plane.normal, unitAxis)) <= 1e-10) throw new RangeError('Extrusion direction must leave the sketch plane');
  const profiles = sketchProfiles(sketch);
  const { parents, depths } = profileNesting(profiles);
  const travelAxis = vec3.scale([0, 0, 0], unitAxis, Math.sign(length));
  const drafts = angleDEG === 0 ? [] : profiles.map((profile, i) => draftProfile(profile, depths[i] % 2 !== 0, sketch.plane, travelAxis, angleRAD));
  const distance = drafts.reduce((distance, draft) => Math.min(distance, draft.collapse?.distance ?? Infinity), Math.abs(length));
  if (drafts.length) {
    const polygons = drafts.map(draft => draft.polygon(distance));
    try { validateLoops(polygons.filter(polygon => polygon.length)); }
    catch (cause) { throw new RangeError('Draft offsets intersect or degenerate; offset trimming is required', { cause }); }
    polygons.forEach((outer, i) => polygons.forEach((inner, j) => {
      if (i !== j && outer.length && inner.length &&
        containsInterior(outer, inner[0]) !== profileContains(profiles[i], profileAnchor(profiles[j]))) {
        throw new RangeError('Draft offsets change profile nesting; offset trimming is required');
      }
    }));
  }
  const displacement = vec3.scale([0, 0, 0], travelAxis, distance);
  const depth = vec3.dot(sketch.plane.normal, displacement);
  if (!Number.isFinite(depth)) throw new RangeError('Extrusion displacement must be finite');
  const frame = (offset: ReadonlyVec3, sign = 1) => new Plane({
    a: vec3.add([0, 0, 0], sketch.plane.origin, offset),
    b: Array.from(sketch.plane.origin).map((value, i) => value + offset[i] + sketch.plane.xAxis[i]) as [number, number, number],
    c: Array.from(sketch.plane.origin).map((value, i) => value + offset[i] + sign * sketch.plane.yAxis[i]) as [number, number, number],
  });
  const bottomFrame = frame([0, 0, 0]), topFrame = frame(displacement);
  const surfaces: Surface[] = [];
  const lift = (profile: Profile, hole: boolean): { bottom: SpatialBoundary[]; top: SpatialBoundary[]; sides: Face | RuledSurface }[] => {
    const reverse = (profile.signedArea > 0) === hole;
    const draft = drafts[profiles.indexOf(profile)];
    const entries = draft?.entries ?? (reverse ? [...profile.boundaries].reverse().map(b => ({ ...b, reversed: !b.reversed })) : profile.boundaries);
    const bottomVertices = entries.map(({ curve, reversed }) => bottomFrame.toWorld(reversed ? curve.end : curve.start));
    const collapsed = draft?.collapse && Math.abs(distance - draft.collapse.distance) <= 1e-10 * distance;
    const apex = collapsed ? topFrame.toWorld(draft!.collapse!.point) : undefined;
    const topVertices = bottomVertices.map((vertex, i) => apex ?? (draft
      ? topFrame.toWorld({ x: draft.points[i].x + distance * draft.velocities[i].x, y: draft.points[i].y + distance * draft.velocities[i].y })
      : validateVertex({ position: vec3.add([0, 0, 0], vertex.position, displacement) })));
    const vertical = bottomVertices.map((vertex, i) => new Edge({ start: vertex, end: topVertices[i] }));
    return entries.map(({ curve, reversed, straight }, i) => {
      const next = (i + 1) % entries.length;
      if (straight) {
        const lower = new Edge({ start: bottomVertices[i], end: bottomVertices[next] });
        const upper = apex ? [] : [new Edge({ start: topVertices[i], end: topVertices[next] })];
        const outer = [lower, vertical[next], ...upper, vertical[i]];
        return { bottom: [lower], top: upper, sides: new Face({ outer: depth > 0 ? outer : [...outer].reverse() }) };
      }
      const start = reversed ? next : i, end = reversed ? i : next;
      const [bottomCurve, topCurve] = draft ? draft.curves(i, distance) : [curve, curve];
      const lower = SpatialCurve.fromPlanarCurve({ curve: bottomCurve, plane: bottomFrame, start: bottomVertices[start], end: bottomVertices[end] });
      const upper = apex ?? SpatialCurve.fromPlanarCurve({ curve: topCurve, plane: topFrame, start: topVertices[start], end: topVertices[end] });
      return { bottom: [lower], top: 'position' in upper ? [] : [upper], sides: new RuledSurface({ start: lower, end: upper,
        sides: curve.isLoop() ? undefined : [vertical[end], vertical[start]], reversed: (depth < 0) !== reversed }) };
    });
  };
  profiles.forEach((outer, index) => {
    if (depths[index] % 2 !== 0) return;
    const region = [outer, ...profiles.filter((_, i) => parents[i] === index)];
    const pieces = region.map((profile, i) => lift(profile, i !== 0));
    const bottom = pieces.map(loop => loop.flatMap(piece => piece.bottom));
    const top = pieces.map(loop => loop.flatMap(piece => piece.top));
    surfaces.push(new Face({ outer: bottom[0], holes: bottom.slice(1), plane: frame([0, 0, 0], depth > 0 ? -1 : 1) }));
    if (top[0].length) surfaces.push(new Face({ outer: top[0], holes: top.slice(1).filter(loop => loop.length), plane: frame(displacement, depth > 0 ? 1 : -1) }));
    surfaces.push(...pieces.flatMap(loop => loop.map(piece => piece.sides)));
  });
  return new Solid({ surfaces });
}
