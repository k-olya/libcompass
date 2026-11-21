import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { circle, centerRectangle, extrude, extrudeCut, lineSegment, plane, sketch, solid, spatialSurface,
  SurfaceRegion, ZX, setTriangulationResolution } from 'libcompass';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';
import { BooleanMesh } from '../dist/internal/booleanMesh.js';

setTriangulationResolution(0.025);
const close = (actual, expected, tolerance) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
function volume(body) {
  const mesh = body.triangulate();
  validateSweepMesh(mesh);
  for (const boundary of body.boundaries) assert.equal(body.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  let sum = 0;
  for (let i = 0; i < mesh.length; i += 9) sum += vec3.dot(mesh.subarray(i, i + 3), vec3.cross([0, 0, 0], mesh.subarray(i + 3, i + 6), mesh.subarray(i + 6, i + 9))) / 6;
  return sum;
}
const cylinder = (x = 0, z = 0, length = 5, radius = 2) => extrude({ sketch: sketch({ plane: plane({ a: [0, 0, z], b: [1, 0, z], c: [0, 1, z] }) })
  .add(circle({ center: { x, y: 0 }, radius })), length });
const box = (min, max) => {
  const points = [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]].map(([x, y]) => ({ x, y }));
  return extrude({ sketch: sketch({ plane: plane({ a: [0, 0, min[2]], b: [1, 0, min[2]], c: [0, 1, min[2]] }) })
    .add(...points.map((start, i) => lineSegment({ start, end: points[(i + 1) % 4] }))), length: max[2] - min[2] });
};
const torus = () => solid({ surfaces: [spatialSurface({ periodicU: true, periodicV: true,
  at: (u, v) => ({ position: [(3 + Math.cos(2 * Math.PI * v)) * Math.cos(2 * Math.PI * u),
    (3 + Math.cos(2 * Math.PI * v)) * Math.sin(2 * Math.PI * u), Math.sin(2 * Math.PI * v)] }) })] });

test('curved/curved booleans retain source equations, shared cuts and input caches', () => {
  const a = cylinder(), b = cylinder(2), cached = a.triangulate(), bytes = cached.slice();
  const common = a.intersect({ tool: b }), cut = a.difference({ tool: b });
  const expected = 5 * (8 * Math.acos(0.5) - Math.sqrt(12));
  close(volume(common), expected, 0.3); close(volume(cut), 20 * Math.PI - expected, 0.3);
  assert.ok(common.surfaces.some(surface => surface instanceof SurfaceRegion));
  for (const surface of common.surfaces.filter(surface => surface instanceof SurfaceRegion)) {
    assert.ok([...a.surfaces, ...b.surfaces].includes(surface.surface));
    for (const region of surface.regions) for (const trim of region.outer) for (const t of [trim.start ?? 0, trim.end ?? 1]) {
      const uv = trim.at(t), point = surface.at(uv.x, uv.y).position;
      close(Math.hypot(point[0] - (surface.surface === a.surfaces[2] ? 0 : 2), point[1]), 2, 1e-7);
    }
  }
  assert.equal(a.triangulate(), cached); assert.deepEqual(cached, bytes);
});

test('closed curved intersections create holes, not intermediate mesh faces', () => {
  const a = cylinder(0, -3, 6), s = sketch({ plane: plane({ a: [-3, 0, 0.3], b: [-3, 1, 0.3], c: [-3, 0, 1.3] }) })
    .add(circle({ center: { x: 0, y: 0 }, radius: 1.5 }));
  const b = extrude({ sketch: s, length: 6 });
  const common = a.intersect({ tool: b }), cut = extrudeCut({ solid: a, sketch: s, length: 6 });
  // Simpson integration of the overlapping cylinders' cross-sectional rectangles.
  const steps = 10000, h = 3 / steps;
  let expected = 0;
  for (let i = 0; i <= steps; i++) {
    const y = -1.5 + h * i;
    expected += (i === 0 || i === steps ? 1 : i % 2 ? 4 : 2) * 4 * Math.sqrt(Math.max(0, (4 - y * y) * (2.25 - y * y)));
  }
  expected *= h / 3;
  close(volume(common), expected, 0.4); close(volume(cut), 24 * Math.PI - expected, 0.4);
  assert.equal(common.surfaces.length, 2);
  assert.ok(common.boundaries.every(curve => curve.isLoop()));
  assert.ok(cut.surfaces.some(surface => surface instanceof SurfaceRegion && surface.regions.some(region => region.holes?.length)));
});

test('doubly periodic surfaces support multiple charts, plane and curved cuts', () => {
  const a = torus(), cached = a.triangulate(), b = box([0.4, -5, -2], [5, 5, 2]);
  const common = a.intersect({ tool: b }), cut = a.difference({ tool: b });
  close(volume(common) + volume(cut), volume(a), 0.8);
  assert.ok(common.surfaces.some(surface => surface instanceof SurfaceRegion && surface.regions.length > 1));
  const tool = cylinder(1.5, -2, 4);
  const curvedCommon = a.intersect({ tool }), curvedCut = a.difference({ tool });
  close(volume(curvedCommon) + volume(curvedCut), volume(a), 0.8);
  assert.ok(curvedCut.surfaces.every(surface => surface instanceof SurfaceRegion));
  assert.equal(a.triangulate(), cached);
});

test('trimmed results remain usable in later booleans and coincident walls are regularized', () => {
  const a = cylinder(), first = a.difference({ tool: cylinder(2) });
  const second = first.intersect({ tool: cylinder(-2.2) });
  const expected = 5 * (8 * Math.acos(2.2 / 4) - 1.1 * Math.sqrt(16 - 2.2 ** 2));
  close(volume(second), expected, 0.3);
  close(volume(a.intersect({ tool: cylinder(0, 2) })), 12 * Math.PI, 0.3);
  close(volume(a.difference({ tool: cylinder(0, 2) })), 8 * Math.PI, 0.3);
});

