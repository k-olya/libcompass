import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LineSegment, PlanarCurve, lineSegment, polyline, rectangle, roundPolyline, sketch } from 'libcompass';
import { roundPolyline as directRoundPolyline } from 'libcompass/operations/roundPolyline';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const p = (x, y) => ({ x, y });
const line = (x, y, a, b) => lineSegment({ start: p(x, y), end: p(a, b) });
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const curves = result => result.filter(element => element instanceof PlanarCurve);
const lines = result => result.filter(element => element instanceof LineSegment);
const ordered = elements => elements.slice(0, -1).forEach((element, i) => assert.equal(element.end, elements[i + 1].start));

function tangentJoins(elements) {
  for (const curve of curves(elements)) for (const [point, t] of [[curve.start, 0], [curve.end, 1]]) {
    for (const segment of lines(elements)) if (segment.start === point || segment.end === point) {
      const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y;
      const tangent = curve.tangent(t);
      close(Math.abs((dx * tangent[0] + dy * tangent[1]) / Math.hypot(dx, dy)), 1);
    }
  }
}

test('roundPolyline trims a right angle into an exact tangent quarter-circle without modifying inputs', () => {
  assert.equal(roundPolyline, directRoundPolyline);
  const source = Object.freeze([line(0, 0, 4, 0), line(4, 0, 4, 4)].map(segment => {
    Object.freeze(segment.start); Object.freeze(segment.end); return Object.freeze(segment);
  }));
  const result = roundPolyline({ segments: source, radius: 1 });
  assert.equal(result.length, 3); ordered(result); tangentJoins(result);
  assert.deepEqual(result[0].end, p(3, 0)); assert.deepEqual(result[2].start, p(4, 1));
  assert.equal(result[0].start, source[0].start); assert.equal(result[2].end, source[1].end);
  assert.notEqual(result[0], source[0]); assert.deepEqual(source[0].end, p(4, 0));
  for (const point of result[1].sample()) close(Math.hypot(point.x - 3, point.y - 1), 1);
  const midpoint = result[1].at(0.5);
  close(midpoint.x, 3 + Math.SQRT1_2); close(midpoint.y, 1 - Math.SQRT1_2);
  assert.equal(curves(roundPolyline({ segments: source })).length, 1);
  assert.deepEqual(lines(roundPolyline({ segments: source }))[0].end, p(3.5, 0));
});

test('closed rectangles stay ordered and extrude exact rounded profiles', () => {
  const segments = rectangle({ start: p(0, 0), end: p(10, 6) });
  const result = roundPolyline({ segments, radius: 1 });
  assert.equal(lines(result).length, 4); assert.equal(curves(result).length, 4);
  ordered(result); assert.equal(result.at(-1).end, result[0].start); tangentJoins(result);
  const solid = sketch().add(result).extrude({ length: 2 });
  validateSweepMesh(solid.triangulate());
  assert.equal(solid.surfaces.length, 10);
});

test('fully consumed segments disappear, so rounding a square at half its side creates a circle', () => {
  const result = roundPolyline({ segments: rectangle({ start: p(-1, -1), end: p(1, 1) }), radius: 1 });
  assert.equal(result.length, 4); assert.equal(lines(result).length, 0);
  ordered(result); assert.equal(result.at(-1).end, result[0].start);
  for (const curve of result) for (const point of curve.sample()) close(Math.hypot(point.x, point.y), 1);
  validateSweepMesh(sketch().add(result).extrude({ length: 2 }).triangulate());
});

test('shuffled and reversed segments join by coordinates, not point identity', () => {
  const source = rectangle({ start: p(0, 0), end: p(10, 6) });
  const segments = [source[2], source[0], source[3], source[1]].map((segment, i) => i % 2
    ? lineSegment({ start: { ...segment.end }, end: { ...segment.start } })
    : lineSegment({ start: { ...segment.start }, end: { ...segment.end } }));
  const result = roundPolyline({ segments, radius: 1 });
  assert.equal(curves(result).length, 4); tangentJoins(result);
  validateSweepMesh(sketch().add(result).extrude({ length: 2 }).triangulate());
});

test('open ends, missing segments and disconnected components are preserved without requiring a closed path', () => {
  const segments = [line(0, 0, 4, 0), line(4, 0, 4, 4), line(10, 10, 12, 10)];
  const result = roundPolyline({ segments, radius: 1 });
  assert.equal(result.length, 4); assert.equal(curves(result).length, 1);
  assert.equal(result[0].start, segments[0].start);
  assert.equal(result[2].end, segments[1].end);
  assert.equal(result[3].start, segments[2].start); assert.equal(result[3].end, segments[2].end);
  const brokenRectangle = rectangle({ start: p(0, 0), end: p(10, 6) }).slice(0, 3);
  const brokenResult = roundPolyline({ segments: brokenRectangle });
  assert.equal(curves(brokenResult).length, 2); ordered(brokenResult);
  assert.deepEqual(roundPolyline({ segments: [] }), []);
});

test('acute, obtuse and concave turns get the same radius with exact tangencies', () => {
  for (const angleDEG of [-179.99, -135, -45, -0.01, 0.01, 45, 135, 179.99]) {
    const angleRAD = angleDEG * Math.PI / 180;
    const segments = polyline({ points: [p(-100000, 0), p(0, 0), p(100000 * Math.cos(angleRAD), 100000 * Math.sin(angleRAD))] });
    const result = roundPolyline({ segments, radius: 0.75 });
    assert.equal(curves(result).length, 1); ordered(result); tangentJoins(result);
    const curve = curves(result)[0], tangent = curve.tangent(0), sign = Math.sign(angleDEG);
    const center = p(curve.start.x - sign * tangent[1] * 0.75, curve.start.y + sign * tangent[0] * 0.75);
    for (const point of curve.sample()) close(Math.hypot(point.x - center.x, point.y - center.y), 0.75);
  }
  const concave = polyline({ points: [p(0, 0), p(6, 0), p(6, 2), p(2, 2), p(2, 6), p(0, 6)], loop: true });
  validateSweepMesh(sketch().add(roundPolyline({ segments: concave, radius: 0.5 })).extrude({ length: 1 }).triangulate());
});

test('straight continuations stay straight but branches and backtracking throw', () => {
  const straight = [line(0, 0, 2, 0), line(4, 0, 2, 0)];
  assert.equal(curves(roundPolyline({ segments: straight })).length, 0);
  assert.throws(() => roundPolyline({ segments: [...straight, line(2, 0, 2, 2)] }), /more than two/);
  assert.throws(() => roundPolyline({ segments: [line(0, 0, 2, 0), line(1, 0, 2, 0)] }), /overlapping or backtracking/);
});

test('length checks include both endpoint setbacks and reject oversized rounds without modifying any input', () => {
  const segments = rectangle({ start: p(0, 0), end: p(2, 2) }), snapshot = JSON.stringify(segments);
  assert.throws(() => roundPolyline({ segments, radius: 1.1 }), /insufficient/);
  assert.throws(() => roundPolyline({ segments: [line(0, 0, 0.1, 0), line(0.1, 0, 0.1, 4)], radius: 1 }), /insufficient/);
  assert.equal(JSON.stringify(segments), snapshot);
  for (const radius of [0, -1, NaN, Infinity]) assert.throws(() => roundPolyline({ segments, radius }), RangeError);
  assert.throws(() => roundPolyline({ segments: [p(0, 0)] }), TypeError);
  assert.throws(() => roundPolyline({ segments: null }), TypeError);
});
