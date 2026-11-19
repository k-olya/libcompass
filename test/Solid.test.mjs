import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Circle, Face, Memo, Node, Point, Sketch, Solid, Transform, Vertex } from 'libcompass';

class CountingFace extends Face {
  calls = 0;

  triangulate() {
    this.calls++;
    return super.triangulate();
  }
}

const triangle = (z = 0) => new CountingFace([
  new Vertex([0, 0, z]), new Vertex([1, 0, z]), new Vertex([0, 1, z]),
]);

test('solids are memoized nodes with lazy triangulation and preserved topology', () => {
  const face = triangle();
  const faces = [face];
  const solid = new Solid(faces);
  assert.ok(solid instanceof Node);
  assert.ok(solid instanceof Memo);
  assert.notEqual(solid.faces, faces);
  assert.equal(solid.faces[0], face);
  face.vertices.forEach((vertex, i) => assert.equal(solid.vertices[i], vertex));
  face.edges.forEach((edge, i) => assert.equal(solid.edges[i], edge));
  assert.equal(face.calls, 0);
  const first = solid.triangulate();
  assert.equal(face.calls, 1);
  assert.equal(solid.triangulate(), first);
  solid.refresh();
  assert.equal(face.calls, 1);
  const next = solid.triangulate();
  assert.equal(face.calls, 2);
  assert.notEqual(next, first);
  assert.deepEqual(next, first);
  const empty = new Solid([]);
  const positions = empty.triangulate();
  assert.deepEqual(positions, new Float32Array());
  assert.equal(empty.triangulate(), positions);
});

test('extruded solids can be added directly to scenes and transforms', () => {
  const solid = new Sketch().add(new Circle(new Point(0, 0), 5)).extrude([0, 0, 10], 12);
  const original = solid.triangulate();
  const scene = new Node().add(solid);
  assert.deepEqual(scene.triangulate(), original);
  scene.remove(solid);
  assert.deepEqual(scene.triangulate(), new Float32Array());
  const transform = new Transform().add(solid);
  transform.position = { x: 10, y: 20, z: 30 };
  scene.add(transform);
  const positions = scene.triangulate();
  original.forEach((value, index) => assert.ok(Math.abs(positions[index] - value - [10, 20, 30][index % 3]) < 1e-5));
  assert.equal(solid.triangulate(), original);
});

test('solid children contribute geometry and refresh affects only the requested cache', () => {
  const solid = new Solid([triangle()]);
  const child = new Solid([triangle(2)]);
  const root = new Memo().add(solid);
  const original = solid.triangulate();
  const rootOriginal = root.triangulate();
  solid.add(child);
  assert.equal(solid.triangulate(), original);
  solid.refresh();
  assert.equal(root.triangulate(), rootOriginal);
  const combined = solid.triangulate();
  const childPositions = child.triangulate();
  assert.deepEqual(combined, new Float32Array([...original, ...childPositions]));
  assert.equal(solid.faces.length, 1);
  assert.equal(solid.vertices.length, 3);
  root.refresh();
  assert.deepEqual(root.triangulate(), combined);
  solid.remove(child);
  assert.equal(solid.triangulate(), combined);
  solid.refresh();
  assert.deepEqual(solid.triangulate(), original);
  assert.equal(child.triangulate(), childPositions);
});
