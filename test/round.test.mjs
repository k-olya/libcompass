import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { round, circle, centerRectangle, Face, node, planarCurve, setTriangulationResolution,
  sketch, Solid, SpatialCurve, SpatialSurface, TrimmedSurface, XY, YZ, ZX } from 'libcompass';
import { round as operationRound } from 'libcompass/operations/round';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

setTriangulationResolution(0.0128);
const center = { x: 0, y: 0 };
const cube = (plane = XY, length = 2) => sketch({ plane }).add(centerRectangle({ center, corner: { x: 1, y: 1 } })).extrude({ length });
const cylinder = (plane = XY, length = 2) => sketch({ plane }).add(circle({ center, radius: 1 })).extrude({ length });
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const vertical = solid => solid.boundaries.map((boundary, i) => [boundary, i])
  .filter(([boundary]) => Math.abs(boundary.start.position[2] - boundary.end.position[2]) > 1).map(([, i]) => i);

function check(solid, expectedVolume, euler = 2) {
  const mesh = solid.triangulate();
  validateSweepMesh(mesh);
  const vertices = new Set(), edges = new Set();
  let volume = 0;
  for (let i = 0; i < mesh.length; i += 9) {
    const points = [0, 3, 6].map(offset => Array.from(mesh.subarray(i + offset, i + offset + 3)));
    volume += vec3.dot(points[0], vec3.cross([0, 0, 0], points[1], points[2])) / 6;
    for (let j = 0; j < 3; j++) {
      vertices.add(points[j].join(','));
      edges.add([points[j].join(','), points[(j + 1) % 3].join(',')].sort().join('|'));
    }
  }
  assert.equal(vertices.size - edges.size + mesh.length / 9, euler);
  for (const boundary of solid.boundaries) assert.equal(solid.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  if (expectedVolume !== undefined) close(volume, expectedVolume, expectedVolume * 0.018);
  return volume;
}

function checkSurface(surface, equation) {
  for (const u of [0, 0.13, 0.37, 0.71, 1]) for (const v of [0, 0.17, 0.43, 0.81, 1]) equation(surface.at(u, v).position);
}

test('a cylinder rounds all the way to a mathematical sphere with no caps or cylindrical remnant', () => {
  const sphere = cylinder().round({ radius: 1 });
  assert.equal(sphere.surfaces.length, 2);
  assert.ok(sphere.surfaces.every(surface => surface instanceof SpatialSurface && !(surface instanceof TrimmedSurface)));
  sphere.surfaces.forEach(surface => checkSurface(surface, ([x, y, z]) => close(x * x + y * y + (z - 1) ** 2, 1)));
  check(sphere, 4 * Math.PI / 3);
  for (const z of [0, 2]) assert.ok(sphere.vertices.some(vertex => vec3.distance(vertex.position, [0, 0, z]) < 1e-7));
  assert.equal(sphere.boundaries.length, 1, 'Only the shared equator remains, with no zero-length pole boundaries');
});

test('a cylinder with a hole becomes a mathematical torus when all four rims meet', () => {
  const tube = sketch().add(circle({ center, radius: 3 }), circle({ center, radius: 1 })).extrude({ length: 2 });
  const torus = round({ solid: tube, radius: 1 });
  assert.equal(torus.surfaces.length, 4);
  assert.ok(torus.surfaces.every(surface => surface instanceof SpatialSurface && !(surface instanceof TrimmedSurface)));
  torus.surfaces.forEach(surface => checkSurface(surface, ([x, y, z]) => close((Math.hypot(x, y) - 2) ** 2 + (z - 1) ** 2, 1)));
  check(torus, 4 * Math.PI ** 2, 0);
});

test('rounding every cube edge creates six planar faces, twelve cylindrical blends and eight spherical corners', () => {
  const radius = 0.3, result = cube().round({ radius }), side = 2 - 2 * radius;
  assert.equal(result.surfaces.filter(surface => surface instanceof Face).length, 6);
  assert.equal(result.surfaces.length, 26);
  check(result, side ** 3 + 6 * side ** 2 * radius + 3 * Math.PI * side * radius ** 2 + 4 * Math.PI * radius ** 3 / 3);
  for (const surface of result.surfaces.slice(-8)) checkSurface(surface, point => {
    const nearestCore = [Math.sign(point[0]) * 0.7, Math.sign(point[1]) * 0.7, point[2] > 1 ? 1.7 : 0.3];
    close(vec3.distance(point, nearestCore), radius);
  });
});

test('rounding four parallel cube edges preserves the two flat end faces and adds four tangent rounds', () => {
  const source = cube(), radius = 0.3, result = round({ solid: source, radius, boundaries: vertical(source) });
  assert.equal(result.surfaces.length, 10);
  assert.equal(result.surfaces.filter(surface => surface instanceof SpatialSurface).length, 4);
  const caps = result.surfaces.filter(surface => surface instanceof Face && Math.abs(surface.plane.normal[2]) > 0.9);
  assert.equal(caps.length, 2);
  assert.ok(caps.every(face => face.outer.length === 8));
  check(result, (4 - (4 - Math.PI) * radius ** 2) * 2);
});

test('four cube rounds at half the side length consume all side strips and produce a cylinder', () => {
  const source = cube(), result = source.round({ radius: 1, boundaries: vertical(source) });
  assert.equal(result.surfaces.length, 6);
  assert.equal(result.surfaces.filter(surface => surface instanceof Face).length, 2);
  for (const surface of result.surfaces.filter(surface => surface instanceof SpatialSurface)) {
    checkSurface(surface, ([x, y]) => close(x * x + y * y, 1));
  }
  check(result, 2 * Math.PI);
});

test('all twelve cube edges can converge too, leaving a sphere made of eight spherical octants', () => {
  const result = cube().round({ radius: 1 });
  assert.equal(result.surfaces.length, 8);
  result.surfaces.forEach(surface => checkSurface(surface, ([x, y, z]) => close(x * x + y * y + (z - 1) ** 2, 1)));
  check(result, 4 * Math.PI / 3);
});

test('defaults, duplicate indices, method and operation agree without modifying source topology or memo caches', () => {
  assert.equal(round, operationRound);
  const source = cube(), child = node(); source.add(child);
  const surfaces = source.surfaces, boundaries = source.boundaries, vertices = source.vertices;
  const coordinates = vertices.map(vertex => [...vertex.position]), cached = source.triangulate(), bytes = cached.slice();
  const result = source.round();
  assert.notEqual(result, source); assert.deepEqual(result.children, [child]); assert.notEqual(result.children, source.children);
  assert.equal(source.surfaces, surfaces); assert.equal(source.boundaries, boundaries); assert.equal(source.vertices, vertices);
  assert.deepEqual(source.vertices.map(vertex => [...vertex.position]), coordinates);
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(result.triangulate(), round({ solid: source, radius: 0.5, boundaries: [] }).triangulate());
  assert.deepEqual(source.round({ boundaries: [0] }).triangulate(), source.round({ boundaries: [0, 0] }).triangulate());
  check(source.round({ boundaries: [0] }));
});

test('non-limit curved rounds preserve exact source trims and are tangent at both contact rails', () => {
  const source = cylinder(), result = source.round({ radius: 0.25 });
  const wall = result.surfaces.find(surface => surface instanceof TrimmedSurface);
  assert.equal(wall.surface, source.surfaces[2]);
  assert.equal(result.surfaces.length, 5);
  const blends = result.surfaces.slice(-2);
  for (const blend of blends) for (const u of [0.13, 0.37, 0.71]) for (const v of [0, 1]) {
    const a = blend.at(u - 1e-5, v).position, b = blend.at(u + 1e-5, v).position;
    const c = blend.at(u, v === 0 ? 0 : 1 - 1e-5).position, d = blend.at(u, v === 0 ? 1e-5 : 1).position;
    const normal = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], b, a), vec3.subtract([0, 0, 0], d, c)));
    const point = blend.at(u, v).position, expected = v === 0 ? [0, 0, point[2] < 1 ? -1 : 1] : [point[0], point[1], 0];
    close(Math.abs(vec3.dot(normal, expected)), 1, 1e-6);
  }
  check(result);
});

