import assert from 'node:assert/strict';
import { test } from 'node:test';
import { center, rectangle, circle, sketch, Solid, SpatialCurve, SpatialSurface, Surface, SurfaceRegion, spatialLine, XY, setTriangulationResolution, TRIANGULATION_RESOLUTION } from 'libcompass';
import { Tessellation } from '../dist/internal/Tessellation.js';
import { sampleSurface } from '../dist/internal/surfaceSampling.js';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const key = point => Array.from(point.position, Math.fround).join(',');
function meshVertices(mesh) {
  return new Set(Array.from({ length: mesh.length / 3 }, (_, i) => Array.from(mesh.subarray(3 * i, 3 * i + 3)).join(',')));
}

test('trimmed tessellation measures geometry rather than nonlinear parameter spacing', () => {
  const source = new SpatialSurface({ at: (u, v) => ({ position: [10 * (u + u * u) / 2, 5 * v, 0] }) });
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => source.at(u, v));
  const charts = [t => ({ x: t, y: 0 }), t => ({ x: 1, y: t }), t => ({ x: 1 - t, y: 1 }), t => ({ x: 0, y: 1 - t })];
  const boundaries = charts.map((at, i) => new SpatialCurve({ at: t => {
    const uv = at(t); return source.at(uv.x, uv.y);
  }, start: corners[i], end: corners[(i + 1) % 4] }));
  let calls = 0;
  for (const boundary of boundaries) boundary.sample = () => { calls++; return [boundary.at(0), boundary.at(1)]; };
  const region = new SurfaceRegion({ surface: source, boundaryLoops: [boundaries],
    regions: [{ outer: boundaries.map((boundary, i) => ({ boundary, at: charts[i] })) }] });
  const mesh = region.triangulate();
  assert.equal(mesh.length, 18, 'A flat rectangular patch only needs two triangles');
  assert.ok(calls > 0, 'Boundary sampling overrides remain authoritative');
  assert.deepEqual(meshVertices(mesh), new Set(corners.map(key)));
  let area = 0;
  for (let i = 0; i < mesh.length; i += 9) {
    assert.equal(mesh[i + 2], 0); assert.equal(mesh[i + 5], 0); assert.equal(mesh[i + 8], 0);
    area += ((mesh[i + 3] - mesh[i]) * (mesh[i + 7] - mesh[i + 1]) - (mesh[i + 4] - mesh[i + 1]) * (mesh[i + 6] - mesh[i])) / 2;
  }
  close(area, 50);
});

test('all four parameter sides preserve opposite directions and nonuniform source samples', () => {
  const source = sketch().add(rectangle({ center, corner2: { x: 1, y: 1 } })).extrude({ length: 2 });
  const boundaries = new Map(source.boundaries.map(edge => [edge, new SpatialCurve({ at: t => edge.at(t), start: edge.start, end: edge.end })]));
  const supplied = [], snapshots = [];
  let calls = 0;
  for (const [index, parameters] of [[0, [0, 0.1, 0.37, 0.8, 1]], [2, [0, 0.23, 0.64, 1]], [8, [0, 0.17, 0.63, 0.9, 1]]]) {
    const curve = boundaries.get(source.boundaries[index]);
    const points = Object.freeze(parameters.map(t => curve.at(t)));
    curve.sample = () => { calls++; return points; };
    supplied.push(...points); snapshots.push([points, points.map(point => [...point.position])]);
  }
  const surfaces = source.surfaces.map(face => {
    const local = face.vertices.map(vertex => face.plane.toLocal(vertex));
    const minX = Math.min(...local.map(p => p.x)), maxX = Math.max(...local.map(p => p.x));
    const minY = Math.min(...local.map(p => p.y)), maxY = Math.max(...local.map(p => p.y));
    const sides = {};
    for (const edge of face.boundaries) {
      const a = face.plane.toLocal(edge.start), b = face.plane.toLocal(edge.end);
      const same = (a, b) => Math.abs(a - b) < 1e-10;
      const side = same(a.x, minX) && same(b.x, minX) ? 'u0' : same(a.x, maxX) && same(b.x, maxX) ? 'u1'
        : same(a.y, minY) && same(b.y, minY) ? 'v0' : 'v1';
      sides[side] = boundaries.get(edge);
    }
    return new SpatialSurface({ at: (u, v) => face.plane.toWorld({ x: minX + (maxX - minX) * u, y: minY + (maxY - minY) * v }),
      sides, boundaryLoops: face.boundaryLoops.map(loop => loop.map(edge => boundaries.get(edge))) });
  });
  const solid = new Solid({ surfaces }), mesh = solid.triangulate();
  validateSweepMesh(mesh);
  const vertices = meshVertices(mesh);
  for (const point of supplied) assert.ok(vertices.has(key(point)), `Override vertex ${key(point)} was discarded`);
  for (const [points, snapshot] of snapshots) assert.deepEqual(points.map(point => [...point.position]), snapshot);
  assert.ok(calls > 0);
  const transformed = solid.rotate({ axis: spatialLine({ direction: [1, 2, 3], origin: [2, -1, 4] }), angle: 37 }).displace({ vector: [3, 4, 5] });
  validateSweepMesh(transformed.triangulate());
});

