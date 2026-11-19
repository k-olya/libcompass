import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Memo, Node } from 'libcompass';
import { Node as DirectNode } from 'libcompass/Node';

class Mesh extends Memo {
  calls = 0;

  constructor(positions) {
    super();
    this.positions = new Float32Array(positions);
  }

  triangulateUncached() {
    this.calls += 1;
    return this.positions;
  }
}

test('supports importing the class directly', () => {
  assert.equal(DirectNode, Node);
});

test('an empty node has children and produces an empty Float32Array', () => {
  const node = new Node();
  assert.deepEqual(node.children, []);
  assert.deepEqual(node.triangulate(), new Float32Array());
  assert.notEqual(node.children, new Node().children);
});

test('concatenates children in order, calling each child once', () => {
  const node = new Node();
  const first = new Mesh([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const second = new Mesh([0, 0, 1, 1, 0, 1, 0, 1, 1]);
  node.add(first, second);

  const result = node.triangulate();
  assert.deepEqual(result, new Float32Array([
    ...first.positions, ...second.positions,
  ]));
  assert.equal(first.calls, 1);
  assert.equal(second.calls, 1);
  result[0] = 99;
  assert.equal(first.positions[0], 0);
});

test('traverses nested nodes and handles empty children', () => {
  const root = new Node();
  const branch = new Node();
  branch.add(new Mesh([1, 2, 3]), new Node());
  root.add(new Node(), branch, new Mesh([4, 5, 6]));

  assert.deepEqual(root.triangulate(), new Float32Array([1, 2, 3, 4, 5, 6]));
});

test('add and remove accept variadic children, preserve order, and return the receiver', () => {
  const parent = new Node();
  const first = new Node();
  const second = new Node();
  const third = new Node();
  const fourth = new Node();
  const missing = new Node();
  assert.equal(parent.add(), parent);
  assert.equal(parent.add(first, second, third, fourth, first), parent);
  assert.deepEqual(parent.children, [first, second, third, fourth, first]);
  assert.equal(parent.remove(), parent);
  assert.deepEqual(parent.children, [first, second, third, fourth, first]);
  assert.equal(parent.remove(missing), parent);
  assert.deepEqual(parent.children, [first, second, third, fourth, first]);
  assert.equal(parent.remove(first, third, first), parent);
  assert.deepEqual(parent.children, [second, fourth]);
  assert.equal(parent.children[0], second);
  assert.equal(parent.children[1], fourth);
  parent.remove(second, fourth);
  assert.deepEqual(parent.children, []);
});
