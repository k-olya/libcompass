import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { Edge, Face, Memo, Solid, SpatialCurve, SpatialSurface, SurfaceRegion, XY, ZX, X, Y, Z, center,
  circle, lineSegment, planarCurve, polyline, rectangle, roundPolyline, setTriangulationResolution, sketch } from 'libcompass';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';
import { surfaceFrame } from '../dist/internal/surfaceGeometry.js';

const box = (plane = XY, length = 10) => sketch(plane).add(rectangle({ width: 10, height: 10 })).extrude(length);
const halfCylinder = () => {
  const arc = planarCurve(t => ({ x: 5 * Math.cos(Math.PI * t), y: t === 0 || t === 1 ? 0 : 5 * Math.sin(Math.PI * t) }));
  return sketch().add(arc, lineSegment({ start: arc.end, end: arc.start })).extrude(10);
};
const close = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
function check(solid) {
  const positions = solid.triangulate(); validateSweepMesh(positions);
  for (const boundary of solid.boundaries) assert.equal(solid.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) volume += vec3.dot(positions.subarray(i, i + 3), vec3.cross([0, 0, 0], positions.subarray(i + 3, i + 6), positions.subarray(i + 6, i + 9))) / 6;
  return volume;
}

setTriangulationResolution(0.0128);

test('bevels at the thickness limit consume a wall and reuse the opposite boundary', () => {
  const thickness = 2;
  const profiles = [rectangle({ center, width: 20, height: 20 }),
    roundPolyline({ segments: rectangle({ center, width: 160, height: 160 }), radius: thickness * 4 })];
  for (const profile of profiles) {
    const source = sketch().add(profile).extrude(thickness), cached = source.triangulate(), snapshot = cached.slice();
    const opposite = source.surfaces[1];
    for (const operation of ['chamfer', 'round']) {
      const result = source[operation]({ length: thickness, radius: thickness, boundaries: [0] });
      assert.ok(check(result) < check(source));
      assert.ok(result.surfaces.includes(opposite));
      for (const boundary of opposite.boundaries) assert.ok(result.boundaries.includes(boundary));
      assert.equal(result.surfaces.length, profile === profiles[0] ? 6 : 3);
      assert.throws(() => source[operation]({ length: thickness + 0.02, radius: thickness + 0.02, boundaries: [0] }), RangeError);
    }
    assert.equal(source.triangulate(), cached); assert.deepEqual(cached, snapshot);
  }
});

test('bevels handle individual and connected selections on an open rounded profile closed by a straight segment', () => {
  const width = 160, height = 80, thickness = 2, radius = 8, tolerance = 0.5;
  const left = -width / 2 + radius + tolerance / 2, right = -left;
  const source = sketch(ZX.displace([0, width / 2 - thickness * 2, 0])
    .rotate({ axis: Y, angle: -90 }).rotate({ axis: Z, angle: 180 }))
    .add(roundPolyline({ segments: polyline({ points: [
      { x: left, y: thickness }, { x: left, y: height - tolerance },
      { x: -radius * 2, y: height - tolerance }, { x: 0, y: height - radius * 2 },
      { x: radius * 2, y: height - tolerance }, { x: right, y: height - tolerance },
      { x: right, y: thickness },
    ] }), radius: radius / 2 }), lineSegment({ start: { x: right, y: thickness }, end: { x: left, y: thickness } }))
    .extrude(thickness * 2);
  const cached = source.triangulate(), snapshot = cached.slice(), volume = check(source);
  assert.equal(source.boundaries.length, 6);
  for (const operation of ['chamfer', 'round']) for (let index = 0; index < source.boundaries.length; index++) {
    const result = source[operation]({ length: 1, radius: 1, boundaries: [index] });
    assert.ok(check(result) < volume, `${operation} boundary ${index}`);
  }
  for (const operation of ['chamfer', 'round']) {
    for (const boundaries of [[0, 1], [0, 4], [1, 4], [0, 1, 4], [1, 3, 4, 5], []]) {
      const result = source[operation]({ length: 1, radius: 1, boundaries });
      assert.ok(check(result) < volume, `${operation} connected boundaries ${boundaries}`);
    }
    assert.ok(check(source[operation]()) < volume, `${operation} defaults`);
  }
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, snapshot);
});

