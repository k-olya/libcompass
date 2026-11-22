import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { SpatialLine, spatialLine, spatialCurve, spatialCurveFromPlanar, spatialSurface, plane, rotate, displace,
  Plane, Face, RuledSurface, TrimmedSurface, SurfaceRegion, circle, ellipse, rectangle, sketch, solid, Memo, X, Y, Z, XY } from 'libcompass';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const near = (actual, expected, tolerance = 1e-9) => Array.from(actual).forEach((value, i) => close(value, expected[i], tolerance));

test('spatial lines copy vec3 data and work with gl-matrix, array helpers and extrusion', () => {
  const direction = [0, 0, 4], origin = [9, 8, 7];
  const axis = spatialLine({ direction, origin });
  assert.ok(axis instanceof SpatialLine && Array.isArray(axis));
  near(axis, direction); near(axis.origin, origin);
  direction[2] = 99; origin[0] = 99;
  near(axis, [0, 0, 4]); near(axis.origin, [9, 8, 7]);
  assert.deepEqual(axis.slice(), [0, 0, 4]);
  assert.deepEqual(axis.map(value => value * 2), [0, 0, 8]);
  assert.equal(vec3.length(axis), 4);
  assert.deepEqual(vec3.cross([0, 0, 0], X, Y), Array.from(Z));
  const part = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 1 })).extrude({ axis, length: 3 });
  close(Math.max(...part.vertices.map(vertex => vertex.position[2])), 3);
  near(axis, [0, 0, 4]); near(axis.origin, [9, 8, 7]);
  const edge = sketch().add(...rectangle({ corner1: { x: 0, y: 0 }, corner2: { x: 2, y: 1 } })).extrude({ length: 1 }).boundaries[0];
  const movedEdge = edge.rotate({ axis: Z, angle: 90 }).displace({ vector: [1, 2, 3] });
  const [x, y, z] = edge.start.position;
  near(movedEdge.start.position, [1 - y, 2 + x, 3 + z]);
  for (const options of [{ direction: [0, 0, 0] }, { direction: [NaN, 0, 1] },
    { direction: [1, 0, 0], origin: [0, Infinity, 0] }]) assert.throws(() => spatialLine(options), RangeError);
});

test('rotation uses an offset normalized axis and displacement moves origins without changing directions', () => {
  const axis = spatialLine({ direction: [0, 0, 20], origin: [1, 2, 3] });
  const frame = plane({ a: [2, 2, 3], b: [3, 2, 3], c: [2, 3, 3] });
  Object.freeze(frame); for (const v of [frame.origin, frame.xAxis, frame.yAxis, frame.normal]) Object.freeze(v);
  const turned = frame.rotate({ axis, angle: 90 });
  assert.ok(turned instanceof Plane); assert.notEqual(turned, frame);
  near(turned.origin, [1, 3, 3]); near(turned.xAxis, [0, 1, 0]); near(turned.yAxis, [-1, 0, 0]); near(turned.normal, [0, 0, 1]);
  near(frame.origin, [2, 2, 3]); near(axis, [0, 0, 20]); near(axis.origin, [1, 2, 3]);
  const line = spatialLine({ direction: [2, 0, 0], origin: [2, 2, 3] });
  const rotated = line.rotate({ axis, angle: 90 });
  near(rotated, [0, 2, 0]); near(rotated.origin, [1, 3, 3]);
  const moved = line.displace({ vector: [0.25, -4, 2.5] });
  near(moved, line); near(moved.origin, [2.25, -2, 5.5]); near(line.origin, [2, 2, 3]);
  assert.notEqual(moved.origin, line.origin);
  assert.notEqual(displace({ object: frame, vector: [0, 0, 0] }), frame);
  const turnedPlane = rotate({ object: XY, axis: X, angle: 90 });
  near(turnedPlane.normal, [0, -1, 0]);
  assert.ok(sketch({ plane: turnedPlane }).add(circle({ center: { x: 0, y: 0 }, radius: 1 })).extrude({ length: 2 }).triangulate().length > 0);
  const diagonal = rotate({ object: frame, axis: spatialLine({ direction: [5, 5, 5] }), angle: 120 });
  near(diagonal.origin, [3, 2, 2]); near(diagonal.normal, [1, 0, 0]);
});

