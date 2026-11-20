import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { PlanarCurve } from '../PlanarCurve.js';
import type { Plane } from '../Plane.js';
import type { Point } from '../Point.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';
import type { Profile, ProfileBoundary } from './profiles.js';

const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const unit = (x: number, y: number): Point => {
  const length = Math.hypot(x, y);
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Draft needs a nonzero boundary tangent');
  return { x: x / length, y: y / length };
};

/** Curve equations and matching samples; source sampling overrides remain authoritative. */
class DraftCurve extends PlanarCurve {
  constructor(at: (t: number) => Point, private readonly points: Point[]) { super({ at }); }
  override sample(): Point[] { return [...this.points]; }
}

export function draftProfile(profile: Profile, hole: boolean, plane: Plane, axis: ReadonlyVec3, angleRAD: number) {
  const reverse = (profile.signedArea > 0) === hole;
  const entries = reverse ? [...profile.boundaries].reverse().map(b => ({ ...b, reversed: !b.reversed })) : profile.boundaries;
  const points = entries.map(({ curve, reversed }) => reversed ? curve.end : curve.start);
  const sin = Math.sin(angleRAD), depth = vec3.dot(axis, plane.normal);
  const normal = (entry: ProfileBoundary, t: number): Point => {
    const direction = entry.straight ? undefined : entry.curve.tangent(t);
    const tangent = entry.straight
      ? unit(entry.curve.end.x - entry.curve.start.x, entry.curve.end.y - entry.curve.start.y)
      : { x: direction![0], y: direction![1] };
    const sign = entry.reversed ? -1 : 1;
    return { x: tangent.y * sign, y: -tangent.x * sign };
  };
  // Choose a unit wall normal m with m.axis = -sin(angleRAD), retaining the
  // boundary tangent. Its projected-axis generator gives a constant wall
  // angle even for oblique extrusion axes. Normalize its plane-height rate
  // so every upper boundary lies on the same translated sketch plane.
  const velocity = (n: Point): Point => {
    const world = vec3.scaleAndAdd([0, 0, 0], vec3.scale([0, 0, 0], plane.xAxis, n.x), plane.yAxis, n.y);
    const c = vec3.dot(world, axis), q2 = c * c + depth * depth;
    const radicand = q2 - sin * sin;
    if (radicand <= 0) throw new RangeError('Draft angle is too large for this boundary and extrusion axis');
    const root = Math.sqrt(radicand);
    const a = (Math.abs(depth) * root - c * sin) / q2;
    const b = (-Math.sign(depth) * c * root - depth * sin) / q2;
    const rate = depth / (depth + sin * b);
    if (a <= 0 || !Number.isFinite(rate) || rate <= 0) throw new RangeError('Draft angle reverses a wall relative to the sketch plane');
    const m = vec3.scaleAndAdd(world, vec3.scale(world, world, a), plane.normal, b);
    const shift = vec3.subtract([0, 0, 0], vec3.scale([0, 0, 0], vec3.scaleAndAdd(m, axis, m, sin), rate), axis);
    return { x: vec3.dot(shift, plane.xAxis), y: vec3.dot(shift, plane.yAxis) };
  };
  const velocities = entries.map((entry, i) => {
    const previous = entries[(i + entries.length - 1) % entries.length];
    const a = normal(previous, previous.reversed ? 0 : 1), b = normal(entry, entry.reversed ? 1 : 0);
    const va = velocity(a), vb = velocity(b);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) return { x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2 };
    if (!entry.straight || !previous.straight) throw new RangeError('Draft at a sharp curved join requires curve-offset trimming');
    const determinant = a.x * b.y - a.y * b.x;
    if (Math.abs(determinant) < 1e-12) throw new RangeError('Draft needs distinct corner directions');
    const ca = dot(a, va), cb = dot(b, vb);
    return { x: (ca * b.y - a.y * cb) / determinant, y: (a.x * cb - ca * b.x) / determinant };
  });
  const atVelocity = (entry: ProfileBoundary, t: number): Point => velocity(normal(entry, t));
  const sample = (index: number, resolution = TRIANGULATION_RESOLUTION): { points: Point[]; velocities: Point[] } => {
    const entry = entries[index];
    if (entry.straight) return { points: [entry.curve.start, entry.curve.end], velocities: entry.reversed
      ? [velocities[(index + 1) % entries.length], velocities[index]]
      : [velocities[index], velocities[(index + 1) % entries.length]] };
    const { curve } = entry;
    const samples = curve.sample({ resolution });
    const shifts = samples.map((point, i) => {
      if (!curve.isLoop() && (i === 0 || i === samples.length - 1)) return atVelocity(entry, i === 0 ? 0 : 1);
      const a = samples[i === 0 ? samples.length - 2 : i - 1];
      const b = samples[i === samples.length - 1 ? 1 : i + 1];
      const la = Math.hypot(point.x - a.x, point.y - a.y), lb = Math.hypot(b.x - point.x, b.y - point.y);
      const tangent = unit((point.x - a.x) * lb / la + (b.x - point.x) * la / lb,
        (point.y - a.y) * lb / la + (b.y - point.y) * la / lb);
      const sign = entry.reversed ? -1 : 1;
      return velocity({ x: tangent.y * sign, y: -tangent.x * sign });
    });
    const next = (index + 1) % entries.length;
    shifts[0] = velocities[entry.reversed ? next : index];
    shifts[shifts.length - 1] = velocities[entry.reversed ? index : next];
    return { points: samples, velocities: shifts };
  };
  const samples = entries.flatMap((entry, i) => {
    const data = sample(i);
    const points = data.points.map((point, j) => ({ point, velocity: data.velocities[j] }));
    return (entry.reversed ? points.reverse() : points).slice(0, -1);
  });
  let collapse: { distance: number; point: Point } | undefined;
  const first = samples[0];
  const furthest = samples.reduce((best, item) => Math.hypot(item.point.x - first.point.x, item.point.y - first.point.y)
    > Math.hypot(best.point.x - first.point.x, best.point.y - first.point.y) ? item : best);
  const delta = { x: furthest.point.x - first.point.x, y: furthest.point.y - first.point.y };
  const change = { x: furthest.velocity.x - first.velocity.x, y: furthest.velocity.y - first.velocity.y };
  const distance = -dot(delta, change) / dot(change, change);
  if (Number.isFinite(distance) && distance > 0) {
    const point = { x: first.point.x + distance * first.velocity.x, y: first.point.y + distance * first.velocity.y };
    const tolerance = 1e-8 * Math.max(1, Math.hypot(delta.x, delta.y));
    if (samples.every(item => Math.hypot(item.point.x + distance * item.velocity.x - point.x,
      item.point.y + distance * item.velocity.y - point.y) <= tolerance)) collapse = { distance, point };
  }
  const polygon = (distance: number): Point[] => {
    if (collapse && Math.abs(distance - collapse.distance) <= 1e-10 * distance) return [];
    for (let i = 0; i < samples.length; i++) {
      const a = samples[i], b = samples[(i + 1) % samples.length];
      const edge = { x: b.point.x - a.point.x, y: b.point.y - a.point.y };
      const change = { x: b.velocity.x - a.velocity.x, y: b.velocity.y - a.velocity.y };
      if (dot(edge, edge) + distance * dot(edge, change) <= dot(edge, edge) * 1e-10) {
        throw new RangeError('Draft offsets fold or collapse without a single apex; offset trimming is required');
      }
    }
    return samples.map(({ point, velocity }) => ({ x: point.x + distance * velocity.x, y: point.y + distance * velocity.y }));
  };
  const curves = (index: number, distance: number): [PlanarCurve, PlanarCurve] => {
    const entry = entries[index];
    if (entry.straight) throw new TypeError('Straight draft boundaries use edges');
    const { curve } = entry;
    const coarse = curve.sample();
    let curvature = 0;
    for (let i = 1; i + 1 < coarse.length; i++) {
      const a = coarse[i - 1], b = coarse[i], c = coarse[i + 1];
      const ab = Math.hypot(b.x - a.x, b.y - a.y), bc = Math.hypot(c.x - b.x, c.y - b.y), ac = Math.hypot(c.x - a.x, c.y - a.y);
      curvature = Math.max(curvature, 2 * Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) / (ab * bc * ac));
    }
    const speed = sample(index).velocities.reduce((speed, v) => Math.max(speed, Math.hypot(v.x, v.y)), 0);
    // Refine the source for both chord error and the offset's tangent estimate.
    const data = sample(index, TRIANGULATION_RESOLUTION / (2 * (1 + distance * speed * curvature)));
    const shifted = data.points.map((point, i) => ({ x: point.x + distance * data.velocities[i].x, y: point.y + distance * data.velocities[i].y }));
    const at = (t: number): Point => {
      const p = curve.at(t), v = atVelocity(entry, t);
      return { x: p.x + distance * v.x, y: p.y + distance * v.y };
    };
    const top = new DraftCurve(t => t === 0 ? shifted[0] : t === 1 ? shifted[shifted.length - 1] : at(t), shifted);
    return [new DraftCurve(t => curve.at(t), data.points), top];
  };
  return { entries, points, velocities, collapse, curves, polygon };
}
