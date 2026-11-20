import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Circle, Face, LineSegment, Plane, PlanarCurve, Sketch, SpatialCurve, SpatialSurface, circle, extrudeAlongCurve, sketch, spatialCurve } from 'libcompass';

const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const disk = radius => sketch().add(circle({ center: { x: 0, y: 0 }, radius }));
const line = spatialCurve({ at: t => ({ position: [4, 5, 6 + 3 * t] }) });
const loop = radius => SpatialCurve.fromPlanarCurve({ curve: circle({ center: { x: 0, y: 0 }, radius }) });
function volume(body) {
  const positions = body.triangulate();
  let result = 0;
  for (let i = 0; i < positions.length; i += 9) result += vec3.dot(positions.subarray(i, i + 3), vec3.cross([0, 0, 0], positions.subarray(i + 3, i + 6), positions.subarray(i + 6, i + 9))) / 6;
  return result;
}
const polygon = points => sketch().add(...points.map((start, i) => new LineSegment({ start, end: points[(i + 1) % points.length] })));

test('parameterized sampling preserves nonuniform sample overrides and lifted parameters', () => {
  const curve = new PlanarCurve({ at: t => ({ x: t, y: t * t }) });
  const parameters = [0, 0.01, 0.3, 0.9, 1];
  curve.sample = () => parameters.map(t => curve.at(t));
  curve.sampleParameters = () => { throw new Error('Must call sample()'); };
  assert.deepEqual(curve.sampleWithParameters().map(sample => sample.t), parameters);
  const lifted = SpatialCurve.fromPlanarCurve({ curve });
  assert.deepEqual(lifted.sampleWithParameters().map(sample => sample.t), parameters);
  const spatial = spatialCurve({ at: t => ({ position: [t * t, 0, 0] }) });
  spatial.sample = () => parameters.map(t => spatial.at(t));
  spatial.sampleParameters = () => { throw new Error('Must call sample()'); };
  close(spatial.tangent(0.5)[0], 1);
  assert.deepEqual(spatial.sampleWithParameters().map(sample => sample.t), parameters);
  curve.sample = () => [{ x: 0, y: 0 }, { x: 0.3, y: 0.09 }, { x: 1, y: 1 }];
  assert.throws(() => curve.sampleWithParameters(), /this.at/);
});

test('straight sweeps align local origin, ignore plane translation, and retain only cap boundaries', () => {
  const s = new Sketch({ plane: new Plane({ a: [100, 200, 300], b: [101, 200, 300], c: [100, 201, 300] }) }).add(new Circle({ center: { x: 0, y: 0 }, radius: 0.5 }));
  const body = extrudeAlongCurve({ sketch: s, curve: line });
  assert.equal(body.surfaces.length, 3); assert.equal(body.boundaries.length, 2); assert.equal(body.vertices.length, 2);
  const wall = body.surfaces.find(surface => surface instanceof SpatialSurface);
  for (const u of [0, 0.17, 0.53, 1]) for (const v of [0, 0.31, 1]) {
    const point = wall.at(u, v).position;
    close(Math.hypot(point[0] - 4, point[1] - 5), 0.5); close(point[2], 6 + 3 * v);
  }
  close(volume(body), Math.PI * 0.25 * 3, 0.005);
  assert.equal(body.surfaces.filter(surface => surface instanceof Face).length, 2);
});

test('smooth closed paths produce a torus without caps, seam edges, or intermediate topology', () => {
  const body = disk(0.3).extrudeAlongCurve({ curve: loop(2) });
  assert.equal(body.surfaces.length, 1); assert.equal(body.boundaries.length, 0); assert.equal(body.vertices.length, 0);
  const surface = body.surfaces[0];
  assert.ok(surface.periodicU && surface.periodicV);
  for (const u of [0, 0.17, 0.8, 1]) for (const v of [0, 0.23, 0.74, 1]) {
    const point = surface.at(u, v).position;
    close(Math.hypot(Math.hypot(point[0], point[1]) - 2, point[2]), 0.3);
    assert.deepEqual(surface.at(u, 0).position, surface.at(u, 1).position);
  }
  close(volume(body), 2 * Math.PI ** 2 * 2 * 0.3 ** 2, 0.02);
});

test('polygon profiles and holes remain watertight on a nonplanar path', () => {
  const s = polygon([{ x: -0.3, y: -0.2 }, { x: 0.3, y: -0.2 }, { x: 0.3, y: 0.2 }, { x: -0.3, y: 0.2 }]);
  s.add(circle({ center: { x: 0, y: 0 }, radius: 0.08 }));
  const path = spatialCurve({ at: t => ({ position: [2 * Math.cos(t), 2 * Math.sin(t), t] }) });
  const body = s.extrudeAlongCurve({ curve: path });
  assert.equal(body.surfaces.length, 7);
  assert.equal(body.boundaries.length, 14); // two rims per boundary and four corner tracks
  for (const boundary of body.boundaries) assert.equal(body.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  close(volume(body), (0.24 - Math.PI * 0.08 ** 2) * Math.sqrt(5), 0.005);
});

test('nonplanar closed paths join transported asymmetric profiles continuously', () => {
  const s = polygon([{ x: -0.04, y: -0.03 }, { x: 0.04, y: -0.03 }, { x: 0.04, y: 0.03 }, { x: -0.04, y: 0.03 }]);
  const curve = spatialCurve({ at: t => {
    const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI;
    return { position: [Math.cos(angleRAD), 0.8 * Math.sin(angleRAD), 0.2 * Math.sin(2 * angleRAD) + 0.1 * Math.cos(3 * angleRAD)] };
  } });
  const body = s.extrudeAlongCurve({ curve });
  assert.equal(body.surfaces.length, 4); assert.equal(body.boundaries.length, 4);
  assert.ok(body.surfaces.every(surface => surface.periodicV));
  for (const surface of body.surfaces) for (const u of [0, 0.37, 1]) {
    close(vec3.distance(surface.at(u, 0).position, surface.at(u, 1 - 1e-6).position), 0, 2e-5);
  }
  assert.ok(volume(body) > 0);
});

test('nonsmooth paths, stationary curves, local folds, and global self intersections throw', () => {
  const s = disk(0.2);
  for (const corner of [0.5, 1 / 3]) {
    const curve = spatialCurve({ at: t => ({ position: t < corner ? [t, 0, 0] : [corner, t - corner, 0] }) });
    assert.throws(() => s.extrudeAlongCurve({ curve }), /smooth|corner|cusp/);
  }
  assert.throws(() => s.extrudeAlongCurve({ curve: spatialCurve({ at: () => ({ position: [0, 0, 0] }) }) }), /tangent|stationary/);
  assert.throws(() => disk(2).extrudeAlongCurve({ curve: loop(1) }), /fold/);
  const eight = spatialCurve({ at: t => {
    const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI;
    return { position: [3 * Math.sin(angleRAD), 3 * Math.sin(2 * angleRAD), 0] };
  } });
  assert.throws(() => s.extrudeAlongCurve({ curve: eight }), /intersect|touch|manifold/);
});
