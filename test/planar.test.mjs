import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Circle, PlanarCurve, Plane, Sketch, SpatialCurve, TRIANGULATION_RESOLUTION, planarCurve } from 'libcompass';

const close = (actual, expected, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('sketches retain planar curves and do not silently discard unsupported extrusion profiles', () => {
  const curve = planarCurve({ at: t => ({ x: t, y: t * t }) });
  const sketch = new Sketch().add(curve);
  assert.equal(sketch.elements[0], curve);
  assert.throws(() => sketch.extrude({ direction: [0, 0, 1] }), /only circular planar curves/);
  sketch.add(new Circle({ center: { x: 0, y: 0 }, radius: 2 }));
  assert.throws(() => sketch.extrude({ direction: [0, 0, 1] }), /only circular planar curves/);
});

test('circles are normalized planar curves with exact shared loop endpoints', () => {
  const circle = new Circle({ center: { x: 3, y: -2 }, radius: 2 });
  assert.ok(circle instanceof PlanarCurve);
  assert.equal(circle.start, circle.end);
  assert.equal(circle.at(0), circle.start);
  assert.equal(circle.at(1), circle.end);
  assert.deepEqual(circle.at(0), { x: 5, y: -2 });
  close(circle.at(0.25).x, 3); close(circle.at(0.25).y, 0);
  close(circle.at(0.5).x, 1); close(circle.at(0.5).y, -2);
  close(circle.at(0.75).x, 3); close(circle.at(0.75).y, -4);
  const angle = Math.PI / 3;
  close(circle.at(angle / (2 * Math.PI)).x, 3 + 2 * Math.cos(angle));
  close(circle.at(angle / (2 * Math.PI)).y, -2 + 2 * Math.sin(angle));
  for (const t of [-1, 1.01, 2 * Math.PI, NaN, Infinity]) assert.throws(() => circle.at(t), RangeError);
  const samples = circle.sample();
  assert.equal(samples[0], circle.start);
  assert.equal(samples.at(-1), circle.start);
  assert.ok(circle.isLoop());
  for (let i = 0; i + 1 < samples.length; i++) {
    const x = (samples[i].x + samples[i + 1].x) / 2 - circle.center.x;
    const y = (samples[i].y + samples[i + 1].y) / 2 - circle.center.y;
    assert.ok(circle.radius - Math.hypot(x, y) <= TRIANGULATION_RESOLUTION + 1e-12);
  }
});

test('procedural planar curves validate endpoints and adaptively sample local coordinates', () => {
  const start = { x: 0, y: 0 }, end = { x: 1, y: 1 };
  const curve = planarCurve({ at: t => ({ x: t, y: t * t }), start, end });
  assert.ok(curve instanceof PlanarCurve);
  assert.equal(curve.isLoop(), false);
  assert.equal(curve.at(0), start);
  assert.equal(curve.at(1), end);
  assert.deepEqual(curve.at(0.25), { x: 0.25, y: 0.0625 });
  const samples = curve.sample();
  assert.ok(samples.length > 8);
  assert.equal(samples[0], start);
  assert.equal(samples.at(-1), end);
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i], b = samples[i + 1], middle = curve.at((a.x + b.x) / 2);
    assert.ok(Math.hypot(middle.x - (a.x + b.x) / 2, middle.y - (a.y + b.y) / 2) <= TRIANGULATION_RESOLUTION);
  }
  for (const t of [-1, 2, NaN, Infinity]) assert.throws(() => curve.at(t), RangeError);
  assert.throws(() => planarCurve({ at: () => ({ x: NaN, y: 0 }) }), RangeError);
  assert.throws(() => planarCurve({ at: t => ({ x: t, y: 0 }), end: start }), /endpoints/);
  const badMiddle = planarCurve({ at: t => ({ x: t, y: t === 0.5 ? Infinity : 0 }) });
  assert.throws(() => badMiddle.at(0.5), RangeError);
});

test('fromPlanarCurve lifts open curves exactly onto a copied placement frame without sampling', () => {
  const curve = new PlanarCurve({ at: t => ({ x: t, y: t * t }) });
  curve.sample = () => { throw new Error('Unexpected tessellation'); };
  const plane = new Plane({ a: [2, -3, 4], b: [3, -3, 4], c: [2, -3, 5] });
  const lifted = SpatialCurve.fromPlanarCurve({ curve, plane });
  assert.equal(lifted.planarCurve, curve);
  assert.equal(lifted.circle, undefined);
  assert.notEqual(lifted.plane, plane);
  assert.equal(lifted.isLoop(), false);
  assert.equal(lifted.at(0), lifted.start);
  assert.equal(lifted.at(1), lifted.end);
  assert.deepEqual(lifted.at(0.25).position, [2.25, -3, 4.0625]);
  assert.deepEqual(lifted.end.position, [3, -3, 5]);
  plane.origin[2] = 99;
  assert.deepEqual(lifted.at(0.25).position, [2.25, -3, 4.0625]);
  assert.equal(lifted.sample().at(-1), lifted.end);
  assert.throws(() => SpatialCurve.fromPlanarCurve({ curve: {} }), TypeError);
  assert.equal('fromCircle' in SpatialCurve, false);
});

test('every planar and lifted spatial loop sample repeats its closing point', () => {
  const ellipse = new PlanarCurve({ at: t => {
    const angle = (t === 1 ? 0 : t) * 2 * Math.PI;
    return { x: 3 * Math.cos(angle), y: 2 * Math.sin(angle) };
  } });
  assert.notEqual(ellipse.start, ellipse.end);
  assert.ok(ellipse.isLoop());
  for (const planar of [ellipse, new Circle({ center: { x: 0, y: 0 }, radius: 2 })]) {
    const spatial = SpatialCurve.fromPlanarCurve({ curve: planar });
    assert.ok(spatial.isLoop());
    assert.equal(spatial.start, spatial.end);
    const points = planar.sample(), vertices = spatial.sample();
    assert.deepEqual(points[0], points.at(-1));
    assert.equal(points.at(-1), planar.end);
    assert.equal(vertices[0], vertices.at(-1));
    close(spatial.at(0.123456789).position[0], planar.at(0.123456789).x);
    close(spatial.at(0.123456789).position[1], planar.at(0.123456789).y);
  }
  const center = { x: 2, y: 3 };
  const original = new Circle({ center, radius: 1.123456789 });
  const lifted = SpatialCurve.fromPlanarCurve({ curve: original });
  center.x = 99;
  close(lifted.at(0.5).position[0], 2 - original.radius);
  assert.equal(lifted.circle.radius, original.radius);
});
