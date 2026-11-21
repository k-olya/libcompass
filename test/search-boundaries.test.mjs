import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Face, Solid, center, centerRectangle, chamfer, circle, edge, node, round, searchBoundaries, sketch } from 'libcompass';
import { searchBoundaries as directSearch } from 'libcompass/operations/searchBoundaries';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const cube = () => sketch().add(centerRectangle({ center, corner: { x: 2, y: 2 } })).extrude({ length: 4 });
const cylinder = () => sketch().add(circle({ center, radius: 2 })).extrude({ length: 4 });

test('mixed selectors expand original faces and boundaries in first-match order without duplicates', () => {
  assert.equal(searchBoundaries, directSearch);
  const solid = cube(), face = solid.surfaces[0], last = solid.boundaries.at(-1);
  const list = Object.freeze([solid.boundaries.length - 1, face, 0, solid.boundaries[0], face, ({ boundary }) => face.boundaries.includes(boundary)]);
  const result = searchBoundaries({ solid, boundaries: list });
  assert.deepEqual(result, [last, ...face.boundaries]);
  assert.equal(new Set(result).size, result.length);
  assert.deepEqual(searchBoundaries({ solid }), solid.boundaries);
  assert.notEqual(searchBoundaries({ solid }), solid.boundaries);
  assert.deepEqual(searchBoundaries({ solid, boundaries: [] }), solid.boundaries);
  assert.deepEqual(searchBoundaries({ solid, boundaries: [() => false] }), []);
});

test('face selectors include hole boundaries and predicates test every adjoining planar face', () => {
  const solid = sketch().add(circle({ center, radius: 3 }), circle({ center, radius: 1 })).extrude({ length: 3 });
  const cap = solid.surfaces[0];
  assert.ok(cap instanceof Face);
  assert.equal(cap.holes.length, 1);
  assert.deepEqual(searchBoundaries({ solid, boundaries: [cap] }), [...cap.outer, ...cap.holes.flat()]);
  const calls = [];
  assert.deepEqual(searchBoundaries({ solid, boundaries: [({ solid: input, face, boundary }) => {
    assert.equal(input, solid); assert.ok(face instanceof Face);
    assert.ok(face.boundaries.includes(boundary));
    calls.push(boundary);
    return face === cap;
  }] }), cap.boundaries);
  assert.equal(calls.length, solid.boundaries.length, 'Curved walls do not add planar face calls');

  const box = cube(), target = box.surfaces[1], contexts = [];
  const result = searchBoundaries({ solid: box, boundaries: [() => true, ({ solid, face, boundary }) => {
    contexts.push({ solid, face, boundary });
    return face === target;
  }] });
  assert.deepEqual(result, box.boundaries);
  assert.equal(contexts.length, 2 * box.boundaries.length, 'Predicates still run on already-selected boundaries and test both planar faces');
  for (const boundary of box.boundaries) {
    assert.deepEqual(contexts.filter(context => context.boundary === boundary).map(context => context.face),
      box.surfaces.filter(face => face.boundaries.includes(boundary)));
  }
  assert.deepEqual(searchBoundaries({ solid: box, boundaries: [({ face }) => face === target] }), target.boundaries);
});

test('boundaries adjoining only curved surfaces receive face: undefined once', () => {
  const sphere = cylinder().round({ radius: 2 }), calls = [];
  assert.ok(sphere.boundaries.length > 0);
  assert.ok(sphere.surfaces.every(surface => !(surface instanceof Face)));
  const matches = searchBoundaries({ solid: sphere, boundaries: [context => {
    calls.push(context);
    return context.face === undefined;
  }] });
  assert.deepEqual(matches, sphere.boundaries);
  assert.equal(calls.length, sphere.boundaries.length);
  assert.ok(calls.every(context => context.solid === sphere && context.face === undefined && 'face' in context));
});

test('chamfer and round operation/method forms resolve mixed selectors exactly as original indices', () => {
  const solid = cylinder(), cap = solid.surfaces[0], boundary = cap.outer[0];
  const index = solid.boundaries.indexOf(boundary);
  for (const operation of [chamfer, round]) {
    const name = operation === chamfer ? 'chamfer' : 'round';
    const expected = operation({ solid, boundaries: [index] }).triangulate();
    for (const boundaries of [index, boundary, cap, ({ face }) => face === cap, [boundary], [cap], [index, boundary, cap, ({ face }) => face === cap]]) {
      const result = operation({ solid, boundaries });
      assert.deepEqual(result.triangulate(), expected);
      assert.deepEqual(solid[name]({ boundaries }).triangulate(), expected);
      validateSweepMesh(result.triangulate());
    }
  }
});

test('an unmatched nonempty selector is a nonmutating no-op, never a request to affect all boundaries', () => {
  const solid = cube(), child = node(); solid.add(child);
  const cached = solid.triangulate(), before = cached.slice();
  for (const operation of [chamfer, round]) {
    const copy = operation({ solid, boundaries: () => false });
    assert.notEqual(copy, solid);
    assert.deepEqual(copy.surfaces, solid.surfaces);
    assert.deepEqual(copy.children, [child]); assert.notEqual(copy.children, solid.children);
    assert.deepEqual(copy.triangulate(), before);
    assert.equal(solid.triangulate(), cached);
  }
  const empty = new Solid({ surfaces: [] });
  let called = false;
  assert.deepEqual(searchBoundaries({ solid: empty, boundaries: [() => { called = true; return true; }] }), []);
  assert.equal(called, false);
});

test('single indices, boundaries, faces and predicates resolve identically to one-element lists', () => {
  const solid = cube();
  for (const selector of [0, solid.boundaries.at(-1), solid.surfaces[0], ({ boundary }) => boundary.start.position[2] === 0, () => false]) {
    assert.deepEqual(searchBoundaries({ solid, boundaries: selector }), searchBoundaries({ solid, boundaries: [selector] }));
  }
});

test('invalid indices, foreign topology, malformed selectors and predicate errors are explicit', () => {
  const solid = cube(), foreign = cube();
  const boundaryCopy = edge({ start: solid.boundaries[0].start, end: solid.boundaries[0].end });
  for (const boundaries of [null, {}, [-1], [12], [0.5], [NaN], [Infinity], [undefined], [null], [{}], ['0'], [foreign.boundaries[0]], [foreign.surfaces[0]], [boundaryCopy]]) {
    assert.throws(() => searchBoundaries({ solid, boundaries }), RangeError);
    for (const operation of [chamfer, round]) assert.throws(() => operation({ solid, boundaries }), RangeError);
  }
  assert.throws(() => searchBoundaries({ solid: {} }), TypeError);
  for (const value of [undefined, 1, 'true', Promise.resolve(true)]) {
    assert.throws(() => searchBoundaries({ solid, boundaries: [() => value] }), /must return a boolean/);
  }
  const failure = new Error('selector failed');
  assert.throws(() => searchBoundaries({ solid, boundaries: [() => { throw failure; }] }), error => error === failure);
  const withChildren = cube().add(foreign);
  assert.throws(() => searchBoundaries({ solid: withChildren, boundaries: [foreign.surfaces[0]] }), /belong/);
});
