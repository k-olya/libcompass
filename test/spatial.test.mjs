import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Circle, Edge, Face, PlanarCurve, Plane, Sketch, Solid, SpatialCurve, SpatialSurface, RuledSurface, Surface, TRIANGULATION_RESOLUTION, spatialCurveFromPlanar, spatialCurve, ruledSurface } from 'libcompass';
import { setTriangulationResolution } from 'libcompass';

// Precision regressions run at the finest supported setting.
setTriangulationResolution(0.001);

const close = (actual, expected, tolerance = 1e-11) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const rim = (radius, z = 0) => spatialCurveFromPlanar({ curve: new Circle({ center: { x: 0, y: 0 }, radius }), plane: new Plane({ a: [0, 0, z], b: [1, 0, z], c: [0, 1, z] }) });

function assertWatertight(positions) {
  const edges = new Map();
  for (let i = 0; i < positions.length; i += 9) {
    const vertices = [0, 3, 6].map(offset => Array.from(positions.subarray(i + offset, i + offset + 3)).join(','));
    for (let j = 0; j < 3; j++) {
      const a = vertices[j], b = vertices[(j + 1) % 3];
      assert.notEqual(a, b);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const value = edges.get(key) ?? [];
      value.push(a < b ? 1 : -1); edges.set(key, value);
    }
  }
  for (const directions of edges.values()) assert.deepEqual(directions.slice().sort(), [-1, 1]);
}

test('circular curves preserve exact radii and canonical loop endpoints', () => {
  assert.equal(TRIANGULATION_RESOLUTION, 0.001);
  const radius = 3.123456789123;
  const curve = rim(radius);
  assert.ok(curve.isLoop());
  assert.equal(curve.at(0), curve.start);
  assert.equal(curve.at(1), curve.end);
  assert.equal(curve.start, curve.end);
  const t = 0.123456789;
  close(curve.at(t).position[0], radius * Math.cos(2 * Math.PI * t));
  close(curve.at(t).position[1], radius * Math.sin(2 * Math.PI * t));
  const vertices = curve.sample();
  assert.equal(vertices[0], curve.start);
  assert.equal(vertices.at(-1), curve.end);
  for (let i = 0; i + 1 < vertices.length; i++) {
    const a = vertices[i].position, b = vertices[i + 1].position;
    const error = radius - Math.hypot((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    assert.ok(error <= TRIANGULATION_RESOLUTION + 1e-12);
  }
  assert.ok(rim(radius * 4).sample().length > vertices.length);
});

test('procedural curves evaluate and sample in space without becoming polylines', () => {
  const start = { position: [0, 0, 0] }, end = { position: [1, 1, 1] };
  const curve = spatialCurve({ at: t => ({ position: [t, t * t, t * t * t] }), start, end });
  assert.ok(curve instanceof SpatialCurve);
  assert.equal(curve.isLoop(), false);
  assert.equal(curve.at(0), start);
  assert.equal(curve.at(1), end);
  const samples = curve.sample();
  assert.ok(samples.length > 8);
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i].position, b = samples[i + 1].position;
    const middle = curve.at((a[0] + b[0]) / 2).position;
    assert.ok(Math.hypot(...middle.map((value, j) => value - (a[j] + b[j]) / 2)) <= TRIANGULATION_RESOLUTION);
  }
  for (const t of [-1, 2, NaN, Infinity]) assert.throws(() => curve.at(t), RangeError);
  assert.throws(() => spatialCurve({ at: () => ({ position: [NaN, 0, 0] }) }), RangeError);
  assert.throws(() => spatialCurve({ at: t => ({ position: [t, 0, 0] }), end: start }), RangeError);
  const edge = new Edge({ start, end });
  assert.deepEqual(edge.sample(), [start, end]);
  assert.equal(edge.isLoop(), false);
});

test('extrusion samples analysis polylines but retains original topology without meshing', () => {
  const s = new Sketch().add(new Circle({ center: { x: 2, y: -3 }, radius: 2.123456789123 }));
  const originalSurfaceMesh = Surface.triangulateAll;
  const direction = [0.3, -0.7, 4];
  const axis = vec3.normalize([0, 0, 0], direction), length = Math.hypot(...direction);
  let body;
  try {
    Surface.triangulateAll = () => { throw new Error('Meshed during extrusion'); };
    body = s.extrude({ axis, length });
  } finally {
    Surface.triangulateAll = originalSurfaceMesh;
  }
  assert.equal(body.surfaces.length, 3);
  assert.equal(body.boundaries.length, 2);
  assert.equal(body.vertices.length, 2);
  assert.ok(body.surfaces.every(surface => surface instanceof Surface));
  const wall = body.surfaces.find(surface => surface instanceof SpatialSurface);
  const point = wall.at(0.123456789, 0.43).position;
  const lower = wall.start.at(0.123456789).position;
  point.forEach((value, i) => close(value, lower[i] + direction[i] * 0.43));
  axis[2] = 99; s.elements.length = 0;
  close(wall.at(0.123456789, 0.43).position[2], 4 * 0.43);
  const boundaries = [...body.boundaries], vertices = [...body.vertices];
  assertWatertight(body.triangulate());
  assert.deepEqual(body.boundaries, boundaries); assert.deepEqual(body.vertices, vertices);
  assert.equal(body.triangulate(), body.triangulate());
  assert.ok(body.surfaces.filter(surface => surface instanceof Face).every(cap => cap.boundaries.includes(wall.start) || cap.boundaries.includes(wall.end)));
});

