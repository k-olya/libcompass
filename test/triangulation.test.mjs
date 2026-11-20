import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TRIANGULATION_RESOLUTION, setTriangulationResolution, circle, sketch, SpatialCurve, extrudeAlongCurve } from 'libcompass';

test('resolution defaults to 0.1 and changing it updates sampling on retained curves', () => {
  assert.equal(TRIANGULATION_RESOLUTION, 0.1);
  const curve = circle({ center: { x: 0, y: 0 }, radius: 1 });
  const original = curve.sample();
  try {
    setTriangulationResolution(0.001);
    assert.equal(TRIANGULATION_RESOLUTION, 0.001);
    assert.ok(curve.sample().length > original.length);
    setTriangulationResolution(1);
    assert.equal(TRIANGULATION_RESOLUTION, 1);
    assert.equal(curve.sample().length, 5); // Four segments keep the loop nondegenerate.
    for (const resolution of [0, 0.0009, 1.001, -1, NaN, Infinity, -Infinity]) {
      assert.throws(() => setTriangulationResolution(resolution), RangeError);
      assert.equal(TRIANGULATION_RESOLUTION, 1);
    }
    setTriangulationResolution(0.1);
    assert.deepEqual(curve.sample(), original);
  } finally { setTriangulationResolution(0.1); }
});

test('the torus remains valid across the full resolution range with more triangles at finer settings', () => {
  const counts = [];
  try {
    for (const resolution of [1, 0.1, 0.001]) {
      setTriangulationResolution(resolution);
      const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 1 }));
      const curve = SpatialCurve.fromPlanarCurve({ curve: circle({ center: { x: 0, y: 0 }, radius: 8 }) });
      const solid = extrudeAlongCurve({ sketch: s, curve });
      assert.equal(solid.surfaces.length, 1);
      assert.equal(solid.boundaries.length, 0);
      counts.push(solid.triangulate().length / 9);
    }
    assert.ok(counts[0] < counts[1] && counts[1] < counts[2]);
  } finally { setTriangulationResolution(0.1); }
});