test('unresolved branching intersections throw instead of exposing an invalid partial solid', () => {
  const a = cylinder(0, -3, 6), cached = a.triangulate();
  const b = extrude({ sketch: sketch({ plane: plane({ a: [-3, 0, 0], b: [-3, 1, 0], c: [-3, 0, 1] }) })
    .add(circle({ center: { x: 0, y: 0 }, radius: 2 })), length: 6 });
  assert.throws(() => a.intersect({ tool: b }), /branches|tangen|unresolved/);
  assert.equal(a.triangulate(), cached);
});

test('a radial cut through an annular wall sews periodic chart seams without physical seam edges', () => {
  try {
    for (const resolution of [0.1, 0.01, 0.001]) {
      setTriangulationResolution(resolution);
      const center = { x: 0, y: 0 };
      const base = sketch().add(circle({ center, radius: 6 })).extrude({ length: 2 }).chamfer({ boundaries: [0] });
      const walls = sketch({ plane: base.surfaces[1] }).add(circle({ center, radius: 6 }), circle({ center, radius: 5 })).extrude({ length: 3 });
      const cached = walls.triangulate();
      const cutter = sketch({ plane: ZX }).add(circle({ center: { x: 3.5, y: 0 }, radius: 1 }));
      const cut = walls.extrudeCut({ sketch: cutter, length: 10 });
      const mesh = new BooleanMesh(cut.triangulate());
      const growthLimit = resolution < 0.01 ? 5 : 2; // Float32 sliver repairs cost more at the minimum resolution.
      assert.ok(cut.triangulate().length < growthLimit * cached.length, 'A local hole must not densely remesh the straight wall direction');
      for (const [source, radius] of [[walls.surfaces[2], 6], [walls.surfaces[3], 5]]) {
        const wall = cut.surfaces.find(surface => surface instanceof SurfaceRegion && surface.surface === source);
        assert.ok(wall);
        const positions = wall.triangulate();
        const maximumDeviationRAD = Math.acos(1 - resolution / radius) + 1e-4;
        for (let i = 0; i < positions.length; i += 9) {
          const [a, b, c] = [0, 3, 6].map(offset => positions.subarray(i + offset, i + offset + 3));
          const normal = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], b, a), vec3.subtract([0, 0, 0], c, a)));
          const radial = vec3.normalize([0, 0, 0], [a[0] + b[0] + c[0], a[1] + b[1] + c[1], 0]);
          const deviationRAD = Math.acos(Math.min(1, Math.abs(vec3.dot(normal, radial))));
          assert.ok(deviationRAD <= maximumDeviationRAD, 'Wall triangles must follow the cylinder normals without shading spikes');
          for (const vertex of [a, b, c]) close(Math.hypot(vertex[0], vertex[1]), radius, 1e-6);
        }
      }
      assert.ok(volume(cut) > 0);
      assert.equal(mesh.contains([0, 5.5, 3.5]), false);
      assert.equal(mesh.contains([0, -5.5, 3.5]), true);
      assert.equal(mesh.contains([0, 0, 3.5]), false);
      assert.equal(cut.boundaries.length, 6);
      assert.ok(cut.boundaries.every(boundary => boundary.isLoop()));
      assert.equal(walls.triangulate(), cached);
    }
  } finally { setTriangulationResolution(0.025); }
});

test('drafted rectangular pockets in annular walls retain exact surfaces and sewn seams', () => {
  try {
    for (const resolution of [0.0128, 0.01]) {
      setTriangulationResolution(resolution);
      const center = { x: 0, y: 0 };
      const base = sketch().add(circle({ center, radius: 6 })).extrude({ length: 2 }).chamfer({ boundaries: [0] });
      const walls = sketch({ plane: base.surfaces[1] }).add(circle({ center, radius: 6 }), circle({ center, radius: 5 })).extrude({ length: 3 });
      const cached = walls.triangulate(), bytes = cached.slice();
      const cutter = sketch({ plane: ZX.displace({ vector: [0, 4.8, 0] }) })
        .add(centerRectangle({ center: { x: 3.5, y: 0 }, corner: { x: 2, y: 1 } }));
      for (const angle of [-45, -0.1, 0.1, 45]) {
        const cut = walls.extrudeCut({ sketch: cutter, length: 0.6, angle });
        const mesh = new BooleanMesh(cut.triangulate());
        assert.ok(volume(cut) > 0);
        assert.equal(mesh.contains([0, 5.2, 3.5]), false, 'Pocket material must be removed');
        assert.equal(mesh.contains([0, 5.8, 3.5]), true, 'The blind cut must leave the outer wall');
        assert.equal(mesh.contains([0, -5.5, 3.5]), true, 'The opposite wall must stay intact');
        assert.equal(mesh.contains([0.85, 5.2, 3.5]), angle === -45, 'The pocket must follow the drafted wall');
        for (const [source, radius] of [[walls.surfaces[2], 6], [walls.surfaces[3], 5]]) {
          const wall = cut.surfaces.find(surface => surface instanceof SurfaceRegion && surface.surface === source);
          assert.ok(wall, 'Cylinders must retain their original mathematical evaluators');
          close(Math.hypot(...wall.at(0.37, 0.43).position.slice(0, 2)), radius, 1e-10);
        }
        assert.equal(walls.triangulate(), cached); assert.deepEqual(cached, bytes);
      }
    }
  } finally { setTriangulationResolution(0.025); }
});
