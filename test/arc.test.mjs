import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arc, PlanarCurve, sketch, lineSegment, spatialCurveFromPlanar, ZX } from 'libcompass';

const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test('signed degree sweeps distinguish clockwise, counterclockwise and major arcs', () => {
  const start = Object.freeze({ x: 1, y: 0 }), end = Object.freeze({ x: 0, y: 1 });
  const expected = new Map([[90, [Math.SQRT1_2, Math.SQRT1_2]], [-90, [1 - Math.SQRT1_2, 1 - Math.SQRT1_2]],
    [270, [1 + Math.SQRT1_2, 1 + Math.SQRT1_2]], [-270, [-Math.SQRT1_2, -Math.SQRT1_2]]]);
  for (const [angleDEG, [x, y]] of expected) {
    const curve = arc({ start, end, angle: angleDEG });
    assert.ok(curve instanceof PlanarCurve);
    assert.equal(curve.at(0), start); assert.equal(curve.at(1), end);
    close(curve.at(0.5).x, x); close(curve.at(0.5).y, y);
    const tangent = curve.tangent(0.5), a = curve.at(0.5 - 1e-5), b = curve.at(0.5 + 1e-5);
    close(Math.hypot(...tangent), 1);
    assert.ok(tangent[0] * (b.x - a.x) + tangent[1] * (b.y - a.y) > 0);
  }
  const shallow = arc({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, angle: 1e-6 });
  close(shallow.at(0.5).x, 5);
  assert.ok(shallow.at(0.5).y < 0);
});

test('arcs use adaptive sampling and remain mathematical through lifting and extrusion', () => {
  const curve = arc({ start: { x: -2, y: 0 }, end: { x: 2, y: 0 }, angle: 180 });
  const samples = curve.sampleWithParameters({ resolution: 0.001 });
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i], b = samples[i + 1], middle = curve.at((a.t + b.t) / 2);
    assert.ok(Math.hypot(middle.x - (a.point.x + b.point.x) / 2, middle.y - (a.point.y + b.point.y) / 2) <= 0.001);
  }
  const lifted = spatialCurveFromPlanar({ curve, plane: ZX });
  close(lifted.at(0.5).position[0], -2); close(lifted.at(0.5).position[2], 0);
  const body = sketch().add(curve, lineSegment({ start: curve.end, end: curve.start })).extrude({ length: 3 });
  assert.equal(body.surfaces.length, 4);
  assert.ok(body.triangulate().length > 0);
});

test('center, start and end choose the circle while direction selects the minor or major path', () => {
  const center = Object.freeze({ x: 3, y: -4 }), start = Object.freeze({ x: 5, y: -4 }), end = Object.freeze({ x: 3, y: -2 });
  const ccw = arc({ center, start, end }), cw = arc({ center, start, end, direction: 'clockwise' });
  close(ccw.at(0.5).x, 3 + Math.SQRT2); close(ccw.at(0.5).y, -4 + Math.SQRT2);
  close(cw.at(0.5).x, 3 - Math.SQRT2); close(cw.at(0.5).y, -4 - Math.SQRT2);
  for (const curve of [ccw, cw]) for (const t of [0, 0.123, 0.5, 0.89, 1]) {
    const p = curve.at(t); close(Math.hypot(p.x - center.x, p.y - center.y), 2);
  }
  const reversed = arc({ center, start: end, end: start, direction: 'clockwise' });
  close(reversed.at(0.5).x, ccw.at(0.5).x); close(reversed.at(0.5).y, ccw.at(0.5).y);
  const half = arc({ center, start, end: { x: 1, y: -4 }, direction: 'clockwise' });
  close(half.at(0.5).y, -6);
});

