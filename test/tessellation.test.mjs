import assert from 'node:assert/strict';
import { test } from 'node:test';
import { center, rectangle, circle, sketch, Solid, SpatialCurve, SpatialSurface, Surface, spatialLine } from 'libcompass';
import { Tessellation } from '../dist/internal/Tessellation.js';
import { sampleSurface } from '../dist/internal/surfaceSampling.js';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} != ${b}`);
const key = point => Array.from(point.position, Math.fround).join(',');
function meshVertices(mesh) {
  return new Set(Array.from({ length: mesh.length / 3 }, (_, i) => Array.from(mesh.subarray(3 * i, 3 * i + 3)).join(',')));
}

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
