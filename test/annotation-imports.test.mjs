import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Node } from 'libcompass/Node';
import { Memo } from 'libcompass/Memo';
import { AnnotatedNode } from 'libcompass/AnnotatedNode';
import { annotate } from 'libcompass/operations/annotate';

test('annotations work with direct class imports, without importing the root module', () => {
  for (const source of [new Node(), new Memo(), new AnnotatedNode()]) {
    for (const wrapper of [source.annotate(), annotate(source)]) {
      assert.ok(wrapper instanceof AnnotatedNode);
      assert.ok(wrapper instanceof Memo);
      assert.ok(wrapper instanceof Node);
      assert.equal(wrapper.children[0], source);
      assert.equal(wrapper.triangulate().length, 0);
    }
  }
});
