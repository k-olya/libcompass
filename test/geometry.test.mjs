import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import {
  Circle, Edge, Face, Line, LineSegment, Plane, Sketch, Solid, SpatialCurve, SpatialSurface, extrude,
} from 'libcompass';
import { extrude as operationExtrude } from 'libcompass/operations/extrude';
import { extrude as legacyExtrude } from 'libcompass/extrude';
import { setTriangulationResolution } from 'libcompass';

// Precision regressions run at the finest supported setting.
setTriangulationResolution(0.001);

assert.equal(operationExtrude, extrude);
assert.equal(legacyExtrude, extrude);

const boundaries = vertices => vertices.map((start, i) => new Edge({ start, end: vertices[(i + 1) % vertices.length] }));

const close = (actual, expected, tolerance = 1e-5) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

function polygon(sketch, coordinates, reverse = false) {
  const points = coordinates.map(([x, y]) => ({ x, y }));
  // Unordered segments, independent endpoint objects, and mixed edge directions.
  const segments = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return new LineSegment({ start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y } });
  });
  if (reverse) segments.reverse();
  sketch.add(...segments.map((segment, i) => i % 2 ? new LineSegment({ start: segment.end, end: segment.start }) : segment));
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

  // Analytic boundary objects are shared by exactly two incident surfaces.
  const incidence = new Map(solid.boundaries.map(boundary => [boundary, 0]));
  for (const surface of solid.surfaces) {
    assert.ok(surface instanceof Face || surface instanceof SpatialSurface);
    if (surface instanceof Face) {
      const triangles = surface.triangulate();
      for (let i = 0; i < triangles.length; i += 9) {
        const [ax, ay, az, bx, by, bz, cx, cy, cz] = triangles.subarray(i, i + 9);
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const normal = surface.plane.normal;
        assert.ok((uy * vz - uz * vy) * normal[0] + (uz * vx - ux * vz) * normal[1] +
          (ux * vy - uy * vx) * normal[2] > 0, 'Face plane and triangle normals must agree');
      }
    }
    for (const boundary of surface.boundaries) {
      assert.ok(solid.vertices.includes(boundary.start));
      assert.ok(solid.vertices.includes(boundary.end));
      incidence.set(boundary, incidence.get(boundary) + 1);
    }
  }
  for (const count of incidence.values()) assert.equal(count, 2);

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
  const point = { x: 3, y: -2 };
  const direction = [2, 4];
  const line = new Line({ point, direction });
  direction[0] = 99;
  assert.deepEqual(line.at(0.5), { x: 4, y: 0 });
  assert.deepEqual(line.at(-1), { x: 1, y: -6 });
  const segment = new LineSegment({ start: point, end: { x: 7, y: 2 } });
  assert.equal(segment.start, point);
  assert.deepEqual(segment.at(0.25), { x: 4, y: -1 });
  const circle = new Circle({ center: point, radius: 2 });
  close(circle.at(0.25).x, 3);
  close(circle.at(0.25).y, 0);
  assert.ok(circle.sample().length > 12);
  assert.throws(() => new Circle({ center: { x: NaN, y: 0 }, radius: 1 }), RangeError);
  assert.throws(() => new Line({ point, direction: [0, 0] }), RangeError);
  assert.throws(() => new LineSegment({ start: point, end: point }), RangeError);
  assert.throws(() => new Circle({ center: point, radius: 0 }), RangeError);
});

test('planes defined by three points map between sketch and world coordinates', () => {
  const plane = new Plane({ a: { position: [0, 0, 2] }, b: [1, 0, 2], c: [0, 0, 3] });
  assert.deepEqual(plane.normal, [0, -1, 0]);
  assert.deepEqual(plane.toWorld({ x: 2, y: 3 }).position, [2, 0, 5]);
  assert.deepEqual(plane.toLocal({ position: [2, 0, 5] }), { x: 2, y: 3 });
  assert.throws(() => plane.toLocal([0, 1, 2]), RangeError);
  assert.throws(() => new Plane({ a: [0, 0, 0], b: [1, 1, 1], c: [2, 2, 2] }), RangeError);
  assert.throws(() => plane.toLocal({ position: [0, Infinity, 0] }), RangeError);
});

test('concave profiles extrude obliquely without filling their concavities', () => {
  const sketch = polygon(new Sketch(), [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]], true);
  sketch.add({ x: 99, y: 99 }, new Line({ point: { x: 0, y: 0 }, direction: [1, 1] }));
  const solid = extrude({ sketch, axis: vec3.normalize([0, 0, 0], [0.5, -0.25, 3]), length: Math.hypot(0.5, -0.25, 3) });
  checkSolid(solid, 21);
  assert.equal(solid.vertices.length, 12);
  assert.equal(solid.boundaries.length, 18);
  assert.equal(solid.surfaces.length, 8);
});

