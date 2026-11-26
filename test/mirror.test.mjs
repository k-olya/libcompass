import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Face, Memo, Plane, Solid, SpatialCurve, SurfaceRegion, TrimmedSurface, XY, XZ, YZ, ZY,
  circle, center, mirror, plane, rectangle, sketch, spatialSurface } from 'libcompass';
import { mirror as directMirror } from 'libcompass/operations/mirror';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const near = (actual, expected, tolerance = 1e-8) => Array.from(actual).forEach((value, i) =>
  assert.ok(Math.abs(value - expected[i]) <= tolerance, `${actual} != ${expected}`));
const box = () => sketch().add(rectangle({ corner1: center, width: 4, height: 3 })).extrude(2);
const reflect = (point, frame) => {
  const normal = vec3.normalize([0, 0, 0], frame.normal);
  const distance = vec3.dot(vec3.subtract([0, 0, 0], point, frame.origin), normal);
  return vec3.scaleAndAdd([0, 0, 0], point, normal, -2 * distance);
};
const volume = solid => {
  const mesh = solid.triangulate();
  let sum = 0;
  for (let i = 0; i < mesh.length; i += 9) sum += vec3.dot(mesh.subarray(i, i + 3),
    vec3.cross([0, 0, 0], mesh.subarray(i + 3, i + 6), mesh.subarray(i + 6, i + 9))) / 6;
  return sum;
};

