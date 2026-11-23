import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { extrudeRotate, sketch, circle, polyline, arc, lineSegment, planarCurve, spatialLine, SpatialSurface, SpatialCurve, Face, Y, X, Z, XY, ZX, setTriangulationResolution, TRIANGULATION_RESOLUTION } from 'libcompass';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const volume = body => {
  const mesh = body.triangulate();
  let volume = 0;
  for (let i = 0; i < mesh.length; i += 9) volume += vec3.dot(mesh.subarray(i, i + 3),
    vec3.cross([0, 0, 0], mesh.subarray(i + 3, i + 6), mesh.subarray(i + 6, i + 9))) / 6;
  return volume;
};
const disk = () => sketch().add(circle({ center: { x: 6, y: 0 }, radius: 1 }));
const diamond = () => sketch().add(polyline({ points: [{ x: 6, y: 1 }, { x: 7, y: 0 }, { x: 6, y: -1 }, { x: 5, y: 0 }], loop: true }));
const cylinderProfile = () => sketch().add(polyline({ points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 3 }, { x: 0, y: 3 }], loop: true }));
const coneProfile = () => sketch().add(polyline({ points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 3 }], loop: true }));
const sphereProfile = () => {
  const rim = arc({ start: { x: 0, y: 1 }, through: { x: 1, y: 0 }, end: { x: 0, y: -1 } });
  return sketch().add(rim, lineSegment({ start: rim.end, end: rim.start }));
};
const closedMesh = body => {
  const positions = body.triangulate(), edges = new Map();
  for (let i = 0; i < positions.length; i += 9) {
    const points = [0, 3, 6].map(offset => Array.from(positions.subarray(i + offset, i + offset + 3)).join(','));
    assert.equal(new Set(points).size, 3);
    for (let j = 0; j < 3; j++) {
      const [a, b] = [points[j], points[(j + 1) % 3]], key = [a, b].sort().join('|');
      const directions = edges.get(key) ?? []; directions.push(a < b ? 1 : -1); edges.set(key, directions);
    }
  }
  for (const directions of edges.values()) assert.deepEqual([...directions].sort(), [-1, 1]);
};

test('rotating a coplanar circle produces an exact torus with no caps or seam boundaries', () => {
  for (const angleDEG of [undefined, 360, -360]) {
    const s = disk(), source = s.elements[0], sample = source.sample, start = source.start;
    const body = extrudeRotate({ sketch: s, axis: Y, angle: angleDEG });
    assert.equal(body.surfaces.length, 1); assert.equal(body.boundaries.length, 0); assert.equal(body.vertices.length, 0);
    const surface = body.surfaces[0];
    assert.ok(surface instanceof SpatialSurface); assert.ok(surface.periodicU && surface.periodicV);
    for (const u of [0, 0.19, 0.6, 1]) for (const v of [0, 0.27, 0.73, 1]) {
      const [x, y, z] = surface.at(u, v).position;
      near((Math.hypot(x, z) - 6) ** 2 + y * y, 1);
      assert.deepEqual(surface.at(u, 0).position, surface.at(u, 1).position);
    }
    const analytic = 2 * Math.PI ** 2 * 6;
    near(volume(body) / analytic, 1, 0.015); closedMesh(body);
    assert.equal(s.elements[0], source); assert.equal(source.sample, sample); assert.equal(source.start, start);
  }
});