test('ruled surfaces synchronize differently sampled rims with their planar caps', () => {
  const start = rim(1), end = rim(4, 3);
  assert.notEqual(start.sample().length, end.sample().length);
  const wall = ruledSurface({ start, end });
  const bottom = new Face({ outer: [start], plane: new Plane({ a: [0, 0, 0], b: [1, 0, 0], c: [0, -1, 0] }) });
  const top = new Face({ outer: [end] });
  const body = new Solid({ surfaces: [bottom, top, wall] });
  assertWatertight(body.triangulate());
  close(wall.at(0.25, 0.5).position[1], 2.5);
  close(wall.at(0.25, 0.5).position[2], 1.5);
  assert.throws(() => wall.at(0, -1), RangeError);
  assert.throws(() => new Sketch({ plane: wall }), TypeError);
  assert.throws(() => Sketch.fromFace(wall), TypeError);
  assert.equal(new Sketch({ plane: top }).plane, top.plane);
});

test('general parametric ellipses lift into a watertight solid without circle metadata', () => {
  const ellipse = { at(t) {
    const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI;
    return { x: 3 * Math.cos(angleRAD), y: 2 * Math.sin(angleRAD) };
  } };
  const start = SpatialCurve.fromPlanarCurve({ curve: ellipse });
  const end = SpatialCurve.fromPlanarCurve({ curve: ellipse, plane: new Plane({ a: [0, 0, 4], b: [1, 0, 4], c: [0, 1, 4] }) });
  const body = new Solid({ surfaces: [
    new Face({ outer: [start], plane: new Plane({ a: [0, 0, 0], b: [1, 0, 0], c: [0, -1, 0] }) }),
    new Face({ outer: [end] }),
    new RuledSurface({ start, end }),
  ] });
  assert.ok(start.planarCurve instanceof PlanarCurve);
  assert.equal('circle' in start, false);
  assert.equal(body.boundaries.length, 2);
  assert.equal(body.vertices.length, 2);
  const positions = body.triangulate();
  assertWatertight(positions);
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(i, i + 9);
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  close(volume, 24 * Math.PI, 0.1);
});

test('curved extrusion winding remains outward on tilted planes and negative displacements', () => {
  const plane = new Plane({ a: [0, 0, 2], b: [1, 0, 2], c: [0, 0, 3] });
  for (const direction of [[0.3, -3, 0.7], [-0.2, 3, -0.5]]) {
    const body = new Sketch({ plane }).add(
      new Circle({ center: { x: 0, y: 0 }, radius: 2 }),
      new Circle({ center: { x: 0, y: 0 }, radius: 1 }),
    ).extrude({ axis: vec3.normalize([0, 0, 0], direction), length: Math.hypot(...direction) });
    const positions = body.triangulate();
    assertWatertight(positions);
    let volume = 0;
    for (let i = 0; i < positions.length; i += 9) {
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(i, i + 9);
      volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    }
    close(volume, Math.PI * 3 * 3, 0.06);
  }
});

test('faces accept mixed straight and curved trims without replacing analytic boundaries', () => {
  const start = { position: [1, 0, 0] }, end = { position: [-1, 0, 0] };
  const arc = spatialCurve({ at: t => ({ position: [Math.cos(Math.PI * t), Math.sin(Math.PI * t), 0] }), start, end });
  const edge = new Edge({ start: end, end: start });
  const face = new Face({ outer: [arc, edge] });
  assert.equal(face.outer[0], arc);
  assert.equal(face.boundaries[1], edge);
  assert.ok(face.triangulate().length > 0);
  assert.equal(new Sketch({ plane: face }).plane, face.plane);
  const sketch = Sketch.fromFace(face);
  assert.equal(sketch.plane, face.plane);
  assert.deepEqual(sketch.elements, []);
});

test('circle profiles use approximate polyline validation', () => {
  const circle = (x, radius) => new Circle({ center: { x, y: 0 }, radius });
  for (const x of [1.9, 0]) {
    assert.throws(() => new Sketch().add(circle(0, 1), circle(x, 1)).extrude({ length: 1 }), /intersect or touch/);
  }
  const separated = new Sketch().add(circle(0, 1), circle(2.00001, 1)).extrude({ length: 1 });
  assert.equal(separated.surfaces.length, 6);
  const thinRing = new Sketch().add(circle(0, 1), circle(0, 0.99999)).extrude({ length: 1 });
  assert.equal(thinRing.surfaces.length, 4);
  assertWatertight(thinRing.triangulate());
  // Features larger than sampling resolution survive without circle-specific refinement.
  const angleRAD = 0.03;
  const eccentric = new Sketch().add(circle(0, 1), new Circle({
    center: { x: 0.49 * Math.cos(angleRAD), y: 0.49 * Math.sin(angleRAD) }, radius: 0.5,
  })).extrude({ length: 1 });
  assertWatertight(eccentric.triangulate());
});

test('face validation uses custom samples rather than fixed parameter probes', () => {
  const curve = new SpatialCurve({ at: t => {
    const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI;
    return { position: [Math.cos(angleRAD), Math.sin(angleRAD), 0.1 * Math.sin(4 * angleRAD)] };
  } });
  let sampled = false;
  curve.sample = () => { sampled = true; return Array.from({ length: 65 }, (_, i) => curve.at(i / 64)); };
  assert.throws(() => new Face({ outer: [curve], plane: new Plane() }), /plane|planar/i);
  assert.ok(sampled);
});