test('two adjacent rounds meet in one exact miter curve, including rotated and reversed solids', () => {
  for (const [plane, length] of [[XY, 10], [XY.rotate({ axis: X, angle: 31 }).displace([7, -2, 3]), -10]]) {
    const source = box(plane, length), selections = source.surfaces[0].boundaries.slice(0, 2), radius = 0.6;
    const result = source.round({ radius, boundaries: selections });
    assert.ok(check(result) < check(source));
    const blends = result.surfaces.slice(-2), joint = blends[0].boundaries.filter(boundary => blends[1].boundaries.includes(boundary));
    assert.equal(joint.length, 1); assert.ok(joint[0] instanceof SpatialCurve);
    for (let i = 0; i < blends.length; i++) {
      const support = source.surfaces.filter(surface => surface.boundaries.includes(selections[i]));
      const normals = support.map(face => face.plane.normal), cosine = vec3.dot(...normals);
      const center = vec3.scaleAndAdd([0, 0, 0], selections[i].start.position, vec3.add([0, 0, 0], ...normals), -radius / (1 + cosine));
      const direction = vec3.normalize([0, 0, 0], vec3.subtract([0, 0, 0], selections[i].end.position, selections[i].start.position));
      for (const u of [0, 0.13, 0.7, 1]) for (const v of [0, 0.17, 0.63, 1]) {
        const delta = vec3.subtract([0, 0, 0], blends[i].at(u, v).position, center);
        close(vec3.length(vec3.scaleAndAdd([0, 0, 0], delta, direction, -vec3.dot(delta, direction))), radius);
      }
      for (const v of [0, 1]) close(vec3.dot(surfaceFrame(blends[i], { x: 0.4, y: v }).normal, normals[v]), 1);
    }
    check(source.round({ radius, boundaries: source.surfaces[0] }));
  }
  const points = Array.from({ length: 9 }, (_, i) => ({ x: 10 * Math.cos(2 * Math.PI * i / 9), y: 10 * Math.sin(2 * Math.PI * i / 9) }));
  const polygon = sketch().add(polyline({ points: [...points, points[0]] })).extrude(5);
  check(polygon.round({ radius: 0.6, boundaries: polygon.surfaces[0] }));
});

test('connected blends intersect curved supports and close unequal strip ends on the remaining support', () => {
  const source = sketch().add(planarCurve(t => ({ x: -2 + 4 * t, y: -4 * t * (1 - t) })),
    planarCurve(t => ({ x: 2 - 4 * t, y: 4 * t * (1 - t) }))).extrude(4);
  const cached = source.triangulate(), snapshot = cached.slice(), original = check(source);
  for (const operation of ['chamfer', 'round']) for (const boundaries of [[0, 1], [0, 4], [4, 0], []]) {
    const result = source[operation]({ radius: 0.2, length: 0.2, boundaries });
    assert.ok(check(result) < original);
    if (boundaries.length) assert.ok(result.surfaces.some(surface => surface instanceof SurfaceRegion));
  }
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, snapshot);
  const oblique = sketch().add(rectangle({ width: 10, height: 10 })).extrude({ length: 8, axis: [0.4, 0.2, 1] });
  check(oblique.round({ radius: 0.3, boundaries: oblique.surfaces[0].boundaries.slice(0, 2) }));
});

test('isolated rounds and chamfers trim curved end surfaces in their original charts', () => {
  setTriangulationResolution(0.001);
  const source = halfCylinder(), edge = source.boundaries.find(boundary => boundary instanceof Edge
    && boundary.start.position[2] === 0 && boundary.end.position[2] === 0);
  const curved = source.surfaces.find(surface => surface instanceof SpatialSurface);
  const cached = source.triangulate(), saved = cached.slice();
  for (const operation of ['round', 'chamfer']) {
    const result = source[operation]({ radius: 0.3, length: 0.3, boundaries: edge });
    assert.ok(check(result) < check(source));
    const region = result.surfaces.find(surface => surface instanceof SurfaceRegion);
    assert.equal(region.surface, curved);
    const blend = result.surfaces.at(-1);
    for (const arc of [blend.sides.u0, blend.sides.u1]) {
      assert.ok(region.boundaries.includes(arc));
      for (const point of arc.sample()) close(point.position[0] ** 2 + point.position[1] ** 2, 25);
    }
    const moved = result.rotate({ axis: X, angle: 23 }).displace([3, 4, 5]); check(moved);
  }
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, saved);
  setTriangulationResolution(0.0128);
});

