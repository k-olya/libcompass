import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Memo, Transform, TransformMat4 } from 'libcompass';
import { Transform as DirectTransform } from 'libcompass/Transform';

class Triangle extends Memo {
  triangulateUncached() {
    return new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  }
}

function assertPositions(actual, expected) {
  assert.equal(actual.length, expected.length);
  expected.forEach((value, i) => {
    assert.ok(Math.abs(actual[i] - value) < 1e-5, `position ${i}: ${actual[i]} != ${value}`);
  });
}

test('defaults to identity with independent XYZ properties for each instance', () => {
  assert.equal(DirectTransform, Transform);
  const node = new Transform();
  const other = new Transform();
  assert.ok(node instanceof TransformMat4);
  assert.deepEqual(node.position, { x: 0, y: 0, z: 0 });
  assert.deepEqual(node.rotation, { x: 0, y: 0, z: 0 });
  assert.deepEqual(node.scale, { x: 1, y: 1, z: 1 });
  for (const key of ['position', 'rotation', 'scale']) {
    assert.notEqual(node[key], other[key]);
  }
  assert.deepEqual(node.triangulate(), new Float32Array());
  const child = new Triangle();
  node.children.push(child);
  node.refresh();
  assert.deepEqual(node.triangulate(), child.triangulate());
});

test('composes translation, XYZ Euler rotation in radians, and nonuniform scale', () => {
  const node = new Transform();
  node.position = { x: 10, y: 20, z: 30 };
  node.rotation = { x: Math.PI / 2, y: Math.PI / 2, z: Math.PI / 2 };
  node.scale = { x: 2, y: 3, z: 4 };
  node.children.push(new Triangle());

  // T * Rx * Ry * Rz * S: scale in local space, then rotate and translate.
  assertPositions(node.triangulate(), [10, 20, 32, 10, 17, 30, 14, 20, 30]);
});

test('caches results until refresh and rebuilds without changing child geometry', () => {
  const node = new Transform();
  const child = new Triangle();
  const original = child.triangulate();
  node.children.push(child);
  node.position.x = 10;
  const first = node.triangulate();
  assertPositions(first, [11, 0, 0, 10, 1, 0, 10, 0, 1]);

  node.position.x = 20;
  node.rotation.z = Math.PI / 2;
  node.scale.y = -2;
  node.scale.z = 0;
  assert.equal(node.triangulate(), first);

  node.refresh();
  const next = node.triangulate();
  assert.notEqual(next, first);
  assertPositions(next, [20, 1, 0, 22, 0, 0, 20, 0, 0]);
  assert.equal(node.triangulate(), next);
  assert.equal(child.triangulate(), original);
  assert.deepEqual(original, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));

  node.refresh();
  assertPositions(node.triangulate(), [...next]);
});
