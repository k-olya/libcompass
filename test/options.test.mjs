import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as compass from 'libcompass';

const { Circle, Edge, Face, Line, LineSegment, Plane, Sketch, p } = compass;

test('p copies XY coordinates from numbers, arrays and vertices', () => {
  const array = Object.freeze([1, 2, 3, 4]);
  const vertex = Object.freeze({ position: array });
  for (const point of [p(1, 2), p([1, 2]), p(array), p(new Float32Array(array)), p(vertex)]) {
    assert.deepEqual(point, { x: 1, y: 2 });
  }
  assert.notEqual(p(array), p(array));
  assert.deepEqual(p([1, 2, NaN]), { x: 1, y: 2 });
  const mutable = [3, 4, 5];
  const point = p({ position: mutable });
  mutable[0] = 9;
  assert.deepEqual(point, { x: 3, y: 4 });
  assert.deepEqual(new Circle({ center: p(array), radius: 1 }).at(0), { x: 2, y: 2 });
});

test('p rejects missing and invalid selected coordinates', () => {
  for (const array of [[], [1], [undefined, Number], [NaN, 1], [1, Infinity], [1, -Infinity]]) {
    assert.throws(() => p(array), RangeError);
    assert.throws(() => p({ position: array }), RangeError);
  }
  for (const value of [undefined, NaN, Infinity, -Infinity]) {
    assert.throws(() => p(value, 1), RangeError);
    assert.throws(() => p(1, value), RangeError);
  }
});

test('points and vertices are plain objects and geometry retains their identities', () => {
  assert.equal('Point' in compass, false);
  assert.equal('Vertex' in compass, false);
  const center = { x: 1, y: 2 };
  const circle = new Circle({ radius: 3, center });
  assert.equal(circle.center, center);
  assert.deepEqual(circle.at(0), { x: 4, y: 2 });
  const a = { position: [0, 0, 0] }, b = { position: [1, 0, 0] }, c = { position: [0, 1, 0] };
  const edges = [new Edge({ end: b, start: a }), new Edge({ start: b, end: c }), new Edge({ start: c, end: a })];
  const face = new Face({ outer: edges });
  assert.equal(face.outer[0], edges[0]);
  edges.forEach((edge, i) => assert.equal(face.boundaries[i], edge));
  assert.equal(edges[0].start, a);
  assert.deepEqual(edges[0].at(0.5), { position: [0.5, 0, 0] });
});

test('default options remain independent and raw plane coordinates are copied', () => {
  assert.deepEqual(new Plane().normal, new Plane({}).normal);
  assert.notEqual(new Sketch().plane, new Sketch({}).plane);
  const a = [0, 0, 2];
  const plane = new Plane({ c: [0, 1, 2], a, b: [1, 0, 2] });
  a[2] = 99;
  assert.deepEqual(plane.origin, [0, 0, 2]);
  assert.deepEqual(plane.toLocal({ position: [2, 3, 2] }), { x: 2, y: 3 });
});

test('geometry consumers and computed results reject nonfinite plain coordinates', () => {
  const point = { x: 0, y: 0 }, vertex = { position: [0, 0, 0] };
  for (const value of [NaN, Infinity, -Infinity]) {
    const badPoint = { x: value, y: 0 }, badVertex = { position: [0, value, 0] };
    assert.throws(() => new Circle({ center: badPoint, radius: 1 }), RangeError);
    assert.throws(() => new Line({ point: badPoint, direction: [1, 0] }), RangeError);
    assert.throws(() => new LineSegment({ start: point, end: badPoint }), RangeError);
    assert.throws(() => new Edge({ start: vertex, end: badVertex }), RangeError);
    assert.throws(() => new Face({ outer: [new Edge({ start: vertex, end: { position: [1, 0, 0] } }), new Edge({ start: { position: [1, 0, 0] }, end: badVertex }), new Edge({ start: badVertex, end: vertex })] }), RangeError);
    assert.throws(() => new Plane({ a: badVertex }), RangeError);
    assert.throws(() => new Plane().toWorld(badPoint), RangeError);
    assert.throws(() => new Plane().toLocal(badVertex), RangeError);
    assert.throws(() => new Circle({ center: point, radius: 1 }).at(value), RangeError);
    assert.throws(() => new Line({ point, direction: [1, 0] }).at(value), RangeError);
    assert.throws(() => new LineSegment({ start: point, end: { x: 1, y: 1 } }).at(value), RangeError);
    assert.throws(() => new Edge({ start: vertex, end: { position: [1, 1, 1] } }).at(value), RangeError);
  }
});