test('three selected curved-support rounds share a tangent ball at every corner', () => {
  const curves = [planarCurve(t => ({ x: -2 + 4 * t, y: -4 * t * (1 - t) })),
    planarCurve(t => ({ x: 2 - 4 * t, y: 4 * t * (1 - t) }))];
  const lens = sketch().add(curves).extrude(4);
  const radius = 0.2, sourceMesh = lens.triangulate(), result = lens.round({ radius });
  assert.equal(result.surfaces.length, 14); assert.ok(check(result) < check(lens));
  for (const sphere of result.surfaces.slice(-4)) {
    const uv = { x: 0.37, y: 0.43 }, normal = surfaceFrame(sphere, uv).normal;
    const center = vec3.scaleAndAdd([0, 0, 0], sphere.at(uv.x, uv.y).position, normal, -radius);
    for (const u of [0, 0.17, 0.5, 1]) for (const v of [0, 0.3, 0.8, 1]) close(vec3.distance(sphere.at(u, v).position, center), radius);
  }
  assert.equal(lens.triangulate(), sourceMesh);
  check(halfCylinder().round({ radius }));
  const outer = box(), cap = outer.surfaces.find(surface => surface instanceof Face && surface.plane.normal[2] > 0.99);
  const block = outer.extrudeCut({ sketch: sketch(cap).add(curves), length: -6 });
  const floor = block.surfaces.find(surface => surface instanceof Face && Math.abs(surface.plane.origin[2] - 4) < 1e-6);
  const vertical = block.boundaries.filter(boundary => boundary instanceof Edge && boundary.start.position[2] !== boundary.end.position[2]
    && Math.abs(boundary.start.position[0]) < 3 && Math.abs(boundary.start.position[1]) < 3);
  const concave = block.round({ radius, boundaries: [floor, ...vertical] });
  assert.ok(check(concave) > check(block));
});

test('open curved bevels consume source sampling overrides and intersect oblique end planes', () => {
  const source = halfCylinder(), boundary = source.boundaries.find(boundary => boundary instanceof SpatialCurve);
  let calls = 0;
  boundary.sample = () => { calls++; return [0, 0.07, 0.3, 0.73, 1].map(t => boundary.at(t)); };
  const result = source.chamfer({ boundaries: boundary, length: 0.4 });
  assert.ok(calls > 0); check(result);
  const blend = result.surfaces.at(-1);
  for (const rail of [blend.sides.v0, blend.sides.v1]) for (const t of [0.07, 0.3, 0.73]) {
    assert.ok(rail.sample().some(point => vec3.distance(point.position, rail.at(t).position) < 1e-7));
  }
  const oblique = sketch().add(rectangle({ width: 5, height: 5 })).extrude({ length: 8, axis: [0.4, 0.2, 1] });
  const selected = oblique.boundaries.find(boundary => boundary.start.position[2] !== boundary.end.position[2]);
  check(oblique.chamfer({ boundaries: selected, angle: 30, length: 0.3 }));
});

test('local planar bevels preserve remote parts and allow convex and concave edges in one call', () => {
  const source = sketch().add(polyline({ points: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]].map(([x, y]) => ({ x, y })) })).extrude(10);
  const remote = box().displace([20, 20, 0]), combined = new Solid([...source.surfaces, ...remote.surfaces]);
  const boundaries = source.boundaries.filter(boundary => boundary.start.position[2] !== boundary.end.position[2]);
  const result = combined.chamfer({ boundaries, length: 0.2 });
  for (const surface of remote.surfaces) assert.ok(result.surfaces.includes(surface));
  // Five convex wedges removed; one concave wedge added.
  close(check(result), 1070 - 4 * 10 * 0.2 ** 2 / 2, 1e-4);
  const selected = boundaries.find(boundary => boundary.start.position[0] === 1 && boundary.start.position[1] === 1);
  close(check(combined.chamfer({ boundaries: selected, length: 0.2 })), 1070 + 10 * 0.2 ** 2 / 2, 1e-4);
});

test('validated own meshes are reused, children remain separate, and refresh and resolution changes resample', () => {
  for (const operation of ['round', 'chamfer']) {
    const child = new class extends Memo { triangulateUncached() { return new Float32Array([50, 0, 0, 51, 0, 0, 50, 1, 0]); } }();
    const childCache = child.triangulate();
    const source = sketch().add(circle(2)).extrude(5).add(child), result = source[operation]();
    let calls = 0;
    for (const surface of result.surfaces) if (surface instanceof SpatialSurface) {
      const sample = surface.sample.bind(surface); surface.sample = () => { calls++; return sample(); };
    }
    const mesh = result.triangulate(); assert.equal(calls, 0);
    assert.deepEqual(mesh.slice(-9), childCache); assert.equal(child.triangulate(), childCache);
    result.refresh(); result.triangulate(); assert.ok(calls > 0); assert.equal(child.triangulate(), childCache);
    const fresh = sketch().add(circle(2)).extrude(5)[operation]();
    const coarse = fresh.surfaces.flatMap(surface => surface.boundaries).length;
    setTriangulationResolution(0.001);
    const fine = fresh.triangulate(); validateSweepMesh(fine);
    assert.equal(fresh.surfaces.flatMap(surface => surface.boundaries).length, coarse);
    assert.ok(fine.length > result.triangulate().length);
    setTriangulationResolution(0.0128);
  }
});
