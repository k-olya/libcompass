import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mat4 } from 'gl-matrix';
import { Memo, Node, functionalize, transformMat4 } from 'libcompass';
import { transformMat4 as directTransform } from 'libcompass/util/transformMat4';
import { functionalize as directFunctionalize } from 'libcompass/util/functionalize';

test('transforms only the selected points and returns the original array', () => {
  assert.equal(directTransform, transformMat4);
  const points = new Float32Array([
    9, 8, 7, 1, 2, 3, 2, -1, 0, 6, 5, 4,
  ]);
  const matrix = mat4.fromValues(
    0, 2, 0, 0,
    -3, 0, 0, 0,
    0, 0, 4, 0,
    10, 20, 30, 1,
  );

  assert.equal(transformMat4(points, matrix, 1, 2), points);
  assert.deepEqual(points, new Float32Array([
    9, 8, 7, 4, 22, 42, 13, 24, 30, 6, 5, 4,
  ]));
});

test('defaults to all remaining points and supports homogeneous division', () => {
  const matrix = mat4.create();
  matrix[3] = 1;
  const points = new Float32Array([9, 8, 7, 1, 2, 3]);
  transformMat4(points, matrix, 1);
  assert.deepEqual(points, new Float32Array([9, 8, 7, 0.5, 1, 1.5]));

  matrix[15] = 0;
  const zeroW = new Float32Array([0, 2, 4]);
  transformMat4(zeroW, matrix);
  assert.deepEqual(zeroW, new Float32Array([0, 2, 4]));
});

test('zero points is a no-op, including empty arrays and the end of a buffer', () => {
  const matrix = mat4.fromTranslation(mat4.create(), [1, 2, 3]);
  const points = new Float32Array([4, 5, 6, 7, 8, 9]);
  transformMat4(points, matrix, 0, 0);
  transformMat4(points, matrix, 2, 0);
  assert.deepEqual(points, new Float32Array([4, 5, 6, 7, 8, 9]));
  assert.deepEqual(transformMat4(new Float32Array(), matrix), new Float32Array());
});

test('invalid ranges throw before modifying any points', () => {
  const points = new Float32Array([1, 2, 3, 4, 5, 6]);
  const matrix = mat4.fromTranslation(mat4.create(), [1, 2, 3]);
  for (const [start, n] of [
    [-1, 1], [0, -1], [0.5, 1], [0, 0.5], [1, 2], [3, 0],
    [NaN, 1], [0, Infinity],
  ]) {
    assert.throws(() => transformMat4(points, matrix, start, n), RangeError);
  }
  assert.deepEqual(points, new Float32Array([1, 2, 3, 4, 5, 6]));
});

test('functionalize forwards arguments, preserves this, and returns the result', () => {
  assert.equal(directFunctionalize, functionalize);
  const append = functionalize('append');
  const object = {
    values: [1],
    append(...values) {
      this.values.push(...values);
      return this.values;
    },
  };
  assert.equal(append(object, 2, 3), object.values);
  assert.deepEqual(object.values, [1, 2, 3]);
});

test('functionalize supports zero arguments and dispatches to subclass overrides', () => {
  const triangulate = functionalize('triangulate');
  class Mesh extends Memo {
    triangulateUncached() {
      return new Float32Array([1, 2, 3]);
    }
  }
  assert.deepEqual(triangulate(new Node()), new Float32Array());
  assert.deepEqual(triangulate(new Mesh()), new Float32Array([1, 2, 3]));
});
