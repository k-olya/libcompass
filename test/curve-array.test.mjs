import assert from 'node:assert/strict';
import { test } from 'node:test';
import { curveArray, SpatialCurve, spatialCurve, sketch, circle, Z, XY, SpatialLine, Plane, Solid, TRIANGULATION_RESOLUTION } from 'libcompass';

const near = (actual, expected, tolerance = 1e-8) => Array.from(actual).forEach((value, i) =>
  assert.ok(Math.abs(value - expected[i]) < tolerance, `${actual} != ${expected}`));
const straight = spatialCurve(t => ({ position: [10, 20, 30 + 20 * t] }));

test('curve arrays solve spacing pairs, use the full path by default, and reverse travel', () => {
  for (const options of [{ N: 4 }, { offset: 5 }, { N: 4, offset: 5 }, { N: 4, width: 20 }, { offset: 5, width: 20 }]) {
    const result = curveArray({ object: Z, curve: straight, follow: true, ...options });
    assert.equal(result.length, 4);
    result.forEach((line, i) => {
      assert.notEqual(line, Z);
      near(line.origin, [10, 20, 30 + 5 * i]); near(line, Z);
    });
  }
  for (const options of [{ offset: -5 }, { N: 4, width: -20 }, { N: 4, offset: -5 }, { width: -20, offset: -5 }]) {
    const result = curveArray({ object: Z, curve: straight, follow: true, ...options });
    assert.equal(result.length, 4);
    result.forEach((line, i) => { near(line.origin, [10, 20, 50 - 5 * i]); near(line, [0, 0, -1]); });
  }
  const partial = curveArray({ object: Z, curve: straight, N: 2, width: 8 });
  near(partial[1].origin, [10, 20, 34]);
  assert.equal(curveArray({ object: Z, curve: straight, offset: 6 }).length, 3);
  near(Z.origin, [0, 0, 0]); near(Z, [0, 0, 1]);
});

test('curve spacing follows sampled arc length rather than normalized parameter', () => {
  const curve = spatialCurve(t => ({ position: [0, 0, 20 * Math.expm1(t) / Math.expm1(1)] }));
  const copies = curveArray({ object: Z, curve, N: 4 });
  copies.forEach((line, i) => near(line.origin, [0, 0, 5 * i], TRIANGULATION_RESOLUTION));
});

test('closed paths align local Z to the tangent, omit the closing copy, and retain source sampling', () => {
  const curve = SpatialCurve.fromPlanarCurve(circle(10));
  const copies = curveArray({ object: [Z, [XY]], curve, N: 4, follow: true });
  assert.equal(copies.length, 8);
  [[10, 0, 0], [0, 10, 0], [-10, 0, 0], [0, -10, 0]].forEach((point, i) => {
    near(copies[i * 2].origin, point);
    near(copies[i * 2], [-point[1] / 10, point[0] / 10, 0]);
    near(copies[i * 2 + 1].normal, copies[i * 2]);
  });
  const source = spatialCurve(t => ({ position: [0, 0, 10 * t] }));
  let calls = 0;
  source.sample = () => { calls++; return [0, 0.01, 0.2, 0.8, 1].map(t => source.at(t)); };
  const reversed = curveArray({ object: Z, curve: source, offset: -2, follow: true });
  assert.equal(calls, 1);
  reversed.forEach((line, i) => near(line.origin, [0, 0, 10 - 2 * i]));
  const target = spatialCurve(t => ({ position: [t, 0, 0] }));
  target.sample = () => [0, 0.17, 0.91, 1].map(t => target.at(t));
  const targetCopy = curveArray({ object: target, curve: straight, N: 1 })[0];
  assert.equal(targetCopy.sample().length, 4);
  near(targetCopy.sample()[1].position, [10.17, 20, 30]);
});

