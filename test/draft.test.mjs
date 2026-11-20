import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Circle, Edge, LineSegment, PlanarCurve, Sketch, Solid, SpatialSurface, RuledSurface, XY, ZX, YZ, extrude, planarCurve, radtodeg } from 'libcompass';

const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const circle = (radius, x = 0) => new Circle({ center: { x, y: 0 }, radius });
const rectangle = (width, height) => {
  const points = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }];
  return new Sketch().add(...points.map((start, i) => new LineSegment({ start, end: points[(i + 1) % 4] })));
};
function mesh(body, expectedVolume) {
  const positions = body.triangulate(), edges = new Map();
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const points = [0, 3, 6].map(offset => Array.from(positions.subarray(i + offset, i + offset + 3)));
    const [a, b, c] = points;
    assert.ok(vec3.length(vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], b, a), vec3.subtract([0, 0, 0], c, a))) > 0);
    volume += vec3.dot(a, vec3.cross([0, 0, 0], b, c)) / 6;
    for (let j = 0; j < 3; j++) {
      const a = points[j].join(','), b = points[(j + 1) % 3].join(',');
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(key, [...(edges.get(key) ?? []), a < b ? 1 : -1]);
    }
  }
  for (const directions of edges.values()) assert.deepEqual(directions.sort(), [-1, 1]);
  assert.ok(volume > 0, 'Mesh winding must face outward');
  if (expectedVolume !== undefined) close(volume, expectedVolume, expectedVolume * 0.001);
  for (const boundary of body.boundaries) assert.equal(body.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  return positions;
}

function wallAngle(wall, axis, angleRAD) {
  for (const u of [0.13, 0.37, 0.71]) for (const v of [0.2, 0.8]) {
    const step = 1e-5;
    const du = vec3.subtract([0, 0, 0], wall.at(u + step, v).position, wall.at(u - step, v).position);
    const dv = vec3.subtract([0, 0, 0], wall.at(u, v + step).position, wall.at(u, v - step).position);
    const normal = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], du, dv));
    close(Math.abs(vec3.dot(normal, vec3.normalize([0, 0, 0], axis))), Math.abs(Math.sin(angleRAD)), 1e-6);
  }
}

test('curve tangents have numerical defaults and exact evaluators or method overrides', () => {
  const curve = planarCurve({ at: t => ({ x: t, y: t * t }) });
  for (const t of [0, 0.3, 1]) {
    const tangent = curve.tangent(t), length = Math.hypot(1, 2 * t);
    close(tangent[0], 1 / length); close(tangent[1], 2 * t / length);
  }
  let calls = 0;
  const exact = planarCurve({ at: t => ({ x: t * t, y: 0 }), tangent: () => { calls++; return [4, 0]; } });
  assert.deepEqual(exact.tangent(0), [1, 0]); assert.equal(calls, 1);
  curve.tangent = () => [0, 1]; assert.deepEqual(curve.tangent(0), [0, 1]);
  for (const t of [-1, 2, NaN]) assert.throws(() => exact.tangent(t), RangeError);
  assert.throws(() => planarCurve({ at: () => ({ x: 0, y: 0 }) }).tangent(0.5), /tangent/);
  assert.throws(() => planarCurve({ at: t => ({ x: t, y: 0 }), tangent: () => [NaN, 0] }).tangent(0), /tangent/);
});

test('positive and negative draft produce exact circular frustums on either side of every default plane', () => {
  for (const plane of [XY, ZX, YZ]) for (const angleRAD of [0.15, -0.15]) for (const length of [2, -2]) {
    const body = new Sketch({ plane }).add(circle(3)).extrude({ length, angle: radtodeg(angleRAD) });
    const wall = body.surfaces.find(surface => surface instanceof SpatialSurface);
    const radius = 3 + 2 * Math.tan(angleRAD);
    const expected = plane.toWorld({ x: radius * Math.cos(0.123 * Math.PI * 2), y: radius * Math.sin(0.123 * Math.PI * 2) }).position;
    vec3.scaleAndAdd(expected, expected, plane.normal, length);
    close(vec3.distance(wall.at(0.123, 1).position, expected), 0);
    wallAngle(wall, plane.normal, angleRAD);
    mesh(body, 2 * Math.PI * (9 + 3 * radius + radius * radius) / 3);
  }
});