test('spatial curve transforms retain authoritative sample parameters and lifted plane metadata', () => {
  const source = spatialCurve({ at: t => ({ position: [t, Math.sin(t * 20 * Math.PI), 0] }),
    tangent: t => [1, 20 * Math.PI * Math.cos(t * 20 * Math.PI), 0] });
  const parameters = [0, 0.05, 0.2, 0.5, 0.7, 0.95, 1];
  let calls = 0;
  source.sample = () => { calls++; return parameters.map(t => source.at(t)); };
  const result = source.rotate({ axis: Z, angle: 90 });
  const samples = result.sampleWithParameters();
  assert.equal(calls, 1);
  assert.deepEqual(samples.map(sample => sample.t), parameters);
  for (const { t, point } of samples) {
    const original = source.at(t).position;
    near(point.position, [-original[1], original[0], 0]);
  }
  near(result.tangent(0.2), [-source.tangent(0.2)[1], source.tangent(0.2)[0], 0]);
  assert.equal(samples[0].point, result.start); assert.equal(samples.at(-1).point, result.end);
  const lifted = spatialCurveFromPlanar({ curve: ellipse({ center: { x: 0, y: 0 }, radiusX: 2, radiusY: 1 }) });
  const moved = lifted.displace({ vector: [1, 2, 3] });
  assert.equal(moved.planarCurve, lifted.planarCurve);
  assert.equal(moved.start, moved.end); near(moved.plane.origin, [1, 2, 3]);
  near(moved.at(0.25).position, [1, 3, 3]);
  source.sample = () => [source.start, { position: [0.4, 0, 0] }, source.end];
  assert.throws(() => displace({ object: source, vector: X }).sampleWithParameters(), /sample|parameters/);
});

test('solid transforms preserve shared edge/curve identities, apexes, classes and input caches', () => {
  const sources = [
    sketch().add(...rectangle({ corner1: { x: 0, y: 0 }, corner2: { x: 4, y: 3 } })).extrude({ length: 2 }),
    sketch().add(circle({ center: { x: 0, y: 0 }, radius: 2 })).extrude({ length: 3 }),
    sketch().add(circle({ center: { x: 0, y: 0 }, radius: 2 })).extrude({ length: 3, angle: -45 }),
  ];
  for (const source of sources) {
    const cached = source.triangulate(), bytes = cached.slice();
    const result = source.rotate({ axis: Y, angle: 90 }).displace({ vector: [4, 5, 6] });
    assert.notEqual(result, source); assert.notEqual(result.surfaces, source.surfaces);
    assert.equal(result.surfaces.length, source.surfaces.length);
    assert.equal(result.boundaries.length, source.boundaries.length); assert.equal(result.vertices.length, source.vertices.length);
    for (let i = 0; i < source.surfaces.length; i++) assert.equal(result.surfaces[i].constructor, source.surfaces[i].constructor);
    for (const boundary of result.boundaries) {
      assert.equal(result.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
      assert.ok(result.vertices.includes(boundary.start) && result.vertices.includes(boundary.end));
      assert.ok(!source.boundaries.includes(boundary));
    }
    for (let i = 0; i < source.vertices.length; i++) {
      const [x, y, z] = source.vertices[i].position;
      near(result.vertices[i].position, [z + 4, y + 5, -x + 6]);
    }
    validateSweepMesh(result.triangulate());
    assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
  }
});

test('solid children move under fresh lazy transform nodes without altering their caches', () => {
  class Triangle extends Memo { triangulateUncached() { return new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]); } }
  const child = new Triangle(), source = solid({ surfaces: [] }).add(child);
  const cached = source.triangulate(), childCache = child.triangulate();
  const result = source.displace({ vector: [1, 2, 3] });
  assert.equal(source.children[0], child);
  assert.notEqual(result.children, source.children); assert.equal(result.children[0].children[0], child);
  assert.deepEqual(Array.from(result.triangulate()), [1, 2, 3, 2, 2, 3, 1, 3, 3]);
  assert.equal(source.triangulate(), cached); assert.equal(child.triangulate(), childCache);
  result.children[0].matrix[12] = 10; result.children[0].refresh(); result.refresh();
  assert.equal(result.triangulate()[0], 10);
  assert.equal(source.triangulate(), cached);
});

