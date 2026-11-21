import assert from 'node:assert/strict';
import { test } from 'node:test';
import { displacementArray, rotationArray, spatialLine, spatialCurve, sketch, circle, SpatialLine, SpatialCurve, Plane, Solid, X, Y, Z, XY } from 'libcompass';

const near = (actual, expected) => Array.from(actual).forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-9, `${actual} != ${expected}`));

test('displacement arrays solve every parameter pair and normalize the direction', () => {
  const source = spatialLine({ direction: [0, 0, 2], origin: [1, 2, 3] });
  for (const parameters of [{ N: 3, offset: 5 }, { N: 3, width: 15 }, { offset: 5, width: 15 }]) {
    const result = displacementArray({ object: source, vector: [3, 4, 0], ...parameters });
    assert.equal(result.length, 3);
    result.forEach((item, i) => {
      assert.ok(item instanceof SpatialLine);
      assert.notEqual(item, source);
      near(item.origin, [1 + i * 3, 2 + i * 4, 3]);
      near(item, source);
    });
    assert.notEqual(result[0], result[1]);
  }
  assert.equal(displacementArray({ object: source, vector: X, width: 10, offset: 5 }).length, 2);
  assert.equal(displacementArray({ object: source, vector: X, width: 10, offset: 3 }).length, 3);
  assert.equal(displacementArray({ object: source, vector: X, width: 0.3, offset: 0.1 }).length, 3);
  const reverse = displacementArray({ object: source, vector: X, N: 2, width: -10 });
  near(reverse[1].origin, [-4, 2, 3]);
  const negativePair = displacementArray({ object: source, vector: X, offset: -5, width: -10 });
  near(negativePair[1].origin, [-4, 2, 3]);
  near(source.origin, [1, 2, 3]);
});

test('rotation arrays default to a full turn, exclude the endpoint and honor offset axes', () => {
  const source = spatialLine({ direction: Z, origin: [2, 0, 0] });
  const axis = spatialLine({ direction: [0, 0, 12], origin: [1, 0, 0] });
  for (const parameters of [{ N: 4 }, { offset: 90 }, { N: 4, offset: 90 }, { N: 4, width: 360 }, { offset: 90, width: 360 }]) {
    const result = rotationArray({ object: source, axis, ...parameters });
    assert.equal(result.length, 4);
    [[2, 0, 0], [1, 1, 0], [0, 0, 0], [1, -1, 0]].forEach((point, i) => near(result[i].origin, point));
    assert.notEqual(result[0], source);
    result.forEach(item => near(item, Z));
  }
  const reverse = rotationArray({ object: source, axis, offset: -90 });
  near(reverse[1].origin, [1, -1, 0]);
  const partial = rotationArray({ object: source, axis: Z, N: 3, width: 180 });
  near(partial[2].origin, [-1, Math.sqrt(3), 0]);
  const single = rotationArray({ object: source, axis: Z, N: 1 });
  assert.equal(single.length, 1); assert.notEqual(single[0], source);
  near(source.origin, [2, 0, 0]); near(axis.origin, [1, 0, 0]);
});

test('nested arrays flatten in repetition-major depth-first order while SpatialLine remains intact', () => {
  const curve = spatialCurve({ at: t => ({ position: [t, 0, 0] }) });
  const target = Object.freeze([Z, Object.freeze([XY, Object.freeze([curve])]), Object.freeze([])]);
  const result = displacementArray({ object: target, vector: Y, N: 2, offset: 5 });
  assert.equal(result.length, 6);
  assert.deepEqual(result.map(item => item.constructor), [SpatialLine, Plane, SpatialCurve, SpatialLine, Plane, SpatialCurve]);
  near(result[3].origin, [0, 5, 0]);
  near(result[4].origin, [0, 5, 0]);
  near(result[5].at(0.5).position, [0.5, 5, 0]);
  near(result[3], Z);
  const turned = rotationArray({ object: result, axis: X, N: 2 });
  assert.equal(turned.length, 12);
  near(turned[9].origin, [0, -5, 0]);
  assert.notEqual(turned[0], result[0]);
  assert.notEqual(turned[6], turned[0]);
  assert.deepEqual(displacementArray({ object: [[], [[]]], vector: X, N: 2, offset: 5 }), []);
  assert.deepEqual(rotationArray({ object: [[], [[]]], axis: X, N: 2 }), []);
  const rotatedNested = rotationArray({ object: target, axis: X, N: 2 });
  assert.equal(rotatedNested.length, 6);
  assert.deepEqual(rotatedNested.map(item => item.constructor), [SpatialLine, Plane, SpatialCurve, SpatialLine, Plane, SpatialCurve]);
  near(Z.origin, [0, 0, 0]); near(XY.origin, [0, 0, 0]);
  near(curve.at(0.5).position, [0.5, 0, 0]);
});

test('arrays of solids retain independent topology and leave source caches unchanged', () => {
  const part = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 2 })).extrude({ length: 3 });
  const cached = part.triangulate();
  const row = displacementArray({ object: part, vector: X, N: 2, offset: 8 });
  const grid = displacementArray({ object: row, vector: Y, N: 3, offset: 8 });
  assert.equal(grid.length, 6);
  grid.forEach((copy, i) => {
    const [x, y, z] = part.vertices[0].position;
    near(copy.vertices[0].position, [x + (i % 2) * 8, y + Math.floor(i / 2) * 8, z]);
  });
  for (const copy of grid) {
    assert.ok(copy instanceof Solid); assert.notEqual(copy, part);
    assert.ok(copy.boundaries.every(boundary => copy.surfaces.filter(surface => surface.boundaries.includes(boundary)).length === 2));
    assert.ok(copy.surfaces.every(surface => !part.surfaces.includes(surface)));
    assert.ok(copy.triangulate().every(Number.isFinite));
  }
  assert.notEqual(grid[0].surfaces[0], grid[2].surfaces[0]);
  assert.equal(part.triangulate(), cached);
});

test('array parameter validation rejects ambiguous and impossible patterns', () => {
  for (const parameters of [{}, { N: 2 }, { offset: 5 }, { width: 10 }, { N: 2, offset: 5, width: 10 },
    { N: 0, offset: 5 }, { N: 2.5, width: 10 }, { N: Infinity, offset: 5 }, { N: NaN, offset: 5 },
    { N: 2, offset: 0 }, { N: 2, width: Infinity }, { N: 2, offset: NaN },
    { offset: 5, width: -10 }, { offset: 20, width: 10 }, { N: 2, offset: Number.MAX_VALUE }]) {
    assert.throws(() => displacementArray({ object: XY, vector: X, ...parameters }), RangeError);
  }
  for (const vector of [[0, 0, 0], [NaN, 1, 0], [Infinity, 0, 0]]) {
    assert.throws(() => displacementArray({ object: XY, vector, N: 2, offset: 5 }), RangeError);
  }
  for (const parameters of [{}, { width: 360 }, { N: 2, offset: 90, width: 180 }, { offset: 0 }, { N: 0 }, { N: 2, width: NaN }]) {
    assert.throws(() => rotationArray({ object: XY, axis: Z, ...parameters }), RangeError);
  }
  assert.throws(() => rotationArray({ object: XY, axis: [0, 0, 1], N: 2 }), TypeError);
  assert.throws(() => displacementArray({ object: {}, vector: X, N: 2, offset: 5 }), TypeError);
});