test('oblique draft keeps a constant wall angle and a planar upper cap', () => {
  const axis = [0.3, -0.2, 1];
  for (const angleRAD of [-0.1, 0.1]) for (const length of [-1, 1]) {
    const body = extrude({ sketch: new Sketch().add(circle(3)), axis, length, angle: radtodeg(angleRAD) });
    const wall = body.surfaces.find(surface => surface instanceof SpatialSurface);
    wallAngle(wall, axis, angleRAD);
    const upperPlane = body.surfaces[1].plane;
    for (const t of [0.13, 0.45, 0.82]) close(vec3.dot(upperPlane.normal, vec3.subtract([0, 0, 0], wall.at(t, 1).position, upperPlane.origin)), 0);
    mesh(body);
  }
});

test('rectangle draft offsets every wall equally instead of scaling the whole profile', () => {
  const angleRAD = Math.atan(0.25), body = rectangle(8, 4).extrude({ length: 2, angle: radtodeg(angleRAD) });
  const upper = body.vertices.filter(vertex => vertex.position[2] === 2).map(vertex => Array.from(vertex.position));
  assert.deepEqual(upper, [[-0.5, -0.5, 2], [8.5, -0.5, 2], [8.5, 4.5, 2], [-0.5, 4.5, 2]]);
  for (const surface of body.surfaces.slice(2)) close(Math.abs(surface.plane.normal[2]), Math.sin(angleRAD));
  mesh(body, 64 + 12 + 2 / 3);
});

test('inward draft clamps to a shared apex, omits the cap, and produces no degenerate triangles', () => {
  for (const length of [-10, 10]) {
    const body = new Sketch().add(circle(3, 2)).extrude({ length, angle: -45 });
    assert.equal(body.surfaces.length, 2); assert.equal(body.boundaries.length, 1); assert.equal(body.vertices.length, 2);
    const wall = body.surfaces[1], apex = wall.end;
    close(apex.position[0], 2); close(apex.position[1], 0); close(apex.position[2], Math.sign(length) * 3);
    assert.equal(wall.at(0.17, 1), apex); assert.ok(body.vertices.includes(apex));
    wallAngle(wall, [0, 0, 1], -Math.PI / 4);
    mesh(body, 9 * Math.PI);
  }
  const pyramid = rectangle(4, 4).extrude({ length: 10, angle: -45 });
  assert.equal(pyramid.vertices.length, 5); assert.equal(pyramid.surfaces.length, 5);
  assert.equal(pyramid.vertices.filter(vertex => Math.abs(vertex.position[2] - 2) < 1e-8).length, 1);
  mesh(pyramid, 32 / 3);
});

test('clamping applies to the entire extrusion when the first disconnected profile reaches an apex', () => {
  const body = new Sketch().add(circle(1), circle(3, 10)).extrude({ length: 10, angle: -45 });
  close(Math.max(...body.vertices.map(vertex => vertex.position[2])), 1);
  mesh(body, Math.PI / 3 + 19 * Math.PI / 3);
});

test('material expansion shrinks holes and contraction grows them', () => {
  for (const angleRAD of [0.1, -0.1]) {
    const body = new Sketch().add(circle(5), circle(1)).extrude({ length: 1, angle: radtodeg(angleRAD) });
    const walls = body.surfaces.filter(surface => surface instanceof SpatialSurface);
    close(Math.hypot(...walls[0].at(0, 1).position.slice(0, 2)), 5 + Math.tan(angleRAD));
    close(Math.hypot(...walls[1].at(0, 1).position.slice(0, 2)), 1 - Math.tan(angleRAD));
    mesh(body, Math.PI * (24 + 6 * Math.tan(angleRAD)));
  }
});