test('following a nonplanar helix uses its spatial tangent and preserves offsets about world origin', () => {
  const helix = spatialCurve({
    at: t => ({ position: [10 * Math.cos(2 * Math.PI * t), 10 * Math.sin(2 * Math.PI * t), 10 * t] }),
    tangent: t => [-20 * Math.PI * Math.sin(2 * Math.PI * t), 20 * Math.PI * Math.cos(2 * Math.PI * t), 10],
  });
  const copies = curveArray({ object: [Z, XY], curve: helix, N: 5, follow: true });
  for (let i = 0; i < 5; i++) {
    near(copies[2 * i].origin, helix.at(i / 5).position);
    near(copies[2 * i], helix.tangent(i / 5));
    near(copies[2 * i + 1].normal, helix.tangent(i / 5));
  }
  const shifted = Z.displace([2, 3, 4]);
  const copy = curveArray({ object: shifted, curve: straight, N: 1 })[0];
  near(copy.origin, [12, 23, 34]); near(shifted.origin, [2, 3, 4]);
});

test('curve arrays flatten nested targets, retain shared solid topology and leave caches unchanged', () => {
  const part = sketch().add(circle(1)).extrude(2);
  const cached = part.triangulate();
  const target = Object.freeze([Z, Object.freeze([XY, Object.freeze([part])])]);
  const copies = curveArray({ object: target, curve: straight, N: 2 });
  assert.deepEqual(copies.map(item => item.constructor), [SpatialLine, Plane, Solid, SpatialLine, Plane, Solid]);
  near(copies[3].origin, [10, 20, 40]);
  for (const solid of [copies[2], copies[5]]) {
    assert.notEqual(solid, part);
    assert.ok(solid.boundaries.every(boundary => solid.surfaces.filter(surface => surface.boundaries.includes(boundary)).length === 2));
    assert.ok(solid.surfaces.every(surface => !part.surfaces.includes(surface)));
    assert.ok(solid.triangulate().every(Number.isFinite));
  }
  assert.equal(part.triangulate(), cached);
  assert.deepEqual(curveArray({ object: [[], [[]]], curve: straight, N: 2 }), []);
});

test('default, undefined and false follow keep orientation without evaluating tangents', () => {
  const curve = SpatialCurve.fromPlanarCurve(circle(10));
  curve.tangent = () => { throw new Error('Orientation-preserving arrays do not need tangents'); };
  for (const follow of [{}, { follow: undefined }, { follow: false }]) {
    const copies = curveArray({ object: [Z, XY], curve, N: 4, ...follow });
    copies.forEach((copy, i) => near(i % 2 === 0 ? copy : copy.normal, [0, 0, 1]));
    near(copies[0].origin, [10, 0, 0]);
    assert.equal(copies.length, 8);
  }
  const corner = spatialCurve(t => ({ position: [t, Math.abs(t - 0.5), 0] }));
  const copies = curveArray({ object: Z, curve: corner, N: 2, follow: false });
  near(copies[1].origin, [0.5, 0, 0]); near(copies[1], Z);
  const reversed = curveArray({ object: Z, curve: straight, N: 2, offset: -5 });
  near(reversed[1].origin, [10, 20, 45]); near(reversed[1], Z);
  const stationary = spatialCurve(() => ({ position: [0, 0, 0] }));
  assert.throws(() => curveArray({ object: Z, curve: stationary, N: 2, follow: false }), /nonzero length/);
});

test('curve arrays reject ambiguous spacing, overlong patterns and nonregular paths', () => {
  for (const options of [{}, { width: 10 }, { N: 2, offset: 1, width: 2 }, { N: 0 }, { offset: 0 },
    { offset: Infinity }, { N: 2, width: 21 }, { N: 2, offset: -11 }, { offset: 2, width: -10 }, { N: 1.5 }]) {
    assert.throws(() => curveArray({ object: Z, curve: straight, ...options }), RangeError);
  }
  const stationary = spatialCurve(() => ({ position: [0, 0, 0] }));
  assert.throws(() => curveArray({ object: Z, curve: stationary, N: 2 }), RangeError);
  const corner = spatialCurve(t => ({ position: [t, Math.abs(t - 0.5), 0] }));
  assert.throws(() => curveArray({ object: Z, curve: corner, N: 2, follow: true }), /smooth|corner|cusp/);
  assert.throws(() => curveArray({ object: Z, curve: {}, N: 2 }), TypeError);
  assert.throws(() => curveArray({ object: {}, curve: straight, N: 2 }), TypeError);
  const untracked = spatialCurve(t => ({ position: [0, 0, t] }));
  untracked.sample = () => [0, 0.5, 1].map(t => ({ position: [0, 0, t] }));
  assert.throws(() => curveArray({ object: Z, curve: untracked, N: 2 }), /this.at/);
});
