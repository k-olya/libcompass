import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Circle, Edge, Face, Line, LineSegment, Plane, Point, Sketch, Solid, Vertex, extrude,
} from 'libcompass';

const close = (actual, expected, tolerance = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

function polygon(sketch, coordinates, reverse = false) {
  const points = coordinates.map(([x, y]) => new Point(x, y));
  // Unordered segments, independent endpoint objects, and mixed edge directions.
  const segments = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return new LineSegment(new Point(a.x, a.y), new Point(b.x, b.y));
  });
  if (reverse) segments.reverse();
  sketch.add(...segments.map((segment, i) => i % 2 ? new LineSegment(segment.end, segment.start) : segment));
  return sketch;
}

function rectangle(sketch, x, y, width, height, reverse = false) {
  return polygon(sketch, [[x, y], [x + width, y], [x + width, y + height], [x, y + height]], reverse);
}

function volume(positions) {
  let result = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(i, i + 9);
    result += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return result;
}

function checkSolid(solid, expectedVolume) {
  assert.ok(solid instanceof Solid);
  const positions = solid.triangulate();
  assert.ok(positions instanceof Float32Array);
  assert.equal(positions.length % 9, 0);
  close(volume(positions), expectedVolume, Math.max(1e-5, expectedVolume * 1e-6));

  // Every topological edge has two incident faces with opposing boundary directions.
  const incidence = new Map(solid.edges.map((edge) => [edge, []]));
  for (const face of solid.faces) {
    assert.ok(face instanceof Face);
    const triangles = face.triangulate();
    for (let i = 0; i < triangles.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = triangles.subarray(i, i + 9);
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const normal = face.plane.normal;
      assert.ok((uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] +
        (ux * vy - uy * vx) * normal[2] > 0, 'Face plane and triangle normals must agree');
    }
    let index = 0;
    for (const loop of [face.outer, ...face.holes]) {
      loop.forEach((start, i) => {
        const end = loop[(i + 1) % loop.length], edge = face.edges[index++];
        assert.ok(solid.vertices.includes(start));
        assert.ok(solid.vertices.includes(end));
        incidence.get(edge).push(edge.start === start && edge.end === end ? 1 : -1);
      });
    }
  }
  for (const directions of incidence.values()) {
    assert.equal(directions.length, 2);
    assert.equal(directions[0] + directions[1], 0);
  }

  // Verify the triangulated surface itself is watertight and consistently wound.
  const meshEdges = new Map();
  for (let i = 0; i < positions.length; i += 9) {
    const triangle = [0, 3, 6].map((offset) => Array.from(positions.subarray(i + offset, i + offset + 3)).join(','));
    for (let j = 0; j < 3; j++) {
      const a = triangle[j], b = triangle[(j + 1) % 3];
      assert.notEqual(a, b);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const entries = meshEdges.get(key) ?? [];
      entries.push(a < b ? 1 : -1);
      meshEdges.set(key, entries);
    }
  }
  for (const directions of meshEdges.values()) {
    assert.equal(directions.length, 2);
    assert.equal(directions[0] + directions[1], 0);
  }
  return positions;
}

test('sketch entities retain their mathematical definitions and can be evaluated', () => {
  const point = new Point(3, -2);
  const direction = [2, 4];
  const line = new Line(point, direction);
  direction[0] = 99;
  assert.deepEqual(line.at(0.5), new Point(4, 0));
  assert.deepEqual(line.at(-1), new Point(1, -6));
  const segment = new LineSegment(point, new Point(7, 2));
  assert.equal(segment.start, point);
  assert.deepEqual(segment.at(0.25), new Point(4, -1));
  const circle = new Circle(point, 2);
  close(circle.at(Math.PI / 2).x, 3);
  close(circle.at(Math.PI / 2).y, 0);
  assert.equal(circle.sample(12).length, 12);
  assert.throws(() => new Point(NaN, 0), RangeError);
  assert.throws(() => new Line(point, [0, 0]), RangeError);
  assert.throws(() => new LineSegment(point, point), RangeError);
  assert.throws(() => new Circle(point, 0), RangeError);
  assert.throws(() => circle.sample(2), RangeError);
});

test('planes defined by three points map between sketch and world coordinates', () => {
  const plane = new Plane(new Vertex([0, 0, 2]), [1, 0, 2], [0, 0, 3]);
  assert.deepEqual(plane.normal, [0, -1, 0]);
  assert.deepEqual(plane.toWorld(new Point(2, 3)).position, [2, 0, 5]);
  assert.deepEqual(plane.toLocal(new Vertex([2, 0, 5])), new Point(2, 3));
  assert.throws(() => plane.toLocal([0, 1, 2]), RangeError);
  assert.throws(() => new Plane([0, 0, 0], [1, 1, 1], [2, 2, 2]), RangeError);
  assert.throws(() => new Vertex([0, Infinity, 0]), RangeError);
});

test('concave profiles extrude obliquely without filling their concavities', () => {
  const sketch = polygon(new Sketch(), [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], true);
  sketch.add(new Point(99, 99), new Line(new Point(0, 0), [1, 1]));
  const solid = extrude(sketch, [0.5, -0.25, 3]);
  checkSolid(solid, 21);
  assert.equal(solid.vertices.length, 12);
  assert.equal(solid.edges.length, 18);
  assert.equal(solid.faces.length, 8);
});

