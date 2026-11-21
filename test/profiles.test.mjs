import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Circle, LineSegment, PlanarCurve, Plane, Sketch, SpatialCurve, SpatialSurface } from 'libcompass';
import { setTriangulationResolution } from 'libcompass';

// Precision regressions run at the finest supported setting.
setTriangulationResolution(0.001);

const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const ellipse = (rx, ry, x = 0, clockwise = false) => new PlanarCurve({
  at: t => { const angleRAD = (t === 1 ? 0 : t) * (clockwise ? -2 : 2) * Math.PI; return { x: x + rx * Math.cos(angleRAD), y: ry * Math.sin(angleRAD) }; },
});
function checkMesh(body, expectedVolume) {
  const positions = body.triangulate(), edges = new Map();
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = positions.subarray(i, i + 9);
    volume += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
    const points = [0, 3, 6].map(offset => Array.from(positions.subarray(i + offset, i + offset + 3)).join(','));
    for (let j = 0; j < 3; j++) {
      const a = points[j], b = points[(j + 1) % 3];
      assert.notEqual(a, b);
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(key, [...(edges.get(key) ?? []), a < b ? 1 : -1]);
    }
  }
  for (const directions of edges.values()) assert.deepEqual(directions.sort(), [-1, 1]);
  close(volume, expectedVolume, expectedVolume * 0.003);
  for (const boundary of body.boundaries) {
    assert.equal(body.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  }
}

test('planar loops analyze sampled polylines and retain original curves during extrusion', () => {
  for (const clockwise of [false, true]) {
    const curve = ellipse(3, 2, 7, clockwise);
    let samples = 0;
    const sample = curve.sample.bind(curve);
    curve.sample = () => { samples++; return sample(); };
    close(curve.area(), 6 * Math.PI, 0.01);
    assert.ok(curve.contains({ point: { x: 7, y: 0 } }));
    assert.ok(curve.contains({ point: { x: 9.99, y: 0 } }));
    assert.ok(!curve.contains({ point: { x: 10, y: 0 } }));
    assert.ok(!curve.contains({ point: { x: 10.001, y: 0 } }));
    const body = new Sketch().add(curve).extrude({ length: 2 });
    assert.ok(samples > 0);
    assert.equal(body.surfaces.length, 3);
    assert.ok(body.boundaries.every(boundary => boundary instanceof SpatialCurve && boundary.planarCurve === curve));
  }
  const open = new PlanarCurve({ at: t => ({ x: t, y: t * t }) });
  assert.throws(() => open.area(), /closed/);
  assert.throws(() => open.contains({ point: { x: 0, y: 0 } }), /closed/);
});

test('general loops classify holes, islands, and disconnected regions independently of winding', () => {
  const curves = [ellipse(1, 0.5), ellipse(3, 2, 0, true), ellipse(0.25, 0.2, 0, true), ellipse(1, 1.5, 8)];
  const s = new Sketch().add(...curves);
  const area = Math.PI * (6 - 0.5 + 0.05 + 1.5);
  for (const direction of [[0.3, -0.4, 2], [0.3, -0.4, -2]]) checkMesh(s.extrude({ axis: vec3.normalize([0, 0, 0], direction), length: Math.hypot(...direction) }), area * 2);
});

test('smooth open curve joins work in arbitrary insertion order and direction', () => {
  const points = [{ x: 3, y: 0 }, { x: 0, y: 2 }, { x: -3, y: 0 }, { x: 0, y: -2 }];
  const arcs = points.map((point, i) => new PlanarCurve({ at: t => {
    if (i % 2) t = 1 - t;
    return t === 0 ? point : t === 1 ? points[(i + 1) % 4] : { x: 3 * Math.cos((i + t) * Math.PI / 2), y: 2 * Math.sin((i + t) * Math.PI / 2) };
  } }));
  const body = new Sketch().add(arcs[2], arcs[0], arcs[3], arcs[1]).extrude({ length: 2 });
  assert.equal(body.vertices.length, 2);
  assert.equal(body.boundaries.length, 2);
  assert.equal(body.surfaces.length, 3);
  checkMesh(body, 12 * Math.PI);
});

test('analysis and tessellation delegate sampling without curve-type predicates', () => {
  const curve = ellipse(1, 1);
  let requests = 0;
  curve.sampleParameters = () => { requests++; return [0, 0.25, 0.5, 0.75, 1]; };
  // The sampled diamond, rather than the exact circle, controls classification.
  close(curve.area(), 2);
  assert.ok(!curve.contains({ point: { x: 0.8, y: 0.3 } }));
  const body = new Sketch().add(curve).extrude({ length: 2 });
  checkMesh(body, 4);
  assert.equal(body.triangulate().length / 9, 12);
  assert.ok(requests >= 3);
  const rim = body.boundaries.find(boundary => boundary instanceof SpatialCurve);
  close(rim.at(0.125).position[0], Math.SQRT1_2);
  assert.equal(rim.planarCurve, curve);
  const translated = ellipse(3, 2, 1e6);
  close(translated.area(), 6 * Math.PI, 0.01);
  assert.equal(new Sketch().add(translated).extrude({ length: 1 }).vertices.length, 2);
});

