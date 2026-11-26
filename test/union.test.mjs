import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Edge, Face, Solid, SpatialCurve, SpatialSurface, SurfaceRegion, X, Z, arc, circle, lineSegment, node,
  rectangle, setTriangulationResolution, sketch, union } from 'libcompass';
import { union as directUnion } from 'libcompass/operations/union';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

setTriangulationResolution(0.01);
const box = (min = [0, 0, 0], max = [10, 10, 10]) => sketch().add(rectangle({
  corner1: { x: min[0], y: min[1] }, corner2: { x: max[0], y: max[1] },
})).extrude(max[2] - min[2]).displace([0, 0, min[2]]);
const cylinder = (x = 0, z = 0, height = 4, radius = 2) => sketch().add(circle(radius)).extrude(height).displace([x, 0, z]);
function volume(result, expected, tolerance = 1e-5) {
  const mesh = result.triangulate();
  if (mesh.length) validateSweepMesh(mesh);
  for (const boundary of result.boundaries) {
    assert.equal(result.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  }
  let sum = 0;
  for (let i = 0; i < mesh.length; i += 9) sum += vec3.dot(mesh.subarray(i, i + 3),
    vec3.cross([0, 0, 0], mesh.subarray(i + 3, i + 6), mesh.subarray(i + 6, i + 9))) / 6;
  if (expected !== undefined) assert.ok(Math.abs(sum - expected) <= tolerance, `${sum} != ${expected}`);
  return sum;
}

test('union operation and both Solid method forms preserve inputs, children and memo caches', () => {
  assert.equal(directUnion, union);
  const a = box(), b = box([5, 5, 5], [15, 15, 15]);
  const child = node(), ignored = box([-100, -100, -100], [-99, -99, -99]);
  a.add(child); b.add(ignored);
  const cachedA = a.triangulate(), cachedB = b.triangulate(), bytesA = cachedA.slice(), bytesB = cachedB.slice();
  const surfaces = [...a.surfaces], boundaries = [...a.boundaries], coordinates = a.vertices.map(vertex => [...vertex.position]);
  for (const result of [union({ solid: a, tool: b }), a.union({ tool: b }), a.union(b), b.union(a)]) {
    volume(new Solid(result.surfaces), 1875);
    assert.ok(result.surfaces.every(surface => surface instanceof Face));
  }
  const result = a.union(b);
  assert.deepEqual(result.children, [child]); assert.notEqual(result.children, a.children);
  assert.equal(a.triangulate(), cachedA); assert.equal(b.triangulate(), cachedB);
  assert.deepEqual(cachedA, bytesA); assert.deepEqual(cachedB, bytesB);
  assert.deepEqual(a.surfaces, surfaces); assert.deepEqual(a.boundaries, boundaries);
  assert.deepEqual(a.vertices.map(vertex => [...vertex.position]), coordinates);
});

test('coplanar overlap, complete and partial face contact eliminate internal faces and collinear subdivisions', () => {
  for (const x of [5, 10]) {
    const result = box().union(box([x, 0, 0], [x + 10, 10, 10]));
    volume(result, (10 + x) * 100);
    assert.equal(result.surfaces.length, 6);
    assert.equal(result.boundaries.length, 12);
    assert.equal(result.vertices.length, 8);
    assert.ok(result.boundaries.every(boundary => boundary instanceof Edge));
    volume(result.chamfer({ length: 0.2 }));
  }
  const partial = box().union(box([10, 3, 0], [20, 13, 10]));
  volume(partial, 2000);
  assert.equal(partial.surfaces.length, 10); assert.equal(partial.boundaries.length, 24);
});

test('empty, identical and contained solids obey regularized union identities', () => {
  const a = box(), empty = new Solid([]);
  for (const result of [a.union(empty), empty.union(a), a.union(a), a.union(box()), a.union(box([2, 2, 2], [4, 4, 4]))]) {
    volume(result, 1000);
    assert.equal(result.surfaces.length, 6); assert.equal(result.boundaries.length, 12);
  }
  volume(empty.union(empty), 0);
  assert.equal(empty.union(empty).surfaces.length, 0);
  const outer = box([-3, -3, 0], [3, 3, 4]), plug = cylinder();
  const filled = outer.difference(plug).union(plug);
  volume(filled, 144);
  assert.equal(filled.surfaces.length, 6); assert.equal(filled.boundaries.length, 12);
});

test('disconnected components, including multipart extrusions, behave as one solid in later operations', () => {
  const multipart = sketch().add(rectangle({ corner1: { x: 0, y: 0 }, corner2: { x: 2, y: 2 } }),
    rectangle({ corner1: { x: 4, y: 0 }, corner2: { x: 6, y: 2 } })).extrude(2);
  const assembly = multipart.union(box([8, 0, 0], [10, 2, 2]));
  volume(assembly, 24); assert.equal(assembly.surfaces.length, 18);
  const bridged = assembly.union(box([2, 0, 0], [4, 2, 2]));
  volume(bridged, 32); assert.equal(bridged.surfaces.length, 12);
  volume(bridged.difference(box([1, -1, -1], [5, 3, 3])), 16);
  volume(bridged.intersect(box([1, -1, -1], [9, 3, 3])), 24);
  const transformed = bridged.rotate({ axis: Z, angle: 27 }).displace([3, -2, 5]);
  volume(transformed, 32, 1e-4);
});

test('curved unions carve shared exact intersection rims and remain usable in further booleans', () => {
  const a = cylinder(), b = cylinder(2), result = a.union(b);
  const lens = 8 * Math.PI / 3 - 2 * Math.sqrt(3);
  volume(result, 32 * Math.PI - 4 * lens, 0.3);
  assert.ok(result.surfaces.some(surface => surface instanceof SurfaceRegion));
  assert.ok(result.boundaries.some(boundary => boundary instanceof SpatialCurve));
  assert.equal(result.surfaces.filter(surface => surface instanceof Face).length, 2, 'Coplanar cap patches are united');
  const tool = box([-1, -3, -1], [1, 3, 5]);
  const cut = result.difference(tool), common = result.intersect(tool);
  assert.ok(Math.abs(volume(cut) + volume(common) - volume(result)) < 0.3);
  volume(result.union(cylinder(1, 1, 2, 0.3)), volume(result), 0.3);
});

test('stacked and overlapping coaxial walls unite tangent surfaces without a physical seam', () => {
  for (const z of [2, 4]) {
    const result = cylinder().union(cylinder(0, z));
    volume(result, volume(cylinder()) * (4 + z) / 4, 0.1);
    assert.equal(result.surfaces.length, 3); assert.equal(result.boundaries.length, 2);
    assert.ok(result.boundaries.every(boundary => boundary.isLoop()));
    assert.ok(volume(result.round(0.5)) < volume(result));
    volume(result.difference(box([1, -3, -1], [3, 3, 9])));
  }
});

test('complementary curved halves unite tangent arcs at their two shared endpoints, retaining sample overrides', () => {
  const halves = [1, -1].map(side => {
    const curve = arc({ start: { x: 0, y: side * 2 }, end: { x: 0, y: -side * 2 }, center: { x: 0, y: 0 } });
    const parameters = [...new Set([...Array.from({ length: 65 }, (_, i) => (i / 64) ** 1.3), 0.137])].sort((a, b) => a - b);
    curve.sample = () => parameters.map(t => curve.at(t));
    return { curve, solid: sketch().add(curve, lineSegment({ start: curve.end, end: curve.start })).extrude(4) };
  });
  const result = halves[0].solid.union(halves[1].solid);
  volume(result, 16 * Math.PI, 0.3);
  assert.equal(result.surfaces.length, 3); assert.equal(result.boundaries.length, 2);
  assert.ok(result.boundaries.every(boundary => boundary instanceof SpatialCurve && boundary.isLoop()));
  const original = halves[0].curve.at(0.137);
  assert.ok(result.boundaries.some(boundary => boundary.sample().some(vertex => vec3.distance(vertex.position, [original.x, original.y, 0]) < 1e-9)));
  volume(result.round(0.2));
});

test('point-only, edge-only and tangent-line contact reject nonmanifold unions', () => {
  const a = box(), cached = a.triangulate();
  for (const b of [box([10, 10, 0], [20, 20, 10]), box([10, 10, 10], [20, 20, 20])]) assert.throws(() => a.union(b), RangeError);
  assert.throws(() => cylinder().union(cylinder(4)), RangeError);
  assert.equal(a.triangulate(), cached);
  assert.throws(() => union({ solid: a, tool: {} }), TypeError);
  assert.throws(() => a.union(new Solid([a.surfaces[0]])), /closed/);
});

test('partially overlapping curved segments unite into one smooth exterior wall', () => {
  const curve = arc({ center: { x: 0, y: 0 }, start: { x: 0, y: 2 }, end: { x: 0, y: -2 } });
  const half = sketch().add(curve, lineSegment({ start: curve.end, end: curve.start })).extrude(4);
  for (const angleDEG of [45, 90]) {
    const result = half.union(half.rotate({ axis: Z, angle: angleDEG }));
    volume(result, 16 * Math.PI * (0.5 + angleDEG / 360), 0.3);
    assert.equal(result.surfaces.length, 5);
    assert.equal(result.boundaries.length, 9);
    assert.equal(result.surfaces.filter(surface => !(surface instanceof Face)).length, 1);
  }
});

test('transverse curved unions preserve regular parametric surface intersection rims', () => {
  const a = cylinder(), b = cylinder(0, 0, 4, 1.3).rotate({ axis: X, angle: 90 }).displace([0, 2, 2]);
  const result = a.union(b), common = a.intersect(b);
  assert.ok(result.surfaces.some(surface => surface instanceof SurfaceRegion));
  assert.ok(Math.abs(volume(result) + volume(common) - volume(a) - volume(b)) < 0.3);
});

test('sphere–box unions retain regular trims at collapsed poles and tangent edge contacts', () => {
  const cube = box([-5, -5, -5], [5, 5, 5]);
  // The app's sphere primitive rounds a centered cylinder to its radius limit.
  const sphere = cylinder(0, -5, 10, 5).round(5);
  const cached = sphere.triangulate(), bytes = cached.slice(), surfaces = [...sphere.surfaces];
  for (const offset of [4, 5, 6, 8]) {
    const moved = sphere.displace([offset, 0, 0]);
    const expected = 1000 + Math.PI * offset ** 2 * (5 - offset / 3);
    for (const [a, b] of [[moved, cube], [cube, moved]]) {
      const result = a.union(b);
      volume(result, expected, 3);
      for (const boundary of result.boundaries) {
        const samples = boundary instanceof SpatialCurve ? boundary.sampleWithParameters() : [];
        assert.ok(samples.every(({ t }, i) => !i || t > samples[i - 1].t));
      }
      if (offset === 5) {
        const corners = result.surfaces.filter(surface => surface instanceof Face && surface.plane.normal[0] > 0.99);
        assert.equal(corners.length, 4, 'The inscribed cut leaves four separate planar corner faces');
      }
    }
  }
  assert.equal(sphere.triangulate(), cached);
  assert.deepEqual(cached, bytes);
  assert.deepEqual(sphere.surfaces, surfaces);
});
