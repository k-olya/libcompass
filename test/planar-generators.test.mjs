import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LineSegment, polyline, rectangle, sketch } from 'libcompass';

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
  const segments = rectangle({ corner1: start, corner2: end });
  closed(segments);
  assert.deepEqual(coordinates(segments), [[4, 3], [-2, 3], [-2, -1], [4, -1]]);
  assert.equal(segments[0].start, start);
  assert.equal(segments[1].end, end);
  const body = sketch().add(...segments).extrude({ length: 2 });
  assert.equal(body.surfaces.length, 6);
  assert.equal(body.triangulate().length / 9, 12);
  for (const end of [{ x: 4, y: 7 }, { x: 9, y: 3 }, { x: Infinity, y: 2 }]) {
    assert.throws(() => rectangle({ corner1: start, corner2: end }), RangeError);
  }
});

test('center rectangles mirror any corner about an offset center without modifying inputs', () => {
  const center = Object.freeze({ x: 5, y: -3 });
  for (const x of [3, 7]) for (const y of [-7, 1]) {
    const corner = Object.freeze({ x, y });
    const segments = rectangle({ center, corner2: corner });
    closed(segments);
    assert.deepEqual(segments.map(segment => segment.start.x).sort((a, b) => a - b), [3, 3, 7, 7]);
    assert.deepEqual(segments.map(segment => segment.start.y).sort((a, b) => a - b), [-7, -7, 1, 1]);
    assert.equal(segments[1].end, corner);
  }
  assert.throws(() => rectangle({ center, corner2: { x: 5, y: 1 } }), RangeError);
  assert.throws(() => rectangle({ center: { x: NaN, y: 0 }, corner2: center }), RangeError);
});

test('sketch add accepts generated arrays, mixed arguments and large point arrays', () => {
  const segments = Object.freeze(rectangle({ center: { x: 0, y: 0 }, corner2: { x: 1, y: 2 } }));
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

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const nearPoint = (actual, expected) => { near(actual.x, expected.x); near(actual.y, expected.y); };
function dimensions(segments, width, height) {
  closed(segments);
  assert.equal(segments.length, 4);
  const lengths = segments.map(({ start, end }) => Math.hypot(end.x - start.x, end.y - start.y));
  lengths.forEach((length, i) => near(length, i % 2 ? height : width));
  for (let i = 0; i < 4; i++) {
    const a = segments[i], b = segments[(i + 1) % 4];
    near((a.end.x - a.start.x) * (b.end.x - b.start.x) + (a.end.y - a.start.y) * (b.end.y - b.start.y), 0);
  }
}

test('rectangle side lengths and all size anchors respect rotation without changing inputs', () => {
  const center = Object.freeze({ x: 7, y: -3 });
  const corner1 = Object.freeze({ x: 5, y: 1 }), corner2 = Object.freeze({ x: 9, y: 6 });
  for (const rotationDEG of [0, 30, 90, -90, 180, 270, 390]) {
    const rotationRAD = rotationDEG * Math.PI / 180, cos = Math.cos(rotationRAD), sin = Math.sin(rotationRAD);
    const dx = 8 * cos + 4 * sin, dy = 8 * sin - 4 * cos;
    for (const anchor of [{}, { center }, { corner1 }, { corner2 }]) {
      const segments = rectangle({ ...anchor, width: 8, height: 4, rotation: rotationDEG });
      dimensions(segments, 8, 4);
      if (anchor.corner1) {
        assert.equal(segments[0].start, corner1);
        nearPoint(segments[1].end, { x: corner1.x + dx, y: corner1.y + dy });
      } else if (anchor.corner2) {
        assert.equal(segments[1].end, corner2);
        nearPoint(segments[0].start, { x: corner2.x - dx, y: corner2.y - dy });
      } else {
        const midpoint = anchor.center ?? { x: 0, y: 0 };
        nearPoint(segments[0].start, { x: midpoint.x - dx / 2, y: midpoint.y - dy / 2 });
        nearPoint(segments[1].end, { x: midpoint.x + dx / 2, y: midpoint.y + dy / 2 });
      }
    }
  }
  const rotated = rectangle({ center, width: 8, height: 4, rotation: 30 });
  const boundingWidth = Math.max(...rotated.map(s => s.start.x)) - Math.min(...rotated.map(s => s.start.x));
  near(boundingWidth, 8 * Math.cos(Math.PI / 6) + 4 * Math.sin(Math.PI / 6));
  assert.notEqual(boundingWidth, 8);
  const body = sketch().add(rotated).extrude({ length: 3 });
  assert.equal(body.surfaces.length, 6);
  assert.equal(body.triangulate().length / 9, 12);
});

test('rectangle corner inputs remain real corners and determine sizes in the rotated frame', () => {
  const center = Object.freeze({ x: 3, y: -2 });
  const source = rectangle({ center, width: 8, height: 4, rotation: 30 });
  const corner1 = Object.freeze({ ...source[0].start }), corner2 = Object.freeze({ ...source[1].end });
  for (const options of [{ corner1, corner2 }, { corner1: corner2, corner2: corner1 },
    { center, corner1 }, { center, corner2 }, { center, corner1: corner2 }, { center, corner2: corner1 }]) {
    const result = rectangle({ ...options, rotation: 30 });
    dimensions(result, 8, 4);
    if (options.corner1) assert.equal(result[0].start, options.corner1);
    if (options.corner2) assert.equal(result[1].end, options.corner2);
    const midpoint = { x: (result[0].start.x + result[1].end.x) / 2, y: (result[0].start.y + result[1].end.y) / 2 };
    nearPoint(midpoint, center);
  }
  // At a quarter turn, world X separation is the rectangle's height, not width.
  dimensions(rectangle({ corner1: { x: 0, y: 0 }, corner2: { x: 4, y: 8 }, rotation: 90 }), 8, 4);
});

test('rectangles reject ambiguous, incomplete, degenerate and nonfinite definitions', () => {
  const center = { x: 0, y: 0 }, corner1 = { x: -2, y: -1 }, corner2 = { x: 2, y: 1 };
  for (const options of [{ center, corner1, corner2 }, { corner1, corner2, width: 4 },
    { center, corner1, height: 2 }, { center, corner2, width: 4, height: 2 }, { corner1, corner2, width: 4, height: 2 }]) {
    assert.throws(() => rectangle(options), /Ambiguous rectangle/);
  }
  for (const options of [{}, { center }, { corner1 }, { corner2 }, { width: 4 }, { center, width: 4 }, { corner1, height: 2 }]) {
    assert.throws(() => rectangle(options), /rectangle needs/);
  }
  for (const options of [{ width: 0, height: 2 }, { width: 4, height: -1 }, { width: Infinity, height: 2 },
    { width: 4, height: NaN }, { width: 4, height: 2, rotation: Infinity },
    { center: { x: NaN, y: 0 }, width: 4, height: 2 }, { corner1: center, corner2: center },
    { corner1: center, corner2: { x: 1, y: 1 }, rotation: 45 },
    { center, corner2: { x: 1, y: 1 }, rotation: 45 },
    { corner1: { x: 1e308, y: 0 }, width: 1e308, height: 2 }]) {
    assert.throws(() => rectangle(options), RangeError);
  }
});
