import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Circle, Edge, Face, Memo, Node, Sketch, Solid, Transform, } from 'libcompass';

class CountingFace extends Face {
  calls = 0;

  mesh(context) {
    this.calls++;
    return super.mesh(context);
  }
}

const triangle = (z = 0) => {
  const vertices = [{ position: [0, 0, z] }, { position: [1, 0, z] }, { position: [0, 1, z] }];
  return new CountingFace({ outer: vertices.map((start, i) => new Edge({ start, end: vertices[(i + 1) % 3] })) });
};

test('solids are memoized nodes with lazy triangulation and preserved topology', () => {
  const face = triangle();
  const faces = [face];
  const solid = new Solid({ surfaces: faces });
  assert.ok(solid instanceof Node);
  assert.ok(solid instanceof Memo);
  assert.notEqual(solid.surfaces, faces);
  assert.equal(solid.surfaces[0], face);
  face.vertices.forEach((vertex, i) => assert.equal(solid.vertices[i], vertex));
  face.boundaries.forEach((edge, i) => assert.equal(solid.boundaries[i], edge));
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
  const empty = new Solid({ surfaces: [] });
  const positions = empty.triangulate();
  assert.deepEqual(positions, new Float32Array());
  assert.equal(empty.triangulate(), positions);
});

test('extruded solids can be added directly to scenes and transforms', () => {
  const solid = new Sketch().add(new Circle({ center: { x: 0, y: 0 }, radius: 5 })).extrude({ length: 10 });
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
  const solid = new Solid({ surfaces: [triangle()] });
  const child = new Solid({ surfaces: [triangle(2)] });
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
  assert.equal(solid.surfaces.length, 1);
  assert.equal(solid.vertices.length, 3);
  root.refresh();
  assert.deepEqual(root.triangulate(), combined);
  solid.remove(child);
  assert.equal(solid.triangulate(), combined);
  solid.refresh();
  assert.deepEqual(solid.triangulate(), original);
  assert.equal(child.triangulate(), childPositions);
});
