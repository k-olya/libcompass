import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mat4 } from 'gl-matrix';
import { Memo, TransformMat4 } from 'libcompass';
import { TransformMat4 as DirectTransformMat4 } from 'libcompass/TransformMat4';

class Triangle extends Memo {
  triangulateUncached() {
    return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  }
}

test('transforms all child geometry, caches it, and preserves child arrays', () => {
  assert.equal(DirectTransformMat4, TransformMat4);
  const matrix = mat4.fromTranslation(mat4.create(), [2, 3, 4]);
  const node = new TransformMat4({ matrix });
  assert.ok(node instanceof Memo);
  const child = new Triangle();
  const original = child.triangulate();
  node.children.push(child, new Triangle());

  const first = node.triangulate();
  assert.deepEqual(first, new Float32Array([
    2, 3, 4, 3, 3, 4, 2, 4, 4,
    2, 3, 4, 3, 3, 4, 2, 4, 4,
  ]));
  matrix[12] = 5;
  assert.equal(node.triangulate(), first);

  node.refresh();
  const next = node.triangulate();
  assert.notEqual(next, first);
  assert.deepEqual(next, new Float32Array([
    5, 3, 4, 6, 3, 4, 5, 4, 4,
    5, 3, 4, 6, 3, 4, 5, 4, 4,
  ]));
  assert.equal(node.triangulate(), next);
  assert.equal(child.triangulate(), original);
  assert.deepEqual(original, new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
});

test('nested transforms apply the child transform before the parent transform', () => {
  const parent = new TransformMat4({ matrix: mat4.fromScaling(mat4.create(), [2, 2, 2]) });
  const child = new TransformMat4({ matrix: mat4.fromTranslation(mat4.create(), [1, 0, 0]) });
  child.children.push(new Triangle());
  parent.children.push(child);

  assert.deepEqual(parent.triangulate(), new Float32Array([
    2, 0, 0, 4, 0, 0, 2, 2, 0,
  ]));
});

test('an empty transform node produces a cached empty array', () => {
  const node = new TransformMat4({ matrix: mat4.create() });
  const result = node.triangulate();
  assert.deepEqual(result, new Float32Array());
  assert.equal(node.triangulate(), result);
});