test('general smooth loops retain their equations and custom sampling through draft', () => {
  const curve = new PlanarCurve({ at: t => {
    const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI;
    return { x: 3 * Math.cos(angleRAD), y: 2 * Math.sin(angleRAD) };
  } });
  let calls = 0;
  curve.sample = () => { calls++; return Array.from({ length: 257 }, (_, i) => curve.at(i / 256)); };
  curve.sampleParameters = () => { throw new Error('Must respect sample() overrides'); };
  const body = new Sketch().add(curve).extrude({ length: 1, angle: radtodeg(0.1) });
  const wall = body.surfaces.find(surface => surface instanceof SpatialSurface);
  assert.ok(calls > 0); wallAngle(wall, [0, 0, 1], 0.1); mesh(body);
  const p = curve.at(0.123), tangent = curve.tangent(0.123), top = wall.at(0.123, 1).position;
  close(top[0], p.x + Math.tan(0.1) * tangent[1]); close(top[1], p.y - Math.tan(0.1) * tangent[0]);
});

test('apex patches also support open rims and collect the apex in solid topology', () => {
  const start = new Edge({ start: { position: [0, 0, 0] }, end: { position: [1, 0, 0] } });
  const apex = { position: [0, 0, 1] }, wall = new RuledSurface({ start, end: apex });
  assert.equal(wall.boundaries.length, 3); assert.equal(wall.triangulate().length, 9);
  assert.equal(new Solid({ surfaces: [wall] }).vertices.length, 3);
});

test('draft refines matching rim samples to retain the triangulation deviation target', () => {
  for (const [rx, ry] of [[1, 1], [9, 1]]) {
    const curve = new PlanarCurve({ at: t => ({ x: rx * Math.cos((t === 1 ? 0 : t) * 2 * Math.PI), y: ry * Math.sin((t === 1 ? 0 : t) * 2 * Math.PI) }) });
    const body = new Sketch().add(curve).extrude({ length: 1, angle: radtodeg(Math.atan(0.25)) });
    const wall = body.surfaces.find(surface => surface instanceof SpatialSurface);
    const lower = wall.start.sample(), upper = wall.end.sample();
    assert.equal(lower.length, upper.length);
    const parameters = lower.map((point, i) => i === lower.length - 1 ? 1 : (Math.atan2(point.position[1] / ry, point.position[0] / rx) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI));
    for (let i = 0; i + 1 < upper.length; i++) {
      const middle = wall.end.at((parameters[i] + parameters[i + 1]) / 2).position;
      const chord = vec3.lerp([0, 0, 0], upper[i].position, upper[i + 1].position, 0.5);
      assert.ok(vec3.distance(middle, chord) <= 0.001, `${vec3.distance(middle, chord)} exceeds resolution`);
    }
  }
});

test('zero draft preserves extrusion, and unsupported draft geometry fails explicitly', () => {
  const s = new Sketch().add(circle(3));
  assert.deepEqual(s.extrude({ length: 2 }).triangulate(), s.extrude({ length: 2, angle: 0 }).triangulate());
  for (const angleRAD of [NaN, Infinity, -Infinity, Math.PI / 2, -Math.PI / 2, Math.PI]) assert.throws(() => s.extrude({ length: 1, angle: radtodeg(angleRAD) }), /angle/);
  assert.throws(() => s.extrude({ axis: [1, 0, 0.1], length: 1, angle: radtodeg(0.3) }), /angle/);
  const start = { x: 1, y: 0 }, end = { x: -1, y: 0 };
  const arc = new PlanarCurve({ at: t => t === 0 ? start : t === 1 ? end : { x: Math.cos(t * Math.PI), y: Math.sin(t * Math.PI) } });
  const mixed = new Sketch().add(arc, new LineSegment({ start: end, end: start }));
  assert.throws(() => mixed.extrude({ length: 1, angle: radtodeg(0.1) }), /trimming/);
  assert.throws(() => rectangle(8, 4).extrude({ length: 10, angle: -45 }), /trimming/);
  const ellipse = new PlanarCurve({ at: t => ({ x: 3 * Math.cos((t === 1 ? 0 : t) * Math.PI * 2), y: 2 * Math.sin((t === 1 ? 0 : t) * Math.PI * 2) }) });
  assert.throws(() => new Sketch().add(ellipse).extrude({ length: 10, angle: -45 }), /trimming/);
  assert.throws(() => new Sketch().add(circle(1), circle(2, 4)).extrude({ length: 2, angle: 45 }), /trimming/);
});
