import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnnotatedNode, Memo, Node, Solid, annotate, annotatedNode, center, circle, colors, sketch } from 'libcompass';
import { AnnotatedNode as DirectAnnotatedNode } from 'libcompass/AnnotatedNode';
import { annotate as directAnnotate } from 'libcompass/operations/annotate';

test('AnnotatedNode is a standard memo group with independent annotation properties', () => {
  assert.equal(AnnotatedNode, DirectAnnotatedNode);
  const group = annotatedNode(), other = new AnnotatedNode();
  assert.ok(group instanceof Memo); assert.ok(group instanceof Node);
  assert.match(group.name, /^mesh\d+$/);
  const nextName = `mesh${Number(group.name.slice(4)) + 1}`;
  assert.deepEqual([other.name, group.color, group.alpha], [nextName, colors.default, 1]);
  group.name = 'Housing'; group.color = '#3399dd'; group.alpha = 0.5;
  assert.deepEqual([other.name, other.color, other.alpha], [nextName, colors.default, 1]);
  class Triangle extends Memo {
    triangulateUncached() { return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); }
  }
  const triangle = new Triangle();
  group.add(triangle);
  const cached = group.triangulate();
  assert.deepEqual(cached, triangle.triangulate());
  group.alpha = 0.2;
  assert.equal(group.triangulate(), cached, 'Annotation edits do not change cached geometry');
  group.add(triangle);
  assert.equal(group.triangulate(), cached);
  group.refresh();
  assert.equal(group.triangulate().length, 2 * cached.length);
  assert.notEqual(group.children, other.children);
});

test('annotate wraps the original solid without changing topology, children or memoized positions', () => {
  assert.equal(annotate, directAnnotate);
  const solid = sketch().add(circle({ center, radius: 2 })).extrude({ length: 3 });
  const child = new Node(); solid.add(child);
  const cached = solid.triangulate(), bytes = cached.slice();
  const surfaces = solid.surfaces, boundaries = solid.boundaries;
  const group = annotate({ solid, name: 'Part', color: '#1188cc', alpha: 0 });
  assert.ok(group instanceof AnnotatedNode);
  assert.deepEqual(group.children, [solid]);
  assert.deepEqual([group.name, group.color, group.alpha], ['Part', '#1188cc', 0]);
  assert.deepEqual(group.triangulate(), bytes, 'Even zero-alpha annotations keep export geometry');
  assert.equal(solid.triangulate(), cached);
  assert.equal(solid.surfaces, surfaces); assert.equal(solid.boundaries, boundaries);
  assert.deepEqual(solid.children, [child]);
  assert.notEqual(annotate({ solid }), annotate({ solid }));
  const method = solid.annotate({ name: 'Part', color: '#1188cc', alpha: 0 });
  assert.ok(method instanceof AnnotatedNode);
  assert.deepEqual([method.name, method.color, method.alpha], ['Part', '#1188cc', 0]);
  assert.deepEqual(method.children, [solid]);
  assert.deepEqual(method.triangulate(), group.triangulate());
  assert.deepEqual(solid.annotate().triangulate(), cached);
});

test('palette has sixteen immutable distinct colors and accepts names or hex strings only', () => {
  assert.equal(Object.keys(colors).length, 16);
  assert.equal(new Set(Object.values(colors)).size, 16);
  assert.equal(colors.default, '#d2a568');
  assert.ok(Object.isFrozen(colors));
  assert.throws(() => { colors.default = '#000000'; }, TypeError);
  for (const [name, hex] of Object.entries(colors)) {
    assert.match(hex, /^#[\da-f]{6}$/);
    const group = annotatedNode({ color: name });
    assert.equal(group.color, hex);
    assert.equal(annotatedNode({ color: hex }).color, hex);
    group.color = 'blue'; assert.equal(group.color, colors.blue);
    group.color = '#aBc'; assert.equal(group.color, '#aBc');
    group.color = '#aBcDeF'; assert.equal(group.color, '#aBcDeF');
  }
});

test('only successful unnamed constructions increment the hidden name counter', () => {
  const first = annotatedNode(), number = Number(first.name.slice(4));
  annotatedNode({ name: 'Custom' }); annotatedNode({ name: '' });
  assert.throws(() => annotatedNode({ color: 'not-a-color' }));
  assert.equal(new AnnotatedNode().name, `mesh${number + 1}`);
  const solid = new Solid({ surfaces: [] });
  assert.equal(annotate({ solid }).name, `mesh${number + 2}`);
  assert.equal(solid.annotate().name, `mesh${number + 3}`);
  assert.equal(first.name, `mesh${number}`);
});

test('invalid annotation options and color assignments throw instead of reaching the renderer', () => {
  for (const alpha of [-0.1, 1.1, NaN, Infinity, '0.5', null]) assert.throws(() => annotatedNode({ alpha }), RangeError);
  for (const color of ['', '  ', 'rebeccapurple', 'rgb(255,0,0)', 'hsl(0,100%,50%)', 'transparent', 'Blue', '#', '#12', '#1234', '#12345', '#1234567', '#12345678', '#ggg', 'toString', '__proto__']) {
    assert.throws(() => annotatedNode({ color }), RangeError);
    const group = annotatedNode();
    assert.throws(() => { group.color = color; }, RangeError);
    assert.equal(group.color, colors.default);
  }
  for (const color of [null, {}, [1, 0, 0], -1, 0x1188cc, 0.5, NaN, Infinity]) assert.throws(() => annotatedNode({ color }), TypeError);
  assert.throws(() => annotatedNode({ name: 42 }), TypeError);
  for (const solid of [{}, new Node(), new Memo(), null]) assert.throws(() => annotate({ solid }), /requires a Solid/);
  assert.ok(annotate({ solid: new Solid({ surfaces: [] }) }) instanceof AnnotatedNode);
});
