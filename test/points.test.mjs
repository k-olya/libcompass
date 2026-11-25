import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Circle, Line, LineSegment, Node, Plane, PlanarCurve, circle, points, rectangle, sketch } from 'libcompass';
import { points as directPoints } from 'libcompass/operations/points';

test('points extracts unique local anchors, retaining their first identities', () => {
  assert.equal(points, directPoints);
  const start = Object.freeze({ x: 1, y: 2 }), end = Object.freeze({ x: 3, y: 4 });
  const segment = new LineSegment({ start, end });
  const line = new Line({ point: start, direction: [2, 1] });
  const disk = new Circle({ center: end, radius: 2 });
  const result = points(start, segment, line, disk);
  assert.deepEqual(result, [start, end]);
  for (const [i, anchor] of [start, end].entries()) assert.equal(result[i], anchor);
  assert.notEqual(result, points(start, segment, line, disk));
});

test('points calls curve endpoint evaluators without sampling, including closed curves', () => {
  class Curve extends PlanarCurve {
    calls = [];
    at(t) { this.calls.push(t); return super.at(t); }
    sample() { throw new Error('Anchor collection must not sample curves'); }
  }
  const open = new Curve(t => ({ x: t, y: t * t }));
  const closed = new Curve({ at: t => ({ x: 2 + Math.sin(t * Math.PI), y: t * (1 - t) }), end: { x: 2, y: 0 } });
  const anchors = points(open, closed);
  assert.deepEqual(open.calls, [0, 1]);
  assert.deepEqual(closed.calls, [0, 1]);
  assert.deepEqual(anchors, [open.start, open.end, closed.start]);
  assert.equal(anchors[0], open.start);
  assert.equal(anchors[1], open.end);
  assert.equal(anchors[2], closed.start);
});

test('points recursively flattens mixed variadic readonly arrays and rectangle results in order', () => {
  const sides = Object.freeze(rectangle({ width: 4, height: 2 }));
  const disk = circle(1), extra = Object.freeze({ x: 10, y: 20 });
  const nested = Object.freeze([Object.freeze([sides, Object.freeze([])]), disk]);
  const expected = sides.map(side => side.start);
  assert.deepEqual(points(nested, [[extra]], sides[0]), [...expected, disk.center, extra]);
  assert.equal(points(sides).length, 4, 'Shared rectangle corners appear once');
  assert.deepEqual(points(), []);
  assert.deepEqual(points([[], [[[]]]]), []);
  const many = Object.freeze(new Array(200_000).fill(extra));
  const result = points([many]);
  assert.equal(result.length, 1);
  assert.equal(result.at(-1), extra);
});

test('points deduplicates separate objects by exact XY coordinates across nested inputs', () => {
  const first = Object.freeze({ x: -0, y: 0 });
  const near = Object.freeze({ x: Number.EPSILON, y: 0 });
  const sameX = Object.freeze({ x: 0, y: 1 }), sameY = Object.freeze({ x: 1, y: 0 });
  const result = points(first, [[{ x: 0, y: -0 }, near]], sameX, sameY, [{ ...sameX }, [{ ...sameY }]]);
  assert.deepEqual(result, [first, near, sameX, sameY]);
  assert.equal(result[0], first);
  assert.equal(result[1], near, 'Nearby distinct coordinates remain separate');
});

test('points visits sketch elements in local coordinates and rejects unsupported or nonfinite input', () => {
  const sides = rectangle({ width: 4, height: 2 }), disk = circle(1);
  const drawing = sketch({ plane: new Plane().displace([10, 20, 30]) }).add(sides, disk);
  assert.deepEqual(points(drawing), [...points(sides), disk.center]);
  assert.deepEqual(drawing.elements, [...sides, disk]);
  for (const invalid of [null, undefined, 1, {}, [0, 0], { position: [0, 0, 0] }, new Node()]) {
    assert.throws(() => points([[invalid]]), TypeError);
  }
  for (const invalid of [{ x: NaN, y: 0 }, { x: 0, y: Infinity }]) assert.throws(() => points(invalid), RangeError);
});
