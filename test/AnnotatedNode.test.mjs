import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AnnotatedNode, Memo, Node, Solid, Transform, TransformMat4, XY, Z, annotate, annotatedNode, center, circle, colors, rectangle, sketch, spatialCurve } from 'libcompass';
import { AnnotatedNode as DirectAnnotatedNode } from 'libcompass/AnnotatedNode';
import { annotate as directAnnotate } from 'libcompass/operations/annotate';

test('annotations retain line-preview geometry without adding triangles or changing source caches', () => {
  const geometry = [XY, Z, sketch().add(circle(2)), rectangle({ center, width: 4, height: 2 }), center,
    spatialCurve(t => ({ position: [t, t * t, 1] }))];
  for (const wrapper of [annotate({ geometry }), annotatedNode({ geometry }), new AnnotatedNode({ geometry })]) {
    assert.equal(wrapper.geometry, geometry);
    assert.deepEqual(wrapper.children, []);
    assert.equal(wrapper.triangulate().length, 0);
  }
  const source = sketch().add(circle(2)).extrude(3), cached = source.triangulate();
  for (const wrapper of [annotate({ node: source, geometry }), source.annotate({ geometry })]) {
    assert.equal(wrapper.geometry, geometry);
    assert.equal(wrapper.children[0], source);
    assert.deepEqual(wrapper.triangulate(), cached);
  }
  assert.equal(source.triangulate(), cached);
});

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
  const group = annotate({ node: solid, name: 'Part', color: '#1188cc', alpha: 0 });
  assert.ok(group instanceof AnnotatedNode);
  assert.deepEqual(group.children, [solid]);
  assert.deepEqual([group.name, group.color, group.alpha], ['Part', '#1188cc', 0]);
  assert.deepEqual(group.triangulate(), bytes, 'Even zero-alpha annotations keep export geometry');
  assert.equal(solid.triangulate(), cached);
  assert.equal(solid.surfaces, surfaces); assert.equal(solid.boundaries, boundaries);
  assert.deepEqual(solid.children, [child]);
  assert.notEqual(annotate({ node: solid }), annotate({ node: solid }));
  const method = solid.annotate({ name: 'Part', color: '#1188cc', alpha: 0 });
  assert.ok(method instanceof AnnotatedNode);
  assert.deepEqual([method.name, method.color, method.alpha], ['Part', '#1188cc', 0]);
  assert.deepEqual(method.children, [solid]);
  assert.deepEqual(method.triangulate(), group.triangulate());
  assert.deepEqual(solid.annotate().triangulate(), cached);
});

test('any node can be annotated, preserving grouped, transformed and nested geometry', () => {
  class Triangle extends Memo {
    triangulateUncached() { return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); }
  }
  const triangle = new Triangle(), inner = triangle.annotate({ name: 'Inner', color: 'blue' });
  const group = new Node().add(triangle, inner);
  const moved = new Transform().add(group);
  moved.position.x = 5;
  const matrix = new TransformMat4({ matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 2, 0, 1] }).add(moved);
  for (const source of [new Node(), new Memo(), triangle, group, moved, matrix, inner]) {
    const cached = source.triangulate(), bytes = cached.slice(), children = [...source.children];
    for (const wrapper of [annotate(source), annotate({ node: source, name: 'Outer', color: 'red' }), source.annotate()]) {
      assert.ok(wrapper instanceof AnnotatedNode);
      assert.deepEqual(wrapper.children, [source]);
      assert.deepEqual(wrapper.triangulate(), bytes);
      assert.equal(wrapper.triangulate(), wrapper.triangulate());
    }
    assert.deepEqual(source.children, children);
    assert.deepEqual(source.triangulate(), bytes);
    if (source instanceof Memo) assert.equal(source.triangulate(), cached);
  }
  assert.deepEqual(Array.from(matrix.annotate().triangulate().slice(0, 9)), [5, 2, 0, 6, 2, 0, 5, 3, 0]);
  assert.equal(inner.children[0], triangle);
  assert.equal(group.children[1], inner);
  assert.equal(inner.name, 'Inner');
  assert.equal(inner.color, colors.blue);
});

test('export exclusion defaults to false and does not alter triangulation or caches', () => {
  const source = sketch().add(circle(2)).extrude(3), cached = source.triangulate();
  assert.equal(annotatedNode().exclude, false);
  assert.equal(annotate(source).exclude, false);
  for (const wrapper of [annotate({ node: source, exclude: true }), source.annotate({ exclude: true }),
    annotatedNode({ exclude: true }).add(source), new AnnotatedNode({ exclude: true }).add(source)]) {
    assert.equal(wrapper.exclude, true);
    assert.deepEqual(wrapper.children, [source]);
    const positions = wrapper.triangulate();
    assert.deepEqual(positions, cached);
    wrapper.exclude = false;
    assert.equal(wrapper.triangulate(), positions);
  }
  assert.equal(source.triangulate(), cached);
  for (const exclude of [null, 0, 1, 'true', {}, []]) {
    assert.throws(() => annotatedNode({ exclude }), TypeError);
    assert.throws(() => annotate({ node: source, exclude }), TypeError);
  }
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
  assert.equal(annotate({ node: solid }).name, `mesh${number + 2}`);
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
  for (const invalid of [{}, null, undefined, [], 1, 'node']) {
    assert.throws(() => annotate(invalid), /requires a Node/);
    assert.throws(() => annotate({ node: invalid }), /requires a Node/);
    assert.throws(() => annotate({ solid: invalid }), /requires a Node/);
  }
  assert.throws(() => annotate({ node: null, solid: new Node() }), /requires a Node/);
  assert.throws(() => annotate({ solid: new Solid({ surfaces: [] }) }), /requires a Node/);
  assert.ok(annotate({ node: new Solid({ surfaces: [] }) }) instanceof AnnotatedNode);
});
