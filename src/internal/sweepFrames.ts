import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import type { Plane } from '../Plane.js';
import type { Point } from '../Point.js';
import type { SpatialCurve } from '../SpatialCurve.js';
import type { Vertex } from '../Vertex.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';

const unit = (value: ReadonlyVec3) => {
  const length = vec3.length(value);
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Sweep path must have a nonzero, finite tangent');
  return vec3.scale([0, 0, 0], value, 1 / length);
};
const cross = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.cross([0, 0, 0], a, b);
const difference = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.subtract([0, 0, 0], a, b);

/** Minimal rotation taking one unit normal to the other. */
function transport(x: ReadonlyVec3, from: ReadonlyVec3, to: ReadonlyVec3, oppositeAxis?: ReadonlyVec3): ReadonlyVec3 {
  const dot = Math.max(-1, Math.min(1, vec3.dot(from, to)));
  if (dot < -1 + 1e-10) {
    if (!oppositeAxis) throw new RangeError('Sweep path reverses direction; only smooth regular paths are supported');
    return vec3.scaleAndAdd([0, 0, 0], vec3.negate([0, 0, 0], x), oppositeAxis, 2 * vec3.dot(oppositeAxis, x));
  }
  const axis = cross(from, to), first = cross(axis, x), second = cross(axis, first);
  const rotated = vec3.add([0, 0, 0], x, first);
  vec3.scaleAndAdd(rotated, rotated, second, 1 / (1 + dot));
  return unit(vec3.scaleAndAdd(rotated, rotated, to, -vec3.dot(rotated, to)));
}

/** Numerical rotation-minimizing frames; source sample() overrides remain authoritative. */
export function sweepFrames(path: SpatialCurve, plane: Plane, radius: number) {
  const closed = path.isLoop();
  const samples = path.sampleWithParameters({ resolution: TRIANGULATION_RESOLUTION / Math.max(1, radius) });
  const parameters = samples.map(sample => sample.t);
  const tangents = parameters.map(t => path.tangent(t));
  const at = (t: number) => path.at(closed ? (t % 1 + 1) % 1 : t).position;
  const smooth = (t: number) => {
    const h = 1e-7;
    if (!closed && (t === 0 || t === 1)) return;
    const step = Math.min(h, closed ? h : Math.min(t, 1 - t) / 2);
    const point = at(t), left = unit(difference(point, at(t - step))), right = unit(difference(at(t + step), point));
    if (vec3.distance(left, right) > 1e-4 || vec3.dot(unit(vec3.add([0, 0, 0], left, right)), path.tangent(t)) < 1 - 1e-6) {
      throw new RangeError('Sweep path must be smooth with a continuous tangent; corners and cusps are unsupported');
    }
  };
  // A corner need not coincide with a sample parameter. Concentrate derivative
  // checks where secant direction changes fail to shrink under bisection.
  const regularInterval = (a: number, b: number, depth = 0): void => {
    const middle = (a + b) / 2;
    const p = at(a), q = at(middle), r = at(b);
    const left = unit(difference(q, p)), right = unit(difference(r, q));
    if (vec3.distance(left, right) <= 1e-3) return;
    if (depth >= 20) throw new RangeError('Sweep path must be smooth; a corner, cusp, or unresolved bend was detected');
    regularInterval(a, middle, depth + 1); regularInterval(middle, b, depth + 1);
  };
  for (let i = 1; i < parameters.length; i++) regularInterval(parameters[i - 1], parameters[i]);
  for (let i = 0; i < parameters.length; i++) {
    smooth(parameters[i]);
    if (i) smooth((parameters[i - 1] + parameters[i]) / 2);
  }
  if (closed && vec3.distance(tangents[0], tangents[tangents.length - 1]) > 1e-6) throw new RangeError('Closed sweep path must have matching endpoint tangents');
  const axes: ReadonlyVec3[] = [transport(plane.xAxis, plane.normal, tangents[0], plane.xAxis)];
  const lengths = [0];
  for (let i = 1; i < samples.length; i++) {
    if (vec3.distance(samples[i - 1].point.position, samples[i].point.position) === 0) throw new RangeError('Sweep path contains a stationary or unresolved interval');
    axes.push(transport(axes[i - 1], tangents[i - 1], tangents[i]));
    lengths.push(lengths[i - 1] + vec3.distance(samples[i - 1].point.position, samples[i].point.position));
  }
  const total = lengths[lengths.length - 1];
  if (total === 0) throw new RangeError('Sweep path must have nonzero length');
  const last = axes[axes.length - 1];
  const correctionRAD = closed ? Math.atan2(vec3.dot(tangents[0], cross(last, axes[0])), vec3.dot(last, axes[0])) : 0;
  type Frame = { origin: ReadonlyVec3; xAxis: ReadonlyVec3; yAxis: ReadonlyVec3; normal: ReadonlyVec3 };
  const cache = new Map<number, Frame>();
  const frame = (parameter: number): Frame => {
    const t = closed && parameter === 1 ? 0 : parameter;
    const known = cache.get(t);
    if (known) return known;
    let low = 0, high = parameters.length - 1;
    while (low + 1 < high) { const middle = (low + high) >> 1; if (parameters[middle] <= t) low = middle; else high = middle; }
    const normal = path.tangent(t);
    let xAxis = transport(axes[low], tangents[low], normal);
    if (correctionRAD !== 0) {
      const fraction = (lengths[low] + (lengths[high] - lengths[low]) * (t - parameters[low]) / (parameters[high] - parameters[low])) / total;
      const angleRAD = correctionRAD * fraction;
      xAxis = vec3.add([0, 0, 0], vec3.scale([0, 0, 0], xAxis, Math.cos(angleRAD)), vec3.scale([0, 0, 0], cross(normal, xAxis), Math.sin(angleRAD)));
    }
    const result = { origin: path.at(t).position, normal, xAxis, yAxis: cross(normal, xAxis) };
    cache.set(t, result); return result;
  };
  const place = (point: Point, t: number): Vertex => {
    const { origin, xAxis, yAxis } = frame(t);
    const position = vec3.scaleAndAdd([0, 0, 0], origin, xAxis, point.x);
    return { position: vec3.scaleAndAdd(position, position, yAxis, point.y) };
  };
  return { closed, parameters, lengths, total, frame, place };
}