test('general curves, source sampling overrides and drafted walls are handled without curve-type equations', () => {
  let sampled = 0;
  const ellipse = planarCurve({ at: t => ({ x: 2 * Math.cos(2 * Math.PI * (t === 1 ? 0 : t)), y: Math.sin(2 * Math.PI * (t === 1 ? 0 : t)) }) });
  const sample = ellipse.sample.bind(ellipse);
  ellipse.sample = options => { sampled++; return sample(options); };
  const source = sketch().add(ellipse).extrude({ length: 2, angle: 3 });
  assert.ok(sampled > 0);
  sampled = 0;
  const rim = source.boundaries[0], sampleRim = rim.sample.bind(rim);
  rim.sample = options => { sampled++; return sampleRim(options); };
  const result = source.round({ radius: 0.1 });
  assert.ok(sampled > 0); assert.equal(result.surfaces.length, 5);
  check(result);
});

test('placement and negative extrusion length preserve rounding orientation and closed topology', () => {
  for (const plane of [XY, YZ, ZX]) for (const length of [-2, 2]) {
    check(cylinder(plane, length).round({ radius: 1 }), 4 * Math.PI / 3);
    check(cube(plane, length).round({ radius: 0.25 }));
  }
});

test('resolution changes affect tessellation only, and transformed rounds retain valid mathematical geometry', () => {
  const source = cylinder();
  setTriangulationResolution(0.04);
  const coarse = source.round({ radius: 1 });
  const coarseMesh = coarse.triangulate();
  setTriangulationResolution(0.004);
  const fine = source.round({ radius: 1 });
  assert.ok(fine.triangulate().length > coarseMesh.length);
  const moved = fine.displace({ vector: [4, 5, 6] });
  check(moved, 4 * Math.PI / 3);
  assert.equal(moved.vertices.length, fine.vertices.length);
  for (const z of [6, 8]) assert.ok(moved.vertices.some(vertex => vec3.distance(vertex.position, [4, 5, z]) < 1e-7));
  setTriangulationResolution(0.0128);
});