test('start, center and a signed angle calculate the endpoint and preserve the circle', () => {
  const center = Object.freeze({ x: 3, y: -4 }), start = Object.freeze({ x: 5, y: -4 });
  for (const angleDEG of [90, -90, 180, -180, 270, -270]) {
    const curve = arc({ start, center, angle: angleDEG });
    assert.equal(curve.start, start);
    assert.equal(curve.at(1), curve.end);
    const sweepRAD = angleDEG * Math.PI / 180;
    for (const t of [0.123, 0.5, 1]) {
      const p = curve.at(t);
      close(p.x, center.x + 2 * Math.cos(t * sweepRAD));
      close(p.y, center.y + 2 * Math.sin(t * sweepRAD));
      close(Math.hypot(p.x - center.x, p.y - center.y), 2);
    }
    const tangent = curve.tangent(0);
    close(tangent[0], 0); close(tangent[1], Math.sign(angleDEG));
  }
  const curve = arc({ start, center, angle: -270 });
  assert.ok(sketch().add(curve, lineSegment({ start: curve.end, end: start })).extrude({ length: 2 }).triangulate().length > 0);
  for (const options of [{ center: start, angle: 90 }, { center, angle: 0 }, { center, angle: 360 },
    { center, angle: NaN }, { center, angle: 90, direction: 'clockwise' },
    { center, angle: 90, through: { x: 3, y: -2 } }, { center }, { angle: 90 }]) {
    assert.throws(() => arc({ start, ...options }), RangeError);
  }
  assert.throws(() => arc({ start: { x: 1e20, y: 1e20 }, center: { x: 0, y: 0 }, angle: 1e-18 }), /numeric precision/);
});

test('invalid arc angles and endpoints throw', () => {
  const start = { x: 0, y: 0 }, end = { x: 2, y: 0 };
  for (const angleDEG of [0, 360, -360, 720, Infinity, NaN]) assert.throws(() => arc({ start, end, angle: angleDEG }), RangeError);
  assert.throws(() => arc({ start, end: { ...start }, angle: 90 }), RangeError);
  assert.throws(() => arc({ start, end: { x: NaN, y: 0 }, angle: 90 }), RangeError);
  for (const options of [{}, { center: start }, { center: { x: 1, y: 0 }, angle: 90 },
    { center: { x: 1, y: 0 }, direction: 'invalid' }, { center: { x: 0, y: 1 } },
    { center: { x: Infinity, y: 0 } }, { angle: 90, direction: 'clockwise' }]) {
    assert.throws(() => arc({ start, end, ...options }), RangeError);
  }
});

test('three points on the arc determine the circle and traversal, including major arcs', () => {
  const start = { x: 1, y: 0 }, end = { x: 0, y: 1 };
  const minor = arc({ start, through: { x: Math.SQRT1_2, y: Math.SQRT1_2 }, end });
  const major = arc({ start, through: { x: -Math.SQRT1_2, y: -Math.SQRT1_2 }, end, direction: 'clockwise' });
  close(minor.at(0.5).x, Math.SQRT1_2); close(minor.at(0.5).y, Math.SQRT1_2);
  close(major.at(0.5).x, -Math.SQRT1_2); close(major.at(0.5).y, -Math.SQRT1_2);
  for (const curve of [minor, major]) for (const t of [0.1, 0.5, 0.9]) {
    const point = curve.at(t); close(Math.hypot(point.x, point.y), 1);
  }
  const offset = arc({ start: { x: 1000, y: 2000 }, through: { x: 1005, y: 2005 }, end: { x: 1010, y: 2000 } });
  close(offset.at(0.5).x, 1005); close(offset.at(0.5).y, 2005);
  assert.throws(() => arc({ start, through: { x: 0.5, y: 0.5 }, end }), /noncollinear/);
  assert.throws(() => arc({ start, through: start, end }), /noncollinear/);
  assert.throws(() => arc({ start, through: { x: NaN, y: 0 }, end }), RangeError);
  assert.throws(() => arc({ start, through: { x: -1, y: 0 }, end, direction: 'counterclockwise' }), /direction/);
  assert.throws(() => arc({ start, through: { x: -1, y: 0 }, end, angle: 90 }), RangeError);
});
