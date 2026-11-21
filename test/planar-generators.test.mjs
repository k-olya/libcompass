import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LineSegment, polyline, rectangle, centerRectangle, sketch } from 'libcompass';

const coordinates = segments => segments.map(segment => [segment.start.x, segment.start.y]);
function closed(segments) {
  assert.ok(segments.every(segment => segment instanceof LineSegment));
  segments.forEach((segment, i) => assert.equal(segment.end, segments[(i + 1) % segments.length].start));
}

test('polylines retain ordered points and close loops without duplicate closing segments', () => {
  const points = Object.freeze([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }].map(Object.freeze));
  const open = polyline({ points });
  assert.equal(open.length, 2);
  assert.equal(open[0].start, points[0]);
  assert.equal(open[0].end, open[1].start);
  assert.equal(open[1].end, points[2]);
  for (const input of [points, [...points, { ...points[0] }]]) {
    const loop = polyline({ points: input, loop: true });
    assert.equal(loop.length, 3);
    closed(loop);
    assert.equal(loop.at(-1).end, points[0]);
  }
  assert.equal(polyline({ points: [...points, points[0]] }).length, 3);
  for (const points of [[], [{ x: 0, y: 0 }], [{ x: 1, y: 1 }, { x: 1, y: 1 }], [{ x: 0, y: 0 }, { x: NaN, y: 0 }]]) {
    assert.throws(() => polyline({ points }), RangeError);
  }
  assert.throws(() => polyline({ points: points.slice(0, 2), loop: true }), RangeError);
  assert.throws(() => polyline({ points: [points[0], points[1], points[0]], loop: true }), RangeError);
});

test('rectangles use opposite corners in either coordinate order and share their endpoints', () => {
  const start = Object.freeze({ x: 4, y: 3 }), end = Object.freeze({ x: -2, y: -1 });
  const segments = rectangle({ start, end });
  closed(segments);
  assert.deepEqual(coordinates(segments), [[4, 3], [-2, 3], [-2, -1], [4, -1]]);
  assert.equal(segments[0].start, start);
  assert.equal(segments[1].end, end);
  const body = sketch().add(...segments).extrude({ length: 2 });
  assert.equal(body.surfaces.length, 6);
  assert.equal(body.triangulate().length / 9, 12);
  for (const end of [{ x: 4, y: 7 }, { x: 9, y: 3 }, { x: Infinity, y: 2 }]) {
    assert.throws(() => rectangle({ start, end }), RangeError);
  }
});

test('center rectangles mirror any corner about an offset center without modifying inputs', () => {
  const center = Object.freeze({ x: 5, y: -3 });
  for (const x of [3, 7]) for (const y of [-7, 1]) {
    const corner = Object.freeze({ x, y });
    const segments = centerRectangle({ center, corner });
    closed(segments);
    assert.deepEqual(segments.map(segment => segment.start.x).sort((a, b) => a - b), [3, 3, 7, 7]);
    assert.deepEqual(segments.map(segment => segment.start.y).sort((a, b) => a - b), [-7, -7, 1, 1]);
    assert.equal(segments[1].end, corner);
  }
  assert.throws(() => centerRectangle({ center, corner: { x: 5, y: 1 } }), RangeError);
  assert.throws(() => centerRectangle({ center: { x: NaN, y: 0 }, corner: center }), RangeError);
});

test('sketch add accepts generated arrays, mixed arguments and large point arrays', () => {
  const segments = Object.freeze(centerRectangle({ center: { x: 0, y: 0 }, corner: { x: 1, y: 2 } }));
  const point = Object.freeze({ x: 0, y: 0 });
  const drawing = sketch();
  assert.equal(drawing.add(point, segments, []), drawing);
  assert.deepEqual(drawing.elements, [point, ...segments]);
  const body = drawing.extrude({ length: 1 });
  assert.equal(body.surfaces.length, 6);
  assert.equal(body.triangulate().length / 9, 12);
  const many = new Array(200_000).fill(point);
  const large = sketch().add(many);
  assert.equal(large.elements.length, many.length);
  assert.equal(large.elements.at(-1), point);
  large.add(large.elements);
  assert.equal(large.elements.length, 400_000);
});