test('mirror reflects exact topology across origin, displaced and oblique planes with outward normals', () => {
  assert.equal(mirror, directMirror);
  const source = box(), cached = source.triangulate(), snapshot = cached.slice();
  const oblique = plane({ a: [2, 3, 4], b: [3, 4, 4], c: [2, 3, 5] });
  for (const frame of [XY, XZ, YZ, ZY, YZ.displace([5, 0, 0]), oblique]) {
    const originalFrame = [frame.origin, frame.xAxis, frame.yAxis, frame.normal].map(value => [...value]);
    for (const result of [mirror({ solid: source, plane: frame }), source.mirror(frame), source.mirror({ plane: frame })]) {
      assert.ok(result instanceof Solid);
      assert.notEqual(result, source);
      assert.equal(result.boundaries.length, source.boundaries.length);
      assert.equal(result.vertices.length, source.vertices.length);
      source.vertices.forEach((vertex, i) => near(result.vertices[i].position, reflect(vertex.position, frame)));
      for (const boundary of result.boundaries) {
        assert.equal(result.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
        assert.ok(!source.boundaries.includes(boundary));
      }
      result.surfaces.forEach((face, i) => {
        assert.ok(face instanceof Face);
        const direction = source.surfaces[i].plane.normal;
        const expected = vec3.scaleAndAdd([0, 0, 0], direction, frame.normal, -2 * vec3.dot(direction, frame.normal));
        near(face.plane.normal, expected);
      });
      validateSweepMesh(result.triangulate());
      assert.ok(Math.abs(volume(result) - 24) < 1e-5);
      result.mirror(frame).vertices.forEach((vertex, i) => near(vertex.position, source.vertices[i].position));
    }
    assert.deepEqual([frame.origin, frame.xAxis, frame.yAxis, frame.normal].map(value => [...value]), originalFrame);
  }
  assert.equal(source.triangulate(), cached);
  assert.deepEqual(cached, snapshot);
});

test('curved, drafted, rounded and boolean surfaces retain evaluators, trims, poles and shared boundaries', () => {
  const cylinder = x => sketch().add(circle({ center: { x, y: 0 }, radius: 2 })).extrude(3);
  const tube = sketch().add(circle(3), circle(1)).extrude(2);
  const cone = sketch().add(circle(2)).extrude({ length: 3, angle: -45 });
  const chamfered = cylinder(0).chamfer({ length: 0.2, boundaries: [0] });
  const rounded = cylinder(0).round({ radius: 0.2, boundaries: [0] });
  const cut = cylinder(0).difference(cylinder(2));
  assert.ok(chamfered.surfaces.some(surface => surface instanceof TrimmedSurface));
  assert.ok(cut.surfaces.some(surface => surface instanceof SurfaceRegion));
  const frame = plane({ a: [1, 2, 3], b: [2, 3, 3], c: [1, 2, 4] });
  for (const source of [tube, cone, chamfered, rounded, cut]) {
    const cached = source.triangulate(), result = source.mirror(frame);
    result.surfaces.forEach((surface, i) => {
      const original = source.surfaces[i];
      assert.equal(surface.constructor, original.constructor);
      if (!(surface instanceof Face)) {
        near(surface.at(0.31, 0.67).position, reflect(original.at(0.31, 0.67).position, frame));
        assert.equal(surface.reversed, !original.reversed);
      }
      if (surface instanceof SurfaceRegion) for (const chart of surface.regions) for (const trim of chart.outer) {
        const t = ((trim.start ?? 0) + (trim.end ?? 1)) / 2, uv = trim.at(t);
        near(trim.boundary.at(t).position, surface.at(uv.x, uv.y).position, 1e-6);
      }
    });
    assert.equal(result.vertices.length, source.vertices.length);
    for (const boundary of result.boundaries) assert.equal(result.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
    validateSweepMesh(result.triangulate());
    assert.ok(Math.abs(volume(result) - volume(source)) < 1e-4);
    assert.equal(source.triangulate(), cached);
  }
});

test('reflection retains authoritative curve/surface samples and periodic native charts', () => {
  const curve = circle(2), parameters = [0, 0.13, 0.5, 0.8, 1];
  curve.sample = () => parameters.map(t => curve.at(t));
  const source = sketch().add(curve).extrude(3), result = source.mirror(YZ);
  for (const boundary of result.boundaries.filter(boundary => boundary instanceof SpatialCurve)) {
    assert.equal(boundary.planarCurve, curve);
    assert.deepEqual(boundary.sampleWithParameters().map(sample => sample.t), parameters);
    for (const t of parameters) near(boundary.at(t).position, boundary.plane.toWorld(curve.at(t)).position);
  }
  const torus = spatialSurface({ periodicU: true, periodicV: true, at: (u, v) => ({ position: [
    (3 + Math.cos(2 * Math.PI * v)) * Math.cos(2 * Math.PI * u),
    (3 + Math.cos(2 * Math.PI * v)) * Math.sin(2 * Math.PI * u), Math.sin(2 * Math.PI * v),
  ] }) });
  const u = [0, 0.2, 0.5, 0.7, 1], v = [0, 0.17, 0.5, 0.8, 1];
  torus.sample = () => ({ u, v, vertices: u.map(a => v.map(b => torus.at(a, b))) });
  const mirrored = new Solid([torus]).mirror(YZ), surface = mirrored.surfaces[0];
  assert.ok(surface.periodicU && surface.periodicV && surface.reversed);
  assert.deepEqual(surface.sample().u, u); assert.deepEqual(surface.sample().v, v);
  assert.deepEqual(mirrored.boundaries, []);
  validateSweepMesh(mirrored.triangulate());
});

test('mirrored children remain lazy and retain source caches with corrected triangle winding', () => {
  class Triangle extends Memo {
    calls = 0;
    triangulateUncached() { this.calls++; return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); }
  }
  const child = new Triangle(), source = new Solid([]).add(child);
  const result = source.mirror(YZ);
  assert.equal(child.calls, 0);
  assert.equal(result.children[0].children[0], child);
  assert.notEqual(result.children, source.children);
  const cache = source.triangulate(), childCache = child.triangulate();
  assert.deepEqual(Array.from(result.triangulate()), [0, 0, 0, 0, 1, 0, -1, 0, 0]);
  assert.equal(child.calls, 1);
  assert.equal(source.triangulate(), cache); assert.equal(child.triangulate(), childCache);
});

test('mirrored solids remain usable for booleans, blends and sketch placement', () => {
  const source = box(), result = source.mirror(YZ.displace([1, 0, 0]));
  assert.ok(Math.abs(volume(result.union(source)) - 36) < 1e-5);
  assert.ok(Math.abs(volume(result.intersect(source)) - 12) < 1e-5);
  assert.ok(Math.abs(volume(result.difference(source)) - 12) < 1e-5);
  validateSweepMesh(result.chamfer({ length: 0.1, boundaries: [0] }).triangulate());
  validateSweepMesh(result.round({ radius: 0.1, boundaries: [0] }).triangulate());
  const cap = result.surfaces.find(face => face.plane.normal[2] > 0.99);
  validateSweepMesh(sketch(cap).add(circle(0.2)).extrude(1).triangulate());
});

test('mirror rejects invalid targets and planes and supports empty solids', () => {
  for (const solid of [undefined, {}, XY]) assert.throws(() => mirror({ solid, plane: XY }), TypeError);
  for (const plane of [undefined, {}, [0, 0, 1]]) assert.throws(() => mirror({ solid: box(), plane }), TypeError);
  const broken = new Plane(); broken.normal[0] = NaN;
  assert.throws(() => box().mirror(broken), RangeError);
  broken.normal[0] = 0; broken.normal[2] = 0;
  assert.throws(() => box().mirror(broken), RangeError);
  assert.equal(new Solid([]).mirror(XY).triangulate().length, 0);
});
