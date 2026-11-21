import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Circle, Plane, Sketch, SpatialLine, X, Y, Z, XY, ZX, YZ } from 'libcompass';
import { X as directX } from 'libcompass/defaults/axes';
import { ZX as directZX } from 'libcompass/defaults/planes';

test('default axes are zero-origin unit spatial lines usable by gl-matrix', () => {
  assert.deepEqual(Array.from(X), [1, 0, 0]);
  assert.deepEqual(Array.from(Y), [0, 1, 0]);
  assert.deepEqual(Array.from(Z), [0, 0, 1]);
  for (const axis of [X, Y, Z]) {
    assert.ok(axis instanceof SpatialLine);
    assert.deepEqual(axis.origin, [0, 0, 0]);
  }
  assert.equal(directX, X);
  assert.deepEqual(vec3.cross([0, 0, 0], X, Y), Array.from(Z));
  assert.deepEqual(vec3.scale([0, 0, 0], Z, 4), [0, 0, 4]);
});

test('default planes honor their named local axes and work as sketch planes', () => {
  assert.equal(directZX, ZX);
  for (const [plane, x, y, direction, position] of [
    [XY, X, Y, Z, [2, 3, 0]],
    [ZX, Z, X, Y, [3, 0, 2]],
    [YZ, Y, Z, X, [0, 2, 3]],
  ]) {
    assert.ok(plane instanceof Plane);
    assert.deepEqual(plane.origin, [0, 0, 0]);
    assert.ok(vec3.exactEquals(plane.xAxis, x));
    assert.ok(vec3.exactEquals(plane.yAxis, y));
    assert.ok(vec3.exactEquals(plane.normal, vec3.cross([0, 0, 0], x, y)));
    assert.ok(vec3.exactEquals(plane.normal, direction));
    assert.deepEqual(plane.toWorld({ x: 2, y: 3 }).position, position);
    assert.deepEqual(plane.toLocal(position), { x: 2, y: 3 });
    const sketch = new Sketch({ plane }).add(new Circle({ center: { x: 0, y: 0 }, radius: 1 }));
    const body = sketch.extrude({ length: 1 });
    assert.equal(body.surfaces.length, 3);
    assert.ok(body.triangulate().length > 0);
  }
});
