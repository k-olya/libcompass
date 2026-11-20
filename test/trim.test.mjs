import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { circle, edge, extrude, Face, line, lineSegment, planarCurve, plane, sketch, solid, SpatialCurve,
  spatialCurve, spatialSurface, trimCurve, trimSurface, TrimmedSurface, YZ, XY, setTriangulationResolution } from 'libcompass';
import { trimCurve as curveOperation } from 'libcompass/operations/trimCurve';
import { trimSurface as surfaceOperation } from 'libcompass/operations/trimSurface';

setTriangulationResolution(0.01);
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const rectangle = (points = [[-5, -5], [5, -5], [5, 5], [-5, 5]]) => {
  const corners = points.map(([x, y]) => ({ x, y }));
  return sketch().add(...corners.map((start, i) => lineSegment({ start, end: corners[(i + 1) % corners.length] })));
};
function area(surfaces) {
  let result = 0;
  for (const surface of surfaces) {
    const mesh = surface.triangulate();
    for (let i = 0; i < mesh.length; i += 9) {
      const a = Array.from(mesh.subarray(i, i + 3)), b = Array.from(mesh.subarray(i + 3, i + 6)), c = Array.from(mesh.subarray(i + 6, i + 9));
      const cross = vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], b, a), vec3.subtract([0, 0, 0], c, a));
      assert.ok(vec3.length(cross) > 0, 'Trim mesh has no degenerate triangles');
      result += vec3.length(cross) / 2;
    }
  }
  return result;
}

test('trim curves by actual curves, infinite lines and planes; retain exact evaluator and straight type', () => {
  assert.equal(curveOperation, trimCurve); assert.equal(surfaceOperation, trimSurface);
  const source = lineSegment({ start: { x: -5, y: 0 }, end: { x: 5, y: 0 } });
  const result = trimCurve({ curve: source, cutters: [circle({ center: { x: 0, y: 0 }, radius: 2 })], keep: 0.5 });
  assert.ok(result instanceof source.constructor);
  close(result.start.x, -2); close(result.end.x, 2); close(result.at(0.25).x, -1);
  assert.equal(source.start.x, -5); assert.equal(source.end.x, 5);
  const parabola = planarCurve({ at: t => ({ x: t * 4 - 2, y: (t * 4 - 2) ** 2 }) });
  const clipped = trimCurve({ curve: parabola, cutters: [line({ point: { x: 0, y: 1 }, direction: [1, 0] })], keep: 0.5 });
  close(clipped.start.x, -1); close(clipped.end.x, 1);
  for (const t of [0, 0.13, 0.49, 1]) close(clipped.at(t).y, clipped.at(t).x ** 2);
  const edgeSource = edge({ start: { position: [-5, 0, 0] }, end: { position: [5, 0, 0] } });
  const half = trimCurve({ curve: edgeSource, cutters: [YZ], keep: 0.8 });
  close(half.start.position[0], 0); assert.equal(half.end, edgeSource.end);
  assert.notEqual(half, edgeSource);
});

test('closed curve trims cross the seam and source samplers remain authoritative through lifting and nesting', () => {
  const source = circle({ center: { x: 0, y: 0 }, radius: 5 });
  let samples = 0;
  const sample = source.sample.bind(source);
  source.sample = options => { samples++; return sample(options); };
  const cutter = line({ point: { x: 0, y: 0 }, direction: [0, 1] });
  const arc = trimCurve({ curve: source, cutters: [cutter], keep: 0 });
  close(arc.start.y, -5); close(arc.end.y, 5); close(arc.at(0.5).x, 5);
  assert.equal(arc.isLoop(), false);
  const before = samples, sampled = arc.sampleWithParameters();
  assert.ok(samples > before);
  assert.equal(sampled[0].point, arc.start); assert.equal(sampled.at(-1).point, arc.end);
  const lifted = SpatialCurve.fromPlanarCurve({ curve: arc });
  const quarter = trimCurve({ curve: lifted, cutters: [plane({ a: [0, 0, 0], b: [0, 0, 1], c: [1, 0, 0] })], keep: 0.75 });
  close(quarter.start.position[1], 0); close(quarter.end.position[1], 5);
  assert.ok(quarter.sampleWithParameters().length > 2);
  const fresh = trimCurve({ curve: source, cutters: [line({ point: { x: 20, y: 0 }, direction: [0, 1] })], keep: 0.3 });
  assert.notEqual(fresh, source); assert.equal(fresh.isLoop(), true);
});

