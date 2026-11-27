import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Surface, SurfaceRegion, XY, YZ, ZX, Z, center, displacementArray, node, rectangle,
  roundPolyline, setTriangulationResolution, sketch, union } from 'libcompass';
import { BooleanMesh } from '../dist/internal/booleanMesh.js';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const volume = positions => {
  let result = 0;
  for (let i = 0; i < positions.length; i += 9) result += vec3.dot(positions.subarray(i, i + 3),
    vec3.cross([0, 0, 0], positions.subarray(i + 3, i + 6), positions.subarray(i + 6, i + 9))) / 6;
  return result;
};

test('consecutive transverse wall cuts ignore discarded tool charts and preserve earlier holes in either order', () => {
  setTriangulationResolution(0.1);
  try {
    const width = 160, height = 80, wallThickness = 2, radius = 8;
    const cutter = sketch(ZX.displace([0, -width, 0])).add(rectangle({
      center: { x: height / 2, y: 0 }, width, height: width - wallThickness * 8,
    })).extrude(width);
    const walls = sketch(XY.displace([0, 0, wallThickness])).add(
      roundPolyline({ segments: rectangle({ center, width, height: width }), radius: wallThickness * 4 }),
      roundPolyline({ segments: rectangle({ center, width: width - wallThickness * 2, height: width - wallThickness * 2 }), radius: wallThickness * 3 }),
    ).extrude(height - wallThickness / 2)
      .chamfer({ length: wallThickness / 3, boundaries: ({ face }) => face?.plane?.normal?.[2] === 1 })
      .difference(cutter);
    const firstTool = displacementArray({
      object: sketch(YZ.displace([-width, -height / 2, height / 2])).add(roundPolyline({
        segments: rectangle({ center, width: height / 3, height: height / 3, rotation: 45 }), radius,
      })).extrude(width * 2), N: 3, offset: height / 2, vector: [0, 1, 0],
    }).reduce((solid, tool) => union({ solid, tool }));
    const secondTool = firstTool.rotate({ axis: Z, angle: -90 });
    const child = node(); walls.add(child);
    const source = walls.triangulate(), snapshot = source.slice();
    const toolCaches = [firstTool.triangulate(), secondTool.triangulate()];
    const first = walls.difference(firstTool), other = walls.difference(secondTool);
    const expected = volume(first.triangulate()) + volume(other.triangulate()) - volume(source);
    const firstCache = first.triangulate(), otherCache = other.triangulate();
    const results = [first.difference(secondTool), other.difference(firstTool)];
    for (const result of results) {
      const positions = Surface.triangulateAll(result.surfaces);
      validateSweepMesh(positions);
      assert.ok(Math.abs(volume(positions) - expected) < 2);
      for (const boundary of result.boundaries) assert.equal(result.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
      const mesh = new BooleanMesh(positions);
      for (const x of [-79, 79]) for (const y of [-40, 0, 40]) assert.equal(mesh.contains([x, y, 40]), false);
      for (const x of [-40, 0, 40]) assert.equal(mesh.contains([x, 79, 40]), false);
      for (const position of [[79, 0, 10], [-79, 0, 10], [65, 79, 40]]) assert.equal(mesh.contains(position), true);
      assert.equal(result.children[0], child); assert.notEqual(result.children, walls.children);
      assert.ok(result.surfaces.some(surface => surface instanceof SurfaceRegion));
    }
    assert.equal(walls.triangulate(), source); assert.deepEqual(source, snapshot);
    assert.equal(first.triangulate(), firstCache); assert.equal(other.triangulate(), otherCache);
    assert.equal(firstTool.triangulate(), toolCaches[0]); assert.equal(secondTool.triangulate(), toolCaches[1]);
  } finally { setTriangulationResolution(0.0128); }
});
