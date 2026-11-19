import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Memo, Node } from 'libcompass';
import { Memo as DirectMemo } from 'libcompass/Memo';

class Triangle extends Memo {
  calls = 0;
  z = 0;

  triangulateUncached() {
    this.calls += 1;
    return new Float32Array([0, 0, this.z, 1, 0, this.z, 0, 1, this.z]);
  }
}

test('Memo extends Node and caches even empty triangulations', () => {
  assert.equal(DirectMemo, Memo);
  const memo = new Memo();
  assert.ok(memo instanceof Node);
  const first = memo.triangulate();
  assert.deepEqual(first, new Float32Array());
  assert.equal(memo.triangulate(), first);
  memo.refresh();
  assert.notEqual(memo.triangulate(), first);
});

test('geometry subclasses compute lazily and refresh invalidates their cache', () => {
  const triangle = new Triangle();
  triangle.refresh();
  assert.equal(triangle.calls, 0);
  const first = triangle.triangulate();
  triangle.z = 2;
  assert.equal(triangle.triangulate(), first);
  assert.equal(triangle.calls, 1);

  triangle.refresh();
  triangle.refresh();
  assert.equal(triangle.calls, 1);
  const next = triangle.triangulate();
  assert.notEqual(next, first);
  assert.deepEqual(next, new Float32Array([0, 0, 2, 1, 0, 2, 0, 1, 2]));
  assert.equal(triangle.triangulate(), next);
  assert.equal(triangle.calls, 2);
});

test('Memo aggregates children and refresh affects only its own cache', () => {
  const parent = new Memo();
  const triangle = new Triangle();
  parent.children.push(triangle);
  const first = parent.triangulate();
  triangle.z = 3;
  parent.refresh();
  const next = parent.triangulate();
  assert.notEqual(next, first);
  assert.deepEqual(next, first);
  assert.equal(triangle.calls, 1);

  triangle.refresh();
  assert.equal(parent.triangulate(), next);
  parent.refresh();
  assert.deepEqual(parent.triangulate(), new Float32Array([
    0, 0, 3, 1, 0, 3, 0, 1, 3,
  ]));
  assert.equal(triangle.calls, 2);

  parent.children = [];
  parent.refresh();
  assert.deepEqual(parent.triangulate(), new Float32Array());
});

test('failed triangulations are retried rather than cached', () => {
  class Retry extends Memo {
    calls = 0;

    triangulateUncached() {
      if (++this.calls === 1) throw new Error('triangulation failed');
      return super.triangulateUncached();
    }
  }
  const memo = new Retry();
  assert.throws(() => memo.triangulate(), /triangulation failed/);
  const result = memo.triangulate();
  assert.equal(memo.triangulate(), result);
  assert.equal(memo.calls, 2);
});

test('add and remove leave memoized geometry cached until explicitly refreshed', () => {
  const parent = new Memo();
  const first = new Triangle();
  const second = new Triangle();
  second.z = 2;
  parent.add(first);
  const original = parent.triangulate();
  assert.equal(parent.add(second), parent);
  assert.equal(parent.triangulate(), original);
  assert.equal(second.calls, 0);
  parent.refresh();
  const combined = parent.triangulate();
  assert.deepEqual(combined, new Float32Array([...first.triangulate(), ...second.triangulate()]));
  assert.equal(parent.remove(first), parent);
  assert.equal(parent.triangulate(), combined);
  parent.refresh();
  assert.deepEqual(parent.triangulate(), second.triangulate());
});