test('a concave boundary beginning at a reflex corner has a consistent face plane', () => {
  const points = [[4, 1], [1, 1], [1, 4], [0, 4], [0, 0], [4, 0]].map(([x, y]) => ({ x, y }));
  const sketch = new Sketch().add(...points.map((point, i) => new LineSegment({ start: point, end: points[(i + 1) % points.length] })));
  const solid = sketch.extrude({ length: 3 });
  checkSolid(solid, 21);
  const top = solid.surfaces.find((face) => face instanceof Face && face.outer.length === 6 && face.plane.normal[2] > 0);
  assert.ok(top);
  const next = Sketch.fromFace(top);
  assert.equal(next.plane, top.plane);
  assert.deepEqual(next.elements, []);
});

test('multiple profiles, multiple holes, and nested islands use even-odd fill', () => {
  const sketch = new Sketch();
  rectangle(sketch, 1, 1, 2, 2, true); // hole, deliberately listed before its outer profile
  rectangle(sketch, -5, 0, 2, 2); // disconnected material
  rectangle(sketch, 1.5, 1.5, 1, 1); // island inside the first hole
  rectangle(sketch, 0, 0, 10, 10, true);
  rectangle(sketch, 6, 2, 3, 3);
  const solid = sketch.extrude({ length: 2 });
  checkSolid(solid, (100 - 4 - 9 + 1 + 4) * 2);
  assert.equal(solid.vertices.length, 40);
  assert.equal(solid.boundaries.length, 60);
  assert.equal(solid.surfaces.length, 26);
  assert.equal(solid.triangulate().length / 9, 76);
  assert.equal(solid.surfaces.filter((face) => face instanceof Face && face.holes.length === 2).length, 2);

  const top = solid.surfaces.find((face) => face instanceof Face && face.holes.length === 2 && face.plane.normal[2] > 0);
  const nextSketch = Sketch.fromFace(top);
  assert.equal(nextSketch.plane, top.plane);
  assert.deepEqual(nextSketch.elements, []);
  const boundaryEdge = top.boundaries[0];
  assert.ok(solid.boundaries.includes(boundaryEdge));
  assert.ok(top.vertices.includes(boundaryEdge.start));
  const midpoint = nextSketch.plane.toLocal(boundaryEdge.at(0.5));
  assert.ok(Number.isFinite(midpoint.x) && Number.isFinite(midpoint.y));
  const reusedPlane = new Plane({ a: top.outer[0].start, b: top.outer[1].start, c: top.outer[2].start });
  close(reusedPlane.normal[2], 1);
});

test('circles remain analytic through extrusion and are faceted only when triangulated', () => {
  const sketch = new Sketch();
  const outer = new Circle({ center: { x: 0, y: 0 }, radius: 3 });
  sketch.add(outer, new Circle({ center: { x: 0, y: 0 }, radius: 1 }));
  const solid = sketch.extrude({ length: 5 });
  assert.equal(solid.vertices.length, 4);
  assert.equal(solid.boundaries.length, 4);
  assert.equal(solid.surfaces.length, 4);
  assert.ok(solid.boundaries.every(boundary => boundary instanceof SpatialCurve && boundary.isLoop()));
  const area = [3, 1].reduce((sum, radius, i) => {
    const count = new Circle({ center: { x: 0, y: 0 }, radius }).sample().length - 1;
    return sum + (i ? -1 : 1) * count / 2 * radius ** 2 * Math.sin(2 * Math.PI / count);
  }, 0);
  checkSolid(solid, area * 5);
  assert.equal(solid.vertices.length, 4);
  assert.equal(solid.boundaries.length, 4);
  assert.equal(sketch.elements[0], outer);
  assert.equal(outer.radius, 3);
  const top = solid.surfaces.find(surface => surface instanceof Face && surface.plane.normal[2] > 0);
  const next = Sketch.fromFace(top);
  assert.equal(next.plane, top.plane);
  assert.deepEqual(next.elements, []);
  next.add(...sketch.elements);
  checkSolid(next.extrude({ length: 1 }), area);
});

test('negative depth on a tilted plane still gives outward winding', () => {
  const plane = new Plane({ a: [0, 0, 2], b: [1, 0, 2], c: [0, 0, 3] });
  const sketch = rectangle(new Sketch({ plane }), 0, 0, 2, 3);
  checkSolid(sketch.extrude({ axis: vec3.normalize([0, 0, 0], [0.5, 3, 1]), length: Math.hypot(0.5, 3, 1) }), 18);
});

