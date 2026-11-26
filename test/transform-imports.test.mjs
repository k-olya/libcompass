import assert from 'node:assert/strict';
import { test } from 'node:test';

test('transform methods work when classes are imported directly, without the root module', async () => {
  const { Surface } = await import('../dist/Surface.js');
  const { Plane } = await import('../dist/Plane.js');
  const { SpatialLine } = await import('../dist/SpatialLine.js');
  const axis = new SpatialLine({ direction: [0, 0, 1] });
  const source = new Plane({ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] });
  const moved = source.rotate({ axis, angle: 90 }).displace({ vector: [1, 2, 3] });
  assert.ok(moved instanceof Plane);
  assert.deepEqual(moved.origin, [1, 2, 3]);
  assert.deepEqual(source.origin, [0, 0, 0]);
  assert.equal(typeof Surface.prototype.rotate, 'function');
  const { Solid } = await import('../dist/Solid.js');
  const solid = new Solid({ surfaces: [] });
  const copy = solid.rotate({ axis, angle: 30 }).displace({ vector: [1, 2, 3] });
  assert.ok(copy instanceof Solid);
  assert.notEqual(copy, solid);
  assert.ok(solid.mirror(source) instanceof Solid);
});