test('plane cuts split faces, preserve holes, normals and input topology', () => {
  const part = extrude({ sketch: rectangle().add(circle({ center: { x: 0, y: 0 }, radius: 1 })), length: 3 });
  const face = part.surfaces[0], boundaries = [...face.boundaries], input = part.triangulate(), copy = input.slice();
  const positive = trimSurface({ surface: face, cutter: YZ }), negative = trimSurface({ surface: face, cutter: YZ, keep: 'negative' });
  assert.equal(positive.length, 1); assert.equal(negative.length, 1);
  close(area(positive), 50 - Math.PI / 2, 0.03); close(area(negative), area(positive));
  assert.equal(positive[0].plane, face.plane);
  assert.deepEqual(face.boundaries, boundaries); assert.equal(part.triangulate(), input); assert.deepEqual(input, copy);
  const u = rectangle([[-4, -4], [4, -4], [4, 4], [2, 4], [2, -2], [-2, -2], [-2, 4], [-4, 4]]);
  const uFace = extrude({ sketch: u, length: 1 }).surfaces[0];
  const split = trimSurface({ surface: uFace, cutter: plane({ a: [0, 0, 0], b: [0, 0, 1], c: [1, 0, 0] }) });
  assert.equal(split.length, 2); close(area(split), 16);
  for (const vertex of positive[0].vertices) assert.ok(vertex.position[0] >= -1e-8);
});

test('closed curve cuts can create holes, overlap existing curves, or remove all of a face', () => {
  const face = extrude({ sketch: rectangle(), length: 1 }).surfaces[0];
  // The face plane need not be XY-oriented: construct cutters in its local frame.
  const center = face.plane.toLocal({ position: [0, 0, 0] });
  const cutter = circle({ center, radius: 2 });
  const inside = trimSurface({ surface: face, cutter }), outside = trimSurface({ surface: face, cutter, keep: 'outside' });
  close(area(inside), 4 * Math.PI, 0.13); close(area(outside), 100 - area(inside));
  assert.equal(inside[0].holes.length, 0); assert.equal(outside[0].holes.length, 1);
  const offset = circle({ center: { x: center.x + 4, y: center.y }, radius: 2 });
  const overlap = trimSurface({ surface: face, cutter: offset });
  assert.equal(overlap.length, 1); assert.ok(area(overlap) > 5 && area(overlap) < 13);
  const missing = circle({ center: { x: center.x + 30, y: center.y }, radius: 2 });
  assert.deepEqual(trimSurface({ surface: face, cutter: missing }), []);
  close(area(trimSurface({ surface: face, cutter: missing, keep: 'outside' })), 100);
  const round = extrude({ sketch: sketch().add(circle({ center: { x: 0, y: 0 }, radius: 4 })), length: 1 }).surfaces[0];
  const local = round.plane.toLocal({ position: [0, 0, 0] });
  const lens = trimSurface({ surface: round, cutter: circle({ center: { x: local.x + 3, y: local.y }, radius: 4 }) });
  close(area(lens), 32 * Math.acos(3 / 8) - 1.5 * Math.sqrt(55), 0.2);
});