test('signed lengths multiply normalized axes without modifying the input', () => {
  const plane = new Plane({ a: [2, 3, 4], b: [3, 3, 5], c: [2, 4, 5] });
  const sketch = rectangle(new Sketch({ plane }), 0, 0, 2, 3);
  const corners = [[0, 0], [2, 0], [2, 3], [0, 3]].map(([x, y]) => plane.toWorld({ x, y }).position);
  for (const axis of [undefined, [0.6, 0, 0.8], [3, 0, 4], [3e-200, 0, 4e-200], [3e307, 0, 4e307]]) {
    const original = axis?.slice();
    for (const length of [3, -3]) {
      const displacement = vec3.scale([0, 0, 0], axis ? [0.6, 0, 0.8] : plane.normal, length);
      const expected = corners.flatMap(point => [point, vec3.add([0, 0, 0], point, displacement)]);
      for (const body of [extrude({ sketch, axis, length }), sketch.extrude({ axis, length })]) {
        checkSolid(body, 6 * Math.abs(vec3.dot(plane.normal, displacement)));
        assert.equal(body.vertices.length, 8);
        for (const point of expected) {
          assert.ok(body.vertices.some(vertex => vec3.distance(point, vertex.position) < 1e-10));
        }
      }
      assert.deepEqual(axis, original);
    }
  }
});

test('collinear boundary vertices are retained and triangulated correctly', () => {
  const sketch = polygon(new Sketch(), [[0, 0], [1, 0], [2, 0], [2, 2], [0, 2]]);
  const solid = sketch.extrude({ length: -2 });
  checkSolid(solid, 8);
  assert.equal(solid.vertices.length, 10);
});

test('invalid or ambiguous sketches and degenerate extrusions fail explicitly', () => {
  const square = () => rectangle(new Sketch(), 0, 0, 4, 4);
  assert.throws(() => new Sketch().extrude({ length: 1 }), /closed profile/);
  const open = new Sketch().add(new LineSegment({ start: { x: 0, y: 0 }, end: { x: 1, y: 0 } }));
  assert.throws(() => open.extrude({ length: 1 }), /closed/);
  for (const length of [0, NaN, Infinity, -Infinity, undefined]) {
    assert.throws(() => square().extrude({ length }), /length.*finite and nonzero/);
  }
  assert.throws(() => square().extrude({ axis: [0, 0, 0], length: 1 }), /nonzero/);
  assert.throws(() => square().extrude({ axis: [Math.SQRT1_2, Math.SQRT1_2, 0], length: 1 }), /leave/);
  assert.throws(() => square().extrude({ axis: [0, 0, NaN], length: 1 }), /finite/);
  const touching = rectangle(square(), 0, 1, 1, 1);
  assert.throws(() => touching.extrude({ length: 1 }), /intersect or touch/);
  const crossing = polygon(new Sketch(), [[0, 0], [4, 4], [0, 3], [3, 0]]);
  assert.throws(() => crossing.extrude({ length: 1 }), /intersect/);
  const branch = square().add(new LineSegment({ start: { x: 0, y: 0 }, end: { x: -1, y: 0 } }));
  assert.throws(() => branch.extrude({ length: 1 }), /unbranched/);
  const vertex = { position: [0, 0, 0] };
  assert.throws(() => new Edge({ start: vertex, end: vertex }), RangeError);
  assert.throws(() => new Face({ outer: boundaries([vertex, { position: [1, 0, 0] }, { position: [1, 1, 0] }, { position: [0, 1, 1] }]) }), /plane/);
});

test('varied concave profiles with holes remain watertight with the expected volume', () => {
  let seed = 12345;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let sample = 0; sample < 12; sample++) {
    const count = 7 + sample;
    const loop = Array.from({ length: count }, (_, i) => {
      const angleRAD = 2 * Math.PI * i / count, radius = 2 + random() * 2;
      return [radius * Math.cos(angleRAD), radius * Math.sin(angleRAD)];
    });
    const sketch = polygon(new Sketch(), loop);
    rectangle(sketch, -0.25, -0.25, 0.5, 0.5);
    const area = Math.abs(loop.reduce((sum, a, i) => {
      const b = loop[(i + 1) % count];
      return sum + a[0] * b[1] - a[1] * b[0];
    }, 0)) / 2 - 0.25;
    checkSolid(sketch.extrude({ axis: vec3.normalize([0, 0, 0], [0.2, -0.3, 2]), length: (sample % 2 ? -1 : 1) * Math.hypot(0.2, -0.3, 2) }), area * 2);
  }
});