test('mixed open curves and segments share endpoint and boundary identities', () => {
  const start = { x: 2, y: 0 }, end = { x: -2, y: 0 };
  const arc = new PlanarCurve({ at: t => t === 0 ? start : t === 1 ? end : { x: 2 * Math.cos(t * Math.PI), y: Math.sin(t * Math.PI) } });
  const segment = new LineSegment({ start, end }); // Traversed backwards to close the arc.
  for (const elements of [[arc, segment], [segment, arc]]) {
    const s = new Sketch({ plane: new Plane({ a: [0, 0, 0], b: [1, 0, 0], c: [0, 0, 1] }) }).add(...elements);
    for (const direction of [[0.2, 2, 0.3], [0.2, -2, 0.3]]) {
      const body = s.extrude({ axis: vec3.normalize([0, 0, 0], direction), length: Math.hypot(...direction) });
      assert.equal(body.vertices.length, 4);
      assert.equal(body.surfaces.filter(surface => surface instanceof SpatialSurface).length, 1);
      for (const boundary of body.boundaries) {
        assert.ok(body.vertices.includes(boundary.start));
        assert.ok(body.vertices.includes(boundary.end));
      }
      checkMesh(body, 2 * Math.PI);
    }
  }
});

test('polyline analysis rejects crossings, self-intersections, and open profiles', () => {
  for (const offset of [0, 1, 2]) {
    assert.throws(() => new Sketch().add(ellipse(1, 2), ellipse(1, 2, offset)).extrude({ length: 1 }), RangeError);
  }
  checkMesh(new Sketch().add(ellipse(1, 2), ellipse(1, 2, 2.001)).extrude({ length: 1 }), 4 * Math.PI);
  const eight = new PlanarCurve({ at: t => { const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI; return { x: Math.sin(angleRAD), y: Math.sin(2 * angleRAD) }; } });
  assert.throws(() => new Sketch().add(eight).extrude({ length: 1 }), RangeError);
  const open = new PlanarCurve({ at: t => ({ x: t, y: t * t }) });
  assert.throws(() => new Sketch().add(open).extrude({ length: 1 }), /closed/);
  const a = { x: 0, y: 0 }, b = { x: 1, y: 0 };
  const crossing = new PlanarCurve({ at: t => t === 0 ? a : t === 1 ? b : { x: t, y: Math.sin(t * 2 * Math.PI) } });
  assert.throws(() => new Sketch().add(crossing, new LineSegment({ start: b, end: a })).extrude({ length: 1 }), RangeError);
  const circle = new Circle({ center: { x: 0, y: 0 }, radius: 2 });
  close(circle.area(), 4 * Math.PI, 0.01);
  assert.ok(!circle.contains({ point: { x: 2, y: 0 } }));
  assert.equal('intersects' in circle, false);
  assert.equal('derivative' in circle, false);
});

test('oscillating curves can override only sample through analysis, lifting, and tessellation', () => {
  let calls = 0;
  class OscillatingCurve extends PlanarCurve {
    constructor() {
      super({ at: t => {
        const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI;
        const radius = 0.02 + 0.005 * Math.sin(16 * angleRAD);
        return { x: radius * Math.cos(angleRAD), y: radius * Math.sin(angleRAD) };
      } });
    }
    sample() { calls++; return Array.from({ length: 257 }, (_, i) => this.at(i / 256)); }
  }
  const curve = new OscillatingCurve();
  assert.ok(curve.sampleParameters().length < curve.sample().length);
  curve.sampleParameters = () => { throw new Error('Consumers must call sample()'); };
  const plane = new Plane({ a: [2, -3, 4], b: [3, -3, 4], c: [2, -3, 5] });
  const lifted = SpatialCurve.fromPlanarCurve({ curve, plane });
  const points = curve.sample(), vertices = lifted.sample();
  assert.equal(vertices.length, points.length);
  points.forEach((point, i) => assert.deepEqual(vertices[i].position, plane.toWorld(point).position));
  assert.equal(vertices[0], lifted.start);
  assert.equal(vertices.at(-1), lifted.end);
  const body = new Sketch({ plane }).add(curve).extrude({ length: 1 });
  checkMesh(body, curve.area());
  assert.equal(body.triangulate().length / 9, 4 * 256 - 4);
  assert.ok(calls >= 5);
  assert.ok(body.boundaries.every(boundary => boundary instanceof SpatialCurve && boundary.planarCurve === curve));
});
