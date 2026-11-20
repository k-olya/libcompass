import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Circle, PlanarCurve, Plane, Sketch, SpatialCurve, TRIANGULATION_RESOLUTION, planarCurve } from 'libcompass';

const close = (actual, expected, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('sketches retain planar curves and reject open extrusion profiles', () => {
  const curve = planarCurve({ at: t => ({ x: t, y: t * t }) });
  const sketch = new Sketch().add(curve);
  assert.equal(sketch.elements[0], curve);
  assert.throws(() => sketch.extrude({ length: 1 }), /closed/);
  sketch.add(new Circle({ center: { x: 0, y: 0 }, radius: 2 }));
  assert.throws(() => sketch.extrude({ length: 1 }), /closed/);
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
  const angleRAD = Math.PI / 3;
  close(circle.at(angleRAD / (2 * Math.PI)).x, 3 + 2 * Math.cos(angleRAD));
  close(circle.at(angleRAD / (2 * Math.PI)).y, -2 + 2 * Math.sin(angleRAD));
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
  assert.equal('circle' in lifted, false);
  assert.notEqual(lifted.plane, plane);
  assert.equal(lifted.isLoop(), false);
  assert.equal(lifted.at(0), lifted.start);
  assert.equal(lifted.at(1), lifted.end);
  assert.deepEqual(lifted.at(0.25).position, [2.25, -3, 4.0625]);
  assert.deepEqual(lifted.end.position, [3, -3, 5]);
  plane.origin[2] = 99;
  assert.deepEqual(lifted.at(0.25).position, [2.25, -3, 4.0625]);
  delete curve.sample; // Construction was lazy; sampling now delegates to the planar curve.
  assert.equal(lifted.sample().at(-1), lifted.end);
  assert.throws(() => SpatialCurve.fromPlanarCurve({ curve: {} }), TypeError);
  assert.equal('fromCircle' in SpatialCurve, false);
});

test('every planar and lifted spatial loop sample repeats its closing point', () => {
  const ellipse = new PlanarCurve({ at: t => {
    const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI;
    return { x: 3 * Math.cos(angleRAD), y: 2 * Math.sin(angleRAD) };
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
  const original = new Circle({ center: { x: 2, y: 3 }, radius: 1.123456789 });
  const lifted = SpatialCurve.fromPlanarCurve({ curve: original });
  close(lifted.at(0.5).position[0], 2 - original.radius);
  assert.equal(lifted.planarCurve, original);
  assert.equal('circle' in lifted, false);
});

test('lifting accepts plain parametric evaluators and delegates subclass subdivision without curve-type checks', () => {
  const plain = { scale: 2, at(t) { return { x: this.scale * t, y: t * t }; } };
  const lifted = SpatialCurve.fromPlanarCurve({ curve: plain });
  assert.deepEqual(lifted.at(0.25).position, [0.5, 0.0625, 0]);
  assert.equal(lifted.isLoop(), false);
  assert.equal(lifted.sample().at(-1), lifted.end);

  let requestedResolution;
  const parameters = [0, 0.2, 0.75, 1];
  class CustomCurve extends PlanarCurve {
    constructor() { super({ at: t => ({ x: t, y: t * t }) }); }
    sampleParameters({ resolution } = {}) { requestedResolution = resolution; return parameters; }
  }
  const source = new CustomCurve();
  const spatial = SpatialCurve.fromPlanarCurve({ curve: source });
  assert.equal(spatial.planarCurve, source);
  assert.equal(spatial.sampleParameters({ resolution: 0.0001 }), parameters);
  assert.equal(requestedResolution, 0.0001);
  assert.deepEqual(spatial.sample().map(vertex => vertex.position[0]), parameters);
});

test('subdivision resolution is validated and circles share the generic sampler', () => {
  const circle = new Circle({ center: { x: 0, y: 0 }, radius: 2 });
  const curve = new PlanarCurve({ at: t => ({ x: t, y: t * t }) });
  for (const definition of [circle, curve]) {
    const lifted = SpatialCurve.fromPlanarCurve({ curve: definition });
    const coarse = definition.sampleParameters({ resolution: 0.01 });
    const fine = definition.sampleParameters({ resolution: 0.0001 });
    assert.ok(fine.length > coarse.length);
    assert.equal(fine[0], 0); assert.equal(fine.at(-1), 1);
    assert.deepEqual(lifted.sampleParameters({ resolution: 0.0001 }), fine);
    for (const resolution of [-1, 0, NaN, Infinity]) {
      assert.throws(() => definition.sampleParameters({ resolution }), RangeError);
      assert.throws(() => lifted.sampleParameters({ resolution }), RangeError);
    }
  }
});


test('midpoint deviation controls dyadic subdivision for both planar and spatial curves', () => {
  const curve = new PlanarCurve({ at: t => ({ x: t, y: t * t }) });
  assert.deepEqual(curve.sampleParameters({ resolution: 0.1 }), [0, 0.5, 1]);
  assert.deepEqual(curve.sampleParameters({ resolution: 0.01 }), Array.from({ length: 9 }, (_, i) => i / 8));
  const spatial = SpatialCurve.fromPlanarCurve({ curve });
  const parameters = curve.sampleParameters();
  assert.equal(spatial.sampleParameters(), parameters);
  for (let i = 1; i < parameters.length; i++) {
    const a = curve.at(parameters[i - 1]), b = curve.at(parameters[i]);
    const middle = curve.at((parameters[i - 1] + parameters[i]) / 2);
    assert.ok(Math.hypot(middle.x - (a.x + b.x) / 2, middle.y - (a.y + b.y) / 2) <= TRIANGULATION_RESOLUTION);
  }
  assert.equal(Circle.prototype.sampleParameters, PlanarCurve.prototype.sampleParameters);
  assert.equal(new Circle({ center: { x: 0, y: 0 }, radius: 10 }).sample().length, 257);
});