test('trimmed and boolean surfaces retain charts and remain closed after transforming', () => {
  const cylinder = x => sketch().add(circle({ center: { x, y: 0 }, radius: 2 })).extrude({ length: 3 });
  const chamfered = cylinder(0).chamfer({ boundaries: [0], length: 0.2 });
  assert.ok(chamfered.surfaces.some(surface => surface instanceof TrimmedSurface));
  const sources = [chamfered, cylinder(0).difference({ tool: cylinder(2) })];
  assert.ok(sources[1].surfaces.some(surface => surface instanceof SurfaceRegion));
  for (const source of sources) {
    const result = source.rotate({ axis: Z, angle: 37 }).displace({ vector: [1, 2, 3] });
    const expected = position => vec3.add([0, 0, 0], vec3.rotateZ([0, 0, 0], position, [0, 0, 0], 37 * Math.PI / 180), [1, 2, 3]);
    for (let i = 0; i < source.surfaces.length; i++) {
      const a = source.surfaces[i], b = result.surfaces[i];
      assert.equal(a.constructor, b.constructor);
      const direct = a.rotate({ axis: Z, angle: 37 }).displace({ vector: [1, 2, 3] });
      assert.equal(direct.constructor, a.constructor);
      assert.notEqual(direct, a);
      if (a instanceof Face) near(direct.plane.origin, b.plane.origin);
      else near(direct.at(0.37, 0.61).position, b.at(0.37, 0.61).position);
      if (a instanceof Face) near(b.plane.origin, expected(a.plane.origin));
      else near(b.at(0.37, 0.61).position, expected(a.at(0.37, 0.61).position));
      if (a instanceof SurfaceRegion) {
        assert.notEqual(a.regions, b.regions);
        assert.notEqual(a.regions[0].outer, b.regions[0].outer);
        for (const chart of b.regions) for (const trim of chart.outer) {
          const t = (trim.start ?? 0) + ((trim.end ?? 1) - (trim.start ?? 0)) * 0.5, uv = trim.at(t);
          near(trim.boundary.at(t).position, b.at(uv.x, uv.y).position, 1e-6);
        }
      }
    }
    validateSweepMesh(result.triangulate());
  }
});

test('surface sampling overrides and periodicity survive rotation', () => {
  const source = spatialSurface({ periodicU: true, periodicV: true, reversed: true,
    at: (u, v) => ({ position: [(3 + Math.cos(2 * Math.PI * v)) * Math.cos(2 * Math.PI * u),
      (3 + Math.cos(2 * Math.PI * v)) * Math.sin(2 * Math.PI * u), Math.sin(2 * Math.PI * v)] }) });
  const u = [0, 0.123, 0.5, 1], v = [0, 0.456, 0.8, 1];
  source.sample = () => ({ u, v, vertices: u.map(a => v.map(b => source.at(a, b))) });
  const result = source.rotate({ axis: X, angle: 90 });
  assert.ok(result.periodicU && result.periodicV && result.reversed);
  const grid = result.sample();
  assert.deepEqual(grid.u, u); assert.deepEqual(grid.v, v); assert.notEqual(grid.u, u);
  for (let i = 0; i < u.length; i++) for (let j = 0; j < v.length; j++) {
    const [x, y, z] = source.at(u[i], v[j]).position;
    near(grid.vertices[i][j].position, [x, -z, y]);
  }
});

test('invalid transforms throw without modifying inputs or shared axes', () => {
  const axis = spatialLine({ direction: [1, 0, 0] });
  for (const angleDEG of [NaN, Infinity, -Infinity]) assert.throws(() => rotate({ object: XY, axis, angle: angleDEG }), RangeError);
  assert.throws(() => rotate({ object: XY, axis: [0, 0, 1], angle: 90 }), TypeError);
  assert.throws(() => displace({ object: XY, vector: [NaN, 0, 0] }), RangeError);
  assert.throws(() => displace({ object: circle({ center: { x: 0, y: 0 }, radius: 1 }), vector: X }), TypeError);
  axis[0] = 0;
  assert.throws(() => rotate({ object: XY, axis, angle: 0 }), RangeError);
  near(Z, [0, 0, 1]); near(Z.origin, [0, 0, 0]); near(XY.origin, [0, 0, 0]);
});