test('reversed periodic rims synchronize asymmetric samples with planar caps', () => {
  const source = sketch().add(circle({ center, radius: 1 })).extrude({ length: 2 });
  const wall = source.surfaces[2], lower = wall.start;
  const parameters = [...new Set([...lower.sampleWithParameters().map(({ t }) => t), 0.07, 0.31, 0.88])].sort((a, b) => a - b);
  const points = Object.freeze(parameters.map(t => lower.at(t)));
  lower.sample = () => points;
  const reverse = new SpatialSurface({ at: (u, v) => wall.at(1 - u, v), boundaryLoops: wall.boundaryLoops,
    sides: wall.sides, periodicU: true, reversed: true });
  const mesh = Surface.triangulateAll([source.surfaces[0], source.surfaces[1], reverse]);
  validateSweepMesh(mesh);
  const vertices = meshVertices(mesh);
  for (const point of points) assert.ok(vertices.has(key(point)));
});

test('parameter groups retain reversals transitively without mirroring unrelated uneven samples', () => {
  const curves = [0, 1, 2].map(y => new SpatialCurve({ at: t => ({ position: [t, y, 0] }) }));
  curves[0].sample = () => [0, 0.1, 0.4, 1].map(t => curves[0].at(t));
  curves[1].sample = () => [0, 0.3, 1].map(t => curves[1].at(t));
  curves[2].sample = () => [0, 0.8, 1].map(t => curves[2].at(t));
  const context = new Tessellation();
  context.link(curves[0], curves[1], true); context.link(curves[1], curves[2]);
  context.request(curves[2], [0.9]);
  const first = context.parameters(curves[0]);
  assert.equal(first.length, 6); // 0, .1, .2, .4, .7, 1; no unnecessary mirrored stations.
  const second = context.parameters(curves[1]);
  first.forEach((t, i) => close(t, 1 - second[second.length - 1 - i]));
  assert.ok(!first.some(t => Math.abs(t - 0.9) < 1e-12));
  for (const curve of curves) assert.equal(context.vertices(curve).length, first.length);
  // A conflicting cycle requires a symmetric subdivision, rather than a direction mismatch.
  context.link(curves[0], curves[2]);
  const symmetric = context.parameters(curves[0]);
  for (const t of symmetric) assert.ok(symmetric.some(other => Math.abs(other - (1 - t)) < 1e-12));
});

test('reflection roundoff coalesces grid stations without losing domain endpoints or hiding invalid seeds', () => {
  const plane = { at: (u, v) => ({ position: [u, v, 0] }) };
  const grid = sampleSurface(plane, [Number.EPSILON, 1 - Number.EPSILON, 0.1, 1 - 0.9]);
  assert.deepEqual(grid.u, [0, 1 - 0.9, 0.5, 1]);
  for (const invalid of [NaN, Infinity, -Number.EPSILON, 1 + Number.EPSILON]) {
    assert.throws(() => sampleSurface(plane, [invalid]), RangeError);
  }
});

