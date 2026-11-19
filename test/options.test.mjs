import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as compass from 'libcompass';

const { Circle, Edge, Face, Line, LineSegment, Plane, Sketch } = compass;

test('points and vertices are plain objects and geometry retains their identities', () => {
  assert.equal('Point' in compass, false);
  assert.equal('Vertex' in compass, false);
  const center = { x: 1, y: 2 };
  const circle = new Circle({ radius: 3, center });
  assert.equal(circle.center, center);
  assert.deepEqual(circle.at(0), { x: 4, y: 2 });
  const a = { position: [0, 0, 0] }, b = { position: [1, 0, 0] }, c = { position: [0, 1, 0] };
  const edges = [new Edge({ end: b, start: a }), new Edge({ start: b, end: c }), new Edge({ start: c, end: a })];
  const face = new Face({ edges, outer: [a, b, c] });
  assert.equal(face.outer[0], a);
  edges.forEach((edge, i) => assert.equal(face.edges[i], edge));
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
    assert.throws(() => new Face({ outer: [vertex, { position: [1, 0, 0] }, badVertex] }), RangeError);
    assert.throws(() => new Plane({ a: badVertex }), RangeError);
    assert.throws(() => new Plane().toWorld(badPoint), RangeError);
    assert.throws(() => new Plane().toLocal(badVertex), RangeError);
    assert.throws(() => new Circle({ center: point, radius: 1 }).at(value), RangeError);
    assert.throws(() => new Line({ point, direction: [1, 0] }).at(value), RangeError);
    assert.throws(() => new LineSegment({ start: point, end: { x: 1, y: 1 } }).at(value), RangeError);
    assert.throws(() => new Edge({ start: vertex, end: { position: [1, 1, 1] } }).at(value), RangeError);
  }
});
