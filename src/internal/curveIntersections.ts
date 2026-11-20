import { Line } from '../Line.js';
import type { LineSegment } from '../LineSegment.js';
import type { PlanarCurve } from '../PlanarCurve.js';
import type { Point } from '../Point.js';
import { parameterizedSamples } from './curveSamples.js';

export type PlanarBoundary = PlanarCurve | LineSegment;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const uniqueParameters = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b)
  .filter((value, i, sorted) => !i || value - sorted[i - 1] > 1e-9);

/** Bracket intersections using the curve's own sampling, then solve its equation. */
export function scalarIntersections<T extends object>(curve: { at(t: number): T; sample(): T[] }, value: (point: T) => number,
  samples = parameterizedSamples(curve)): number[] {
  const values = samples.map(sample => value(sample.point));
  const tolerance = 1e-11 * values.reduce((scale, x) => Math.max(scale, Math.abs(x)), 1);
  if (values.some(x => !Number.isFinite(x))) throw new RangeError('Trim intersection produced nonfinite distances');
  const roots: number[] = [];
  for (let i = 0; i + 1 < samples.length; i++) {
    let a = samples[i].t, b = samples[i + 1].t, fa = values[i];
    const fb = values[i + 1];
    if (Math.abs(fa) <= tolerance && Math.abs(fb) <= tolerance) throw new RangeError('Coincident trim geometry is ambiguous');
    if (Math.abs(fa) <= tolerance) roots.push(a);
    if (Math.abs(fb) <= tolerance) roots.push(b);
    if (fa * fb >= 0 || Math.abs(fa) <= tolerance || Math.abs(fb) <= tolerance) continue;
    for (let iteration = 0; iteration < 60; iteration++) {
      const middle = (a + b) / 2, fm = value(curve.at(middle));
      if (!Number.isFinite(fm)) throw new RangeError('Trim intersection produced nonfinite distances');
      if (Math.abs(fm) <= tolerance) { a = b = middle; break; }
      if (fa * fm < 0) b = middle;
      else { a = middle; fa = fm; }
    }
    const root = (a + b) / 2;
    if (Math.abs(value(curve.at(root))) > tolerance * 2) throw new RangeError('Trim intersection did not converge to the cutting geometry');
    roots.push(root);
  }
  return uniqueParameters(roots);
}

function sampled(curve: PlanarBoundary): { t: number; point: Point }[] {
  return 'sample' in curve ? parameterizedSamples(curve) : [{ t: 0, point: curve.start }, { t: 1, point: curve.end }];
}

/** Generic planar intersections; samples locate candidates, evaluator roots locate cuts. */
export function planarIntersections(a: PlanarBoundary, b: PlanarBoundary | Line): { a: number; b: number }[] {
  if (b instanceof Line) {
    const curve = { at: (t: number) => a.at(t), sample: () => sampled(a).map(sample => sample.point) };
    // Preserve parameter metadata belonging to a rather than this small adapter.
    const roots = scalarIntersections('sample' in a ? a : curve, point => cross(sub(point, b.point), { x: b.direction[0], y: b.direction[1] }));
    const length2 = b.direction[0] ** 2 + b.direction[1] ** 2;
    return roots.map(t => { const delta = sub(a.at(t), b.point); return { a: t, b: (delta.x * b.direction[0] + delta.y * b.direction[1]) / length2 }; });
  }
  const first = sampled(a), second = sampled(b), result: { a: number; b: number }[] = [];
  const size = Math.max(1, ...[...first, ...second].flatMap(({ point }) => [Math.abs(point.x), Math.abs(point.y)]));
  const tolerance = size * 1e-11;
  const derivative = (curve: PlanarBoundary, t: number): Point => {
    const left = Math.max(0, t - 1e-5), right = Math.min(1, t + 1e-5), delta = sub(curve.at(right), curve.at(left));
    return { x: delta.x / (right - left), y: delta.y / (right - left) };
  };
  for (let i = 0; i + 1 < first.length; i++) for (let j = 0; j + 1 < second.length; j++) {
    const p = first[i].point, q = second[j].point, endA = first[i + 1].point, endB = second[j + 1].point;
    if (Math.max(p.x, endA.x) + tolerance < Math.min(q.x, endB.x) || Math.max(q.x, endB.x) + tolerance < Math.min(p.x, endA.x)
      || Math.max(p.y, endA.y) + tolerance < Math.min(q.y, endB.y) || Math.max(q.y, endB.y) + tolerance < Math.min(p.y, endA.y)) continue;
    const da = sub(endA, p), db = sub(endB, q), delta = sub(q, p), determinant = cross(da, db);
    if (Math.abs(determinant) <= 1e-14 * Math.hypot(da.x, da.y) * Math.hypot(db.x, db.y)) {
      if (Math.abs(cross(delta, da)) <= tolerance * Math.hypot(da.x, da.y)) throw new RangeError('Overlapping or tangent trim curves are unsupported');
      continue;
    }
    const u = cross(delta, db) / determinant, v = cross(delta, da) / determinant;
    if (u < -1e-8 || u > 1 + 1e-8 || v < -1e-8 || v > 1 + 1e-8) continue;
    let t = first[i].t + u * (first[i + 1].t - first[i].t), s = second[j].t + v * (second[j + 1].t - second[j].t);
    let converged = false;
    for (let iteration = 0; iteration < 30; iteration++) {
      t = Math.max(0, Math.min(1, t)); s = Math.max(0, Math.min(1, s));
      const error = sub(b.at(s), a.at(t));
      if (Math.hypot(error.x, error.y) <= tolerance) { converged = true; break; }
      const dt = derivative(a, t), ds = derivative(b, s), det = cross(dt, ds);
      if (Math.abs(det) < 1e-14 * Math.hypot(dt.x, dt.y) * Math.hypot(ds.x, ds.y)) break;
      t += cross(error, ds) / det; s += cross(error, dt) / det;
    }
    if (!converged) throw new RangeError('Trim curve intersection did not converge');
    if (!result.some(item => Math.abs(item.a - t) < 1e-9 && Math.abs(item.b - s) < 1e-9)) result.push({ a: t, b: s });
  }
  return result.sort((x, y) => x.a - y.a);
}