test('curved surface plane cuts retain mathematical rails and periodic topology without seam edges', () => {
  const part = extrude({ sketch: sketch().add(circle({ center: { x: 0, y: 0 }, radius: 5 })), length: 10 });
  const source = part.surfaces[2], planeCut = plane({ a: [0, 0, 4], b: [1, 0, 4.2], c: [0, 1, 4] });
  for (const keep of ['positive', 'negative']) {
    const [trim] = trimSurface({ surface: source, cutter: planeCut, keep });
    assert.ok(trim instanceof TrimmedSurface); assert.equal(trim.surface, source);
    assert.equal(trim.periodicU, true); assert.equal(trim.boundaries.length, 2);
    assert.equal(trim.sides.u0, undefined); assert.equal(trim.sides.u1, undefined);
    const rail = keep === 'positive' ? trim.sides.v0 : trim.sides.v1;
    assert.equal(rail.isLoop(), true); assert.equal(rail.start, rail.end);
    for (const t of [0, 0.13, 0.37, 0.71, 1]) {
      const p = rail.at(t).position;
      close(Math.hypot(p[0], p[1]), 5); close(p[2], 4 + 0.2 * p[0]);
      const uv = trim.parameters(t, 0.4);
      close(vec3.distance(trim.at(t, 0.4).position, source.at(uv.x, uv.y).position), 0);
    }
    assert.ok(area([trim]) > 0);
  }
  // The other chart direction and nonperiodic side trimming also work.
  const saddle = spatialSurface({ at: (u, v) => ({ position: [u * 4, v * 4, u * v] }) });
  const [trim] = trimSurface({ surface: saddle, cutter: plane({ a: [2, 0, 0], b: [2, 1, 0], c: [2, 0, 1] }) });
  assert.equal(trim.boundaries.length, 4); close(trim.at(0, 0.7).position[0], 2); close(trim.at(1, 0.7).position[0], 4);
  assert.ok(area([trim]) > 0);
});

test('invalid, coincident and unsupported trim arrangements throw instead of creating invalid geometry', () => {
  const curve = spatialCurve({ at: t => ({ position: [t, 0, t * t] }) });
  assert.throws(() => trimCurve({ curve, cutters: [XY], keep: 0 }), /lies on a cut/);
  assert.throws(() => trimCurve({ curve, cutters: [], keep: 0.5 }), /at least one/);
  assert.throws(() => trimCurve({ curve, cutters: [XY], keep: NaN }), /keep/);
  assert.throws(() => trimCurve({ curve, cutters: [circle({ center: { x: 0, y: 0 }, radius: 1 })], keep: 0.5 }), /planes/);
  const face = extrude({ sketch: rectangle(), length: 1 }).surfaces[0];
  assert.throws(() => trimSurface({ surface: face, cutter: XY }), /coincident/);
  assert.throws(() => trimSurface({ surface: face, cutter: YZ, keep: 'inside' }), /match/);
  const surface = spatialSurface({ at: (u, v) => ({ position: [u, v, (u - 0.5) ** 2 + (v - 0.5) ** 2] }) });
  assert.throws(() => trimSurface({ surface, cutter: plane({ a: [0, 0, 0.1], b: [1, 0, 0.1], c: [0, 1, 0.1] }) }), /multiple charts/);
  assert.throws(() => trimSurface({ surface, cutter: circle({ center: { x: 0, y: 0 }, radius: 1 }) }), /cutting plane/);
  const bad = planarCurve({ at: t => ({ x: t, y: t * t }) });
  bad.sample = () => [{ x: 0, y: 0 }, { x: 0.3, y: 0.09 }, { x: 1, y: 1 }];
  assert.throws(() => trimCurve({ curve: bad, cutters: [line({ point: { x: 0.5, y: 0 }, direction: [0, 1] })], keep: 0.8 }), /sample\(\) overrides/);
  const jump = planarCurve({ at: t => ({ x: t < 0.4 ? -1 : 1, y: t }) });
  jump.sample = () => [jump.at(0), jump.at(1)];
  assert.throws(() => trimCurve({ curve: jump, cutters: [YZ], keep: 0.8 }), /did not converge/);
});
