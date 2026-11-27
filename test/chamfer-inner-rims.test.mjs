import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Face, XY, X, center, rectangle, sketch } from 'libcompass';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const volume = solid => {
  const mesh = solid.triangulate(); validateSweepMesh(mesh);
  for (const boundary of solid.boundaries) assert.equal(solid.surfaces.filter(face => face.boundaries.includes(boundary)).length, 2);
  let sum = 0;
  for (let i = 0; i < mesh.length; i += 9) sum += vec3.dot(mesh.subarray(i, i + 3),
    vec3.cross([0, 0, 0], mesh.subarray(i + 3, i + 6), mesh.subarray(i + 6, i + 9))) / 6;
  return sum;
};

test('rectangular inner-rim chamfers support valid lengths and reject overlapping opposing rims', () => {
  const width = 160, wallThickness = 2, tolerance = 0.5;
  const outerWidth = width - wallThickness * 8 - tolerance, outerHeight = width - wallThickness * 3 - tolerance;
  const innerWidth = outerWidth - wallThickness, innerHeight = outerHeight - wallThickness;
  const source = sketch(XY.displace([0, 0, 4])).add(
    rectangle({ center, width: outerWidth, height: outerHeight }),
    rectangle({ center, width: innerWidth, height: innerHeight }),
  ).extrude(64);
  const cached = source.triangulate(), snapshot = cached.slice(), original = volume(source);
  const top = source.surfaces.find(face => face instanceof Face && face.plane.normal[2] === 1);
  const boundaries = ({ face }) => face?.plane?.normal?.[2] === 1;
  for (const length of [0.1, 0.49, 0.5]) {
    const result = source.chamfer({ length, boundaries });
    const removed = length ** 2 * (outerWidth + outerHeight + innerWidth + innerHeight);
    assert.ok(Math.abs(volume(result) - (original - removed)) < 0.02);
    if (length === 0.5) assert.ok(!result.surfaces.includes(top));
    volume(source.round({ radius: length, boundaries }));
  }
  const length = 0.2, inner = source.chamfer({ length, boundaries: top.holes[0] });
  const removed = length ** 2 * (innerWidth + innerHeight) + 4 / 3 * length ** 3;
  assert.ok(Math.abs(volume(inner) - (original - removed)) < 0.02);
  assert.throws(() => source.chamfer({ length: wallThickness / 3, boundaries }), /consumes.*face.*overlap/);
  assert.throws(() => source.round({ radius: wallThickness / 3, boundaries }), /consumes.*face.*overlap/);
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, snapshot);

  // Subtract twice the wall thickness from total dimensions to get that thickness per side.
  for (const [plane, length] of [[XY.displace([0, 0, 4]), 64], [XY.rotate({ axis: X, angle: 31 }).displace([3, 4, 5]), -64]]) {
    const corrected = sketch(plane).add(
      rectangle({ center, width: outerWidth, height: outerHeight }),
      rectangle({ center, width: outerWidth - wallThickness * 2, height: outerHeight - wallThickness * 2 }),
    ).extrude(length);
    for (const operation of ['chamfer', 'round']) {
      const result = corrected[operation]({ length: wallThickness / 3, radius: wallThickness / 3, boundaries: corrected.surfaces[1] });
      assert.ok(volume(result) < volume(corrected));
    }
  }
});