test('invalid options, nonmanifold input, oversized radii and unsupported corners fail explicitly', () => {
  const source = cube(), cached = source.triangulate();
  for (const radius of [0, -1, NaN, Infinity]) assert.throws(() => round({ solid: source, radius }), RangeError);
  for (const boundaries of [[-1], [0.5], [12], [NaN], null]) assert.throws(() => round({ solid: source, boundaries }), RangeError);
  assert.throws(() => round({ solid: {} }), TypeError);
  assert.throws(() => new Solid({ surfaces: [source.surfaces[0]] }).round(), /manifold/);
  assert.throws(() => source.round({ radius: 1.1 }), RangeError);
  assert.throws(() => cylinder().round({ radius: 1.1 }), RangeError);
  assert.throws(() => source.round({ boundaries: [0, 1] }), /one selected edge or all three/);
  // A mixed straight/curved corner is outside this version's supported charts.
  const mixed = sketch().add(circle({ center, radius: 0.2 }), centerRectangle({ center, corner: { x: 1, y: 1 } })).extrude({ length: 2 });
  assert.throws(() => mixed.round(), /convex planar solid/);
  assert.equal(source.triangulate(), cached);
  const empty = new Solid({ surfaces: [] });
  assert.deepEqual(empty.round().surfaces, []); assert.notEqual(empty.round(), empty);
});

test('opposite edge rounds keep reversed shared rails watertight at the exact limiting radius', () => {
  for (const [plane, length] of [[XY, 20], [XY, -20], [ZX, 20], [YZ, -20]]) {
    const source = sketch({ plane }).add(centerRectangle({ center, corner: { x: 10, y: 10 } })).extrude({ length });
    const pairs = source.surfaces.flatMap(face => [[face.outer[0], face.outer[2]], [face.outer[1], face.outer[3]]])
      .map(pair => pair.map(boundary => source.boundaries.indexOf(boundary)));
    const cached = source.triangulate(), bytes = cached.slice();
    for (const boundaries of pairs) for (const radius of [9.9, 10]) {
      const result = source.round({ radius, boundaries });
      assert.equal(result.surfaces.length, radius === 10 ? 7 : 8);
      check(result, 8000 - 40 * radius ** 2 * (1 - Math.PI / 4));
    }
    assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
  }
});