test('shared subdivisions stay on exact curves and retain nonuniform sampler vertices', () => {
  const curves = [0, 2].map(z => new SpatialCurve({ at: t => ({ position: [t, t * t, z] }) }));
  const supplied = [[0, 0.1, 0.4, 1], [0, 0.3, 1]].map((parameters, i) => parameters.map(t => curves[i].at(t)));
  curves.forEach((curve, i) => { curve.sample = () => supplied[i]; });
  const context = new Tessellation();
  context.link(curves[0], curves[1], true);
  const check = () => curves.forEach((curve, i) => {
    const points = context.vertices(curve), parameters = context.parameters(curve);
    assert.equal(points.length, parameters.length);
    points.forEach((point, j) => point.position.forEach((coordinate, axis) => close(coordinate, curve.at(parameters[j]).position[axis])));
    for (const point of supplied[i]) assert.ok(points.includes(point), 'Original sample identity must survive synchronization');
  });
  check();
  context.request(curves[0], [0.13, 0.55]);
  check();
});

test('coarse rounded sphere and torus rims stay on their mathematical surfaces', () => {
  const previous = TRIANGULATION_RESOLUTION;
  try {
    for (const resolution of [0.4096, 0.1024, 0.0128]) {
      setTriangulationResolution(resolution);
      const sphere = sketch({ plane: XY.displace([0, 0, -5]) }).add(circle(5)).extrude(10).round({ radius: 5 });
      const torus = sketch({ plane: XY.displace([0, 0, -2]) }).add(circle(7), circle(3)).extrude(4).round({ radius: 2 });
      for (const [solid, distance, radius] of [[sphere, ([x, y, z]) => Math.hypot(x, y, z), 5],
        [torus, ([x, y, z]) => Math.hypot(Math.hypot(x, y) - 5, z), 2]]) {
        const mesh = solid.triangulate();
        validateSweepMesh(mesh);
        for (let i = 0; i < mesh.length; i += 3) {
          assert.ok(Math.abs(distance(mesh.subarray(i, i + 3)) - radius) < 2e-6,
            `Shared rim vertex must stay on the surface at resolution ${resolution}: ${Array.from(mesh.subarray(i, i + 3))}`);
        }
      }
    }
  } finally { setTriangulationResolution(previous); }
});

test('mesh validation separates acute triangle corners by Euclidean distance', () => {
  const positions = [], quad = (a, b, c, d) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  const xs = [0, 0.00001, 1, 2], y = 0.02, z = 100;
  for (let i = 1; i < xs.length; i++) {
    const a = xs[i - 1], b = xs[i];
    quad([a, 0, 0], [a, y, 0], [b, y, 0], [b, 0, 0]);
    quad([a, 0, z], [b, 0, z], [b, y, z], [a, y, z]);
    quad([a, 0, 0], [b, 0, 0], [b, 0, z], [a, 0, z]);
    quad([a, y, 0], [a, y, z], [b, y, z], [b, y, 0]);
  }
  quad([0, 0, 0], [0, 0, z], [0, y, z], [0, y, 0]);
  quad([2, 0, 0], [2, y, 0], [2, y, z], [2, 0, z]);
  const mesh = new Float32Array(positions);
  assert.doesNotThrow(() => validateSweepMesh(mesh));
  const separated = [...positions, ...positions.map((value, i) => i % 3 === 0 ? value + 2.0000005 : value)];
  assert.doesNotThrow(() => validateSweepMesh(new Float32Array(separated)));
  const touching = [...positions, ...positions.map((value, i) => i % 3 === 0 ? value + 2 : value)];
  assert.throws(() => validateSweepMesh(new Float32Array(touching)), /self-intersects|manifold/);
  const overlap = [...positions, ...positions.map((value, i) => i % 3 === 0 ? value + 1 : value)];
  assert.throws(() => validateSweepMesh(new Float32Array(overlap)), /self-intersects|manifold/);
});
