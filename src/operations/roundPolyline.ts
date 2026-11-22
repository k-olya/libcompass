import { LineSegment } from '../LineSegment.js';
import type { PlanarCurve } from '../PlanarCurve.js';
import { validatePoint, type Point } from '../Point.js';
import { arc } from './arc.js';

type End = { index: number; side: 'start' | 'end' };
type Contact = { distance: number; point: Point };

/**
 * Round shared polyline corners with tangent circular arcs, without changing the input.
 * @param options.segments - Line segments, connected by exact endpoint XY coordinates.
 * Order and segment directions may be arbitrary. Open ends and disconnected components are allowed.
 * @param options.radius - Positive arc radius in model units; defaults to 0.5.
 * @returns A new array of trimmed line segments and exact circular PlanarCurves.
 * Segments keep their input order and direction; each arc follows an incident segment,
 * preferring its end. An ordered polyline therefore stays ordered. A fully consumed
 * segment is omitted and the two adjacent arcs share its tangent point.
 * @remarks
 * Endpoints shared by exactly two segments are rounded. Straight continuations
 * are left straight; unshared endpoints remain unchanged. No closed profile is required.
 * Intersections away from endpoints and profile validity are checked when extruding.
 * @throws {@link RangeError} for invalid radius/coordinates, a point shared by more
 * than two segments, overlapping/backtracking rays, or insufficient segment length
 * for both incident rounds. Numerically unrepresentable tangencies also throw.
 * @example
 * ```ts
 * const segments = rectangle({ corner1: { x: 0, y: 0 }, corner2: { x: 10, y: 6 } });
 * s.add(roundPolyline({ segments, radius: 1 }));
 * ```
 */
export function roundPolyline({ segments, radius = 0.5 }: {
  /** Source line segments; endpoints match by exact XY coordinates, not object identity. */
  segments: readonly LineSegment[];
  /** Positive circular arc radius; defaults to 0.5 model units. */
  radius?: number;
}): (LineSegment | PlanarCurve)[] {
  if (!Array.isArray(segments) || segments.some(segment => !(segment instanceof LineSegment))) {
    throw new TypeError('roundPolyline requires an array of LineSegments');
  }
  if (!Number.isFinite(radius) || radius <= 0) throw new RangeError('roundPolyline radius must be finite and positive');
  const joints = new Map<string, { point: Point; ends: End[] }>();
  const lengths = segments.map(segment => {
    validatePoint(segment.start); validatePoint(segment.end);
    const length = Math.hypot(segment.end.x - segment.start.x, segment.end.y - segment.start.y);
    if (!Number.isFinite(length) || length === 0) throw new RangeError('roundPolyline needs finite nonzero segment lengths');
    return length;
  });
  const contacts = segments.map(segment => ({ start: { distance: 0, point: segment.start } as Contact,
    end: { distance: 0, point: segment.end } as Contact }));
  segments.forEach((segment, index) => {
    for (const side of ['start', 'end'] as const) {
      const point = segment[side], key = `${point.x},${point.y}`;
      const joint = joints.get(key) ?? { point, ends: [] as End[] };
      joint.ends.push({ index, side }); joints.set(key, joint);
      if (joint.ends.length > 2) throw new RangeError('roundPolyline cannot round a point shared by more than two segments');
    }
  });
  const rounds: { first: End; second: End; cross: number; a: Point }[] = [];
  for (const { point, ends } of joints.values()) {
    if (ends.length !== 2) continue;
    const first = ends.find(end => end.side === 'end') ?? ends[0], second = ends.find(end => end !== first)!;
    const direction = ({ index, side }: End): Point => {
      const other = segments[index][side === 'start' ? 'end' : 'start'];
      return { x: (other.x - point.x) / lengths[index], y: (other.y - point.y) / lengths[index] };
    };
    const a = direction(first), b = direction(second), cross = a.x * b.y - a.y * b.x;
    const cosine = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y));
    if (cross === 0) {
      if (cosine >= 0) throw new RangeError('roundPolyline cannot round overlapping or backtracking segments');
      contacts[first.index][first.side].point = point;
      contacts[second.index][second.side].point = point;
      continue;
    }
    // r * cot(interior / 2), avoiding cancellation near either collinear limit.
    const distance = radius * (cosine > 0 ? (1 + cosine) / Math.abs(cross) : Math.abs(cross) / (1 - cosine));
    if (!Number.isFinite(distance)) throw new RangeError('roundPolyline segment length is insufficient for this radius');
    [first, second].forEach((end, i) => {
      const ray = i === 0 ? a : b;
      contacts[end.index][end.side] = { distance,
        point: validatePoint({ x: point.x + ray.x * distance, y: point.y + ray.y * distance }) };
    });
    rounds.push({ first, second, cross, a });
  }
  const trimmed = segments.map((_, index) => {
    const { start, end } = contacts[index], remaining = lengths[index] - start.distance - end.distance;
    const tolerance = 64 * Number.EPSILON * Math.max(lengths[index], start.distance, end.distance);
    if (remaining < -tolerance) throw new RangeError(`roundPolyline segment ${index} has insufficient length for the requested radius`);
    if (remaining <= tolerance) {
      end.point = start.point;
      return undefined;
    }
    return new LineSegment({ start: start.point, end: end.point });
  });
  const after = new Map<number, PlanarCurve[]>();
  for (const { first, second, cross, a } of rounds) {
    const start = contacts[first.index][first.side].point, end = contacts[second.index][second.side].point;
    const sign = Math.sign(cross);
    const center = validatePoint({ x: start.x - sign * a.y * radius, y: start.y + sign * a.x * radius });
    const curve = arc({ start, end, center, direction: cross < 0 ? 'counterclockwise' : 'clockwise' });
    const arcs = after.get(first.index) ?? []; arcs.push(curve); after.set(first.index, arcs);
  }
  return trimmed.flatMap((segment, index) => [...(segment ? [segment] : []), ...(after.get(index) ?? [])]);
}