test('a concave boundary beginning at a reflex corner has a consistent face plane', () => {
  const points = [[4, 1], [1, 1], [1, 4], [0, 4], [0, 0], [4, 0]].map(([x, y]) => new Point(x, y));
  const sketch = new Sketch().add(...points.map((point, i) => new LineSegment(point, points[(i + 1) % points.length])));
  const solid = sketch.extrude([0, 0, 3]);
  checkSolid(solid, 21);
  const top = solid.faces.find((face) => face.outer.length === 6 && face.plane.normal[2] > 0);
  assert.ok(top);
  checkSolid(Sketch.fromFace(top).extrude([0, 0, 1]), 7);
});

test('multiple profiles, multiple holes, and nested islands use even-odd fill', () => {
  const sketch = new Sketch();
  rectangle(sketch, 1, 1, 2, 2, true); // hole, deliberately listed before its outer profile
  rectangle(sketch, -5, 0, 2, 2); // disconnected material
  rectangle(sketch, 1.5, 1.5, 1, 1); // island inside the first hole
  rectangle(sketch, 0, 0, 10, 10, true);
  rectangle(sketch, 6, 2, 3, 3);
  const solid = sketch.extrude([0, 0, 2]);
  checkSolid(solid, (100 - 4 - 9 + 1 + 4) * 2);
  assert.equal(solid.vertices.length, 40);
  assert.equal(solid.edges.length, 60);
  assert.equal(solid.faces.length, 26);
  assert.equal(solid.triangulate().length / 9, 76);
  assert.equal(solid.faces.filter((face) => face.holes.length === 2).length, 2);

  const top = solid.faces.find((face) => face.holes.length === 2 && face.plane.normal[2] > 0);
  const nextSketch = Sketch.fromFace(top);
  checkSolid(nextSketch.extrude([0, 0, 1]), 87);
  const boundaryEdge = top.edges[0];
  assert.ok(solid.edges.includes(boundaryEdge));
  assert.ok(top.vertices.includes(boundaryEdge.start));
  assert.ok(nextSketch.plane.toLocal(boundaryEdge.at(0.5)) instanceof Point);
  const reusedPlane = new Plane(...top.outer.slice(0, 3));
  close(reusedPlane.normal[2], 1);
});

test('circles remain analytic in sketches and produce faceted annular solids', () => {
  const sketch = new Sketch();
  const outer = new Circle(new Point(0, 0), 3);
  sketch.add(outer, new Circle(new Point(0, 0), 1));
  const segments = 32;
  const solid = sketch.extrude([0, 0, 5], segments);
  const area = segments / 2 * (3 ** 2 - 1 ** 2) * Math.sin(2 * Math.PI / segments);
  checkSolid(solid, area * 5);
  assert.equal(solid.vertices.length, 128);
  assert.equal(solid.faces.length, 66);
  assert.equal(sketch.elements[0], outer);
  assert.equal(outer.radius, 3);
});

test('negative depth on a tilted plane still gives outward winding', () => {
  const plane = new Plane([0, 0, 2], [1, 0, 2], [0, 0, 3]);
  const sketch = rectangle(new Sketch(plane), 0, 0, 2, 3);
  checkSolid(sketch.extrude([0.5, 3, 1]), 18);
});

test('collinear boundary vertices are retained and triangulated correctly', () => {
  const sketch = polygon(new Sketch(), [[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]]);
  const solid = sketch.extrude([0, 0, -2]);
  checkSolid(solid, 8);
  assert.equal(solid.vertices.length, 10);
});

test('invalid or ambiguous sketches and degenerate extrusions fail explicitly', () => {
  const square = () => rectangle(new Sketch(), 0, 0, 4, 4);
  assert.throws(() => new Sketch().extrude([0, 0, 1]), /closed profile/);
  const open = new Sketch().add(new LineSegment(new Point(0, 0), new Point(1, 0)));
  assert.throws(() => open.extrude([0, 0, 1]), /closed/);
  assert.throws(() => square().extrude([0, 0, 0]), /leave/);
  assert.throws(() => square().extrude([1, 1, 0]), /leave/);
  assert.throws(() => square().extrude([0, 0, NaN]), /finite/);
  assert.throws(() => square().extrude([0, 0, 1], 2.5), /resolution/);
  const touching = rectangle(square(), 0, 1, 1, 1);
  assert.throws(() => touching.extrude([0, 0, 1]), /intersect or touch/);
  const crossing = polygon(new Sketch(), [[0, 0], [4, 4], [0, 3], [3, 0]]);
  assert.throws(() => crossing.extrude([0, 0, 1]), /intersect/);
  const branch = square().add(new LineSegment(new Point(0, 0), new Point(-1, 0)));
  assert.throws(() => branch.extrude([0, 0, 1]), /unbranched/);
  const vertex = new Vertex([0, 0, 0]);
  assert.throws(() => new Edge(vertex, vertex), RangeError);
  assert.throws(() => new Face([
    vertex, new Vertex([1, 0, 0]), new Vertex([1, 1, 0]), new Vertex([0, 1, 1]),
  ]), /plane/);
});

test('varied concave profiles with holes remain watertight with the expected volume', () => {
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let sample = 0; sample < 12; sample++) {
    const count = 7 + sample;
    const loop = Array.from({ length: count }, (_, i) => {
      const angle = 2 * Math.PI * i / count, radius = 2 + random() * 2;
      return [radius * Math.cos(angle), radius * Math.sin(angle)];
    });
    const sketch = polygon(new Sketch(), loop);
    rectangle(sketch, -0.25, -0.25, 0.5, 0.5);
    const area = Math.abs(loop.reduce((sum, a, i) => {
      const b = loop[(i + 1) % count];
      return sum + a[0] * b[1] - a[1] * b[0];
    }, 0)) / 2 - 0.25;
    checkSolid(sketch.extrude([0.2, -0.3, sample % 2 ? -2 : 2]), area * 2);
  }
});