test('a diamond revolves into four exact conical walls with shared circular ridge boundaries', () => {
  const body = diamond().extrudeRotate(Y);
  assert.equal(body.surfaces.length, 4); assert.equal(body.boundaries.length, 4);
  assert.ok(body.surfaces.every(surface => surface instanceof SpatialSurface && surface.periodicV && !surface.periodicU));
  assert.ok(body.boundaries.every(boundary => boundary instanceof SpatialCurve && boundary.isLoop()));
  for (const boundary of body.boundaries) assert.equal(body.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  for (const surface of body.surfaces) for (const u of [0, 0.13, 0.7, 1]) for (const v of [0, 0.37, 1]) {
    const [x, y, z] = surface.at(u, v).position;
    near(Math.abs(Math.hypot(x, z) - 6) + Math.abs(y), 1);
  }
  near(volume(body) / (2 * Math.PI * 6 * 2), 1, 0.01); closedMesh(body);
});

test('partial turns honor signed degree angles, preserve the starting placement and have outward caps', () => {
  for (const angleDEG of [90, -90, 210]) for (const makeSketch of [disk, diamond]) {
    const s = makeSketch(), body = s.extrudeRotate({ axis: Y, angle: angleDEG });
    const caps = body.surfaces.filter(surface => surface instanceof Face);
    assert.equal(caps.length, 2);
    near(vec3.dot(caps[0].plane.normal, s.plane.normal), Math.sign(angleDEG));
    const endNormal = s.plane.rotate({ axis: Y, angle: angleDEG }).normal;
    near(vec3.dot(caps[1].plane.normal, endNormal), -Math.sign(angleDEG));
    const analytic = (makeSketch === disk ? Math.PI : 2) * 2 * Math.PI * 6 * Math.abs(angleDEG) / 360;
    near(volume(body) / analytic, 1, 0.02); closedMesh(body);
    for (const boundary of body.boundaries) assert.equal(body.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  }
});

test('rotation axes use their origins and normalized directions on arbitrarily placed sketch planes', () => {
  const axis = spatialLine({ direction: [0, 12, 0], origin: [4, 3, 0] });
  const s = sketch({ plane: XY.displace([4, 0, 0]) }).add(circle({ center: { x: 6, y: 0 }, radius: 1 }));
  const body = s.extrudeRotate(axis);
  for (const u of [0, 0.31, 0.87]) for (const v of [0, 0.2, 0.66]) {
    const [x, y, z] = body.surfaces[0].at(u, v).position;
    near((Math.hypot(x - 4, z) - 6) ** 2 + y * y, 1);
  }
  assert.deepEqual([...axis], [0, 12, 0]); assert.deepEqual(axis.origin, [4, 3, 0]);
  const tilted = sketch({ plane: ZX.rotate({ axis: X, angle: 25 }).displace([3, 4, 5]) })
    .add(circle({ center: { x: 0, y: 6 }, radius: 1 }));
  const tiltedAxis = Z.rotate({ axis: X, angle: 25 }).displace([3, 4, 5]);
  const revolved = tilted.extrudeRotate({ axis: tiltedAxis, angle: -120 });
  near(volume(revolved) / (2 * Math.PI ** 2 * 6 / 3), 1, 0.02); closedMesh(revolved);
});

test('profile holes, islands, reversed winding and curve sampling overrides are retained', () => {
  const s = disk().add(circle({ center: { x: 6, y: 0 }, radius: 0.5 }), circle({ center: { x: 9, y: 0 }, radius: 0.3 }));
  let calls = 0;
  const source = s.elements[0];
  source.sample = () => { calls++; return [0, 0.03, 0.22, 0.41, 0.67, 0.93, 1].map(t => source.at(t)); };
  source.sampleParameters = () => { throw new Error('Must consume sample() overrides'); };
  const body = s.extrudeRotate({ axis: Y, angle: -180 });
  assert.ok(calls > 0);
  const analytic = Math.PI ** 2 * (6 * (1 - 0.25) + 9 * 0.09);
  near(volume(body) / analytic, 1, 0.02); closedMesh(body);
  const reversed = sketch().add(polyline({ points: [{ x: 6, y: 1 }, { x: 5, y: 0 }, { x: 6, y: -1 }, { x: 7, y: 0 }], loop: true }));
  near(volume(reversed.extrudeRotate(Y)) / (2 * Math.PI * 6 * 2), 1, 0.01);
});

test('axis boundaries revolve into closed cylinders, cones and spheres without zero-area walls', () => {
  for (const [makeSketch, analytic, wallCount, boundaryCount] of [
    [cylinderProfile, Math.PI * 4 * 3, 3, 2],
    [coneProfile, Math.PI * 4, 2, 1],
    [sphereProfile, 4 * Math.PI / 3, 1, 0],
  ]) for (const angleDEG of [360, -360, 90, -90, 180]) {
    const s = makeSketch(), elements = [...s.elements];
    const body = s.extrudeRotate({ axis: Y, angle: angleDEG }), full = Math.abs(angleDEG) === 360;
    assert.equal(body.surfaces.length, wallCount + (full ? 0 : 2));
    if (full) assert.equal(body.boundaries.length, boundaryCount);
    else {
      const caps = body.surfaces.filter(surface => surface instanceof Face);
      assert.equal(caps.length, 2);
      const shared = caps[0].boundaries.filter(boundary => caps[1].boundaries.includes(boundary));
      assert.equal(shared.length, 1, 'The axis edge is shared by the partial-turn caps');
    }
    near(volume(body) / (analytic * Math.abs(angleDEG) / 360), 1, 0.02); closedMesh(body);
    for (const boundary of body.boundaries) {
      assert.equal(body.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
      assert.ok(boundary.sample().some(point => vec3.distance(point.position, boundary.start.position) > 1e-8), 'No collapsed boundary is retained');
    }
    assert.deepEqual(s.elements, elements);
  }
});

test('a revolved semicircle retains shared exact sphere poles, including through transformations', () => {
  const body = sphereProfile().extrudeRotate(Y), surface = body.surfaces[0];
  assert.equal(surface.poles.length, 2); assert.equal(body.vertices.length, 2);
  assert.equal(surface.periodicU, false); assert.equal(surface.periodicV, true);
  for (const u of [0, 0.17, 0.61, 1]) for (const v of [0, 0.23, 0.78, 1]) near(vec3.length(surface.at(u, v).position), 1);
  for (const u of [0, 1]) {
    assert.equal(surface.at(u, 0), surface.at(u, 0.37));
    assert.ok(body.vertices.includes(surface.at(u, 0)));
  }
  const moved = body.rotate({ axis: X, angle: 31 }).displace([3, 4, 5]);
  assert.equal(moved.vertices.length, 2); assert.notEqual(moved.vertices[0], body.vertices[0]);
  near(volume(moved) / (4 * Math.PI / 3), 1, 0.02); closedMesh(moved);
});

test('generic curve profiles keep sample overrides and form ellipsoids against a moved, tilted axis', () => {
  const rim = planarCurve(t => ({ x: 2 * Math.sin(Math.PI * t), y: 3 * Math.cos(Math.PI * t) }));
  let calls = 0;
  rim.sample = () => { calls++; return [0, 0.03, 0.2, 0.5, 0.82, 1].map(t => rim.at(t)); };
  rim.sampleParameters = () => { throw new Error('Must respect sample() overrides'); };
  const s = sketch({ plane: XY.rotate({ axis: X, angle: 25 }).displace([3, 4, 5]) })
    .add(rim, lineSegment({ start: rim.end, end: rim.start }));
  const axis = Y.rotate({ axis: X, angle: 25 }).displace([3, 4, 5]);
  const body = s.extrudeRotate({ axis, angle: -120 });
  assert.ok(calls > 0);
  near(volume(body) / (4 * Math.PI / 3 * 4 * 3 / 3), 1, 0.02); closedMesh(body);
});

test('sphere poles remain watertight at the finest triangulation resolution', () => {
  const previous = TRIANGULATION_RESOLUTION;
  try {
    setTriangulationResolution(0.001);
    const body = sphereProfile().extrudeRotate(Y);
    closedMesh(body); near(volume(body) / (4 * Math.PI / 3), 1, 0.003);
  } finally { setTriangulationResolution(previous); }
});

test('invalid angles, noncoplanar axes, crossing profiles and nonmanifold pinches throw explicitly', () => {
  for (const angleDEG of [0, 361, -361, Infinity, NaN]) assert.throws(() => disk().extrudeRotate({ axis: Y, angle: angleDEG }), RangeError);
  assert.throws(() => disk().extrudeRotate({ axis: [0, 1, 0] }), TypeError);
  assert.throws(() => disk().extrudeRotate(Z), /sketch plane/);
  assert.throws(() => disk().extrudeRotate(Y.displace([0, 0, 1])), /sketch plane/);
  for (const x of [0, 0.5]) assert.throws(() => sketch().add(circle({ center: { x, y: 0 }, radius: 1 })).extrudeRotate(Y), /one side|fold/);
  assert.throws(() => sketch().add(circle({ center: { x: 1, y: 0 }, radius: 1 })).extrudeRotate(Y), /nonmanifold|manifold|intersect|touch/);
  assert.throws(() => sketch().extrudeRotate(Y), /closed profile/);
});
