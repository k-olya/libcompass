import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ellipse, circle, PlanarCurve, sketch, spatialCurveFromPlanar, ZX } from 'libcompass';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('ellipses retain exact equations, shared loop endpoints and rotated analytic tangents', () => {
  const center = Object.freeze({ x: 3, y: -4 });
  const curve = ellipse({ center, radiusX: 6, radiusY: 2, rotation: 90 });
  assert.ok(curve instanceof PlanarCurve);
  assert.equal(curve.start, curve.end);
  assert.equal(curve.at(0), curve.at(1));
  close(curve.at(0).x, 3); close(curve.at(0).y, 2);
  close(curve.at(0.25).x, 1); close(curve.at(0.25).y, -4);
  for (const t of [0.123, 0.5, 0.789]) {
    const p = curve.at(t);
    close(((p.y + 4) / 6) ** 2 + ((p.x - 3) / 2) ** 2, 1);
    const tangent = curve.tangent(t), a = curve.at(t - 1e-5), b = curve.at(t + 1e-5);
    close(Math.hypot(...tangent), 1);
    assert.ok(tangent[0] * (b.x - a.x) + tangent[1] * (b.y - a.y) > 0);
    close(tangent[0] * (p.x - 3) / 4 + tangent[1] * (p.y + 4) / 36, 0);
  }
  const circular = ellipse({ center, radiusX: 2, radiusY: 2 });
  const reference = circle({ center, radius: 2 });
  for (const t of [0, 0.25, 0.123, 1]) assert.deepEqual(circular.at(t), reference.at(t));
  const wrapped = ellipse({ center, radiusX: 6, radiusY: 2, rotation: -270 });
  close(wrapped.at(0.123).x, curve.at(0.123).x); close(wrapped.at(0.123).y, curve.at(0.123).y);
});

test('ellipses sample at the requested deviation and lift/extrude without shape-specific handling', () => {
  const curve = ellipse({ center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 });
  const samples = curve.sampleWithParameters({ resolution: 0.001 });
  assert.equal(samples[0].point, samples.at(-1).point);
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i], b = samples[i + 1], midpoint = curve.at((a.t + b.t) / 2);
    assert.ok(Math.hypot(midpoint.x - (a.point.x + b.point.x) / 2, midpoint.y - (a.point.y + b.point.y) / 2) <= 0.001);
  }
  const lifted = spatialCurveFromPlanar({ curve, plane: ZX });
  assert.equal(lifted.start, lifted.end);
  close(lifted.at(0.25).position[0], 2);
  close(lifted.at(0).position[2], 3);
  const body = sketch().add(curve).extrude({ length: 4 });
  assert.equal(body.surfaces.length, 3);
  assert.equal(body.boundaries.length, 2);
  assert.ok(body.triangulate().length > 0);
});

test('invalid ellipse dimensions, centers and rotations throw', () => {
  const options = { center: { x: 0, y: 0 }, radiusX: 3, radiusY: 2 };
  for (const key of ['radiusX', 'radiusY']) for (const value of [0, -1, NaN, Infinity]) {
    assert.throws(() => ellipse({ ...options, [key]: value }), RangeError);
  }
  assert.throws(() => ellipse({ ...options, center: { x: NaN, y: 0 } }), RangeError);
  assert.throws(() => ellipse({ ...options, rotation: Infinity }), RangeError);
});
