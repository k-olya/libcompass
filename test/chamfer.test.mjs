import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { chamfer, circle, center, extrude, extrudeAlongCurve, Face, lineSegment, node, planarCurve,
  rectangle as rectangleSegments, roundPolyline, RuledSurface, searchBoundaries,
  setTriangulationResolution, sketch, Solid, SpatialCurve, SpatialSurface, TrimmedSurface, X, XY, ZX, YZ, Z } from 'libcompass';
import { chamfer as operationChamfer } from 'libcompass/operations/chamfer';
import { surfaceFrame } from '../dist/internal/surfaceGeometry.js';

setTriangulationResolution(0.001);
const close = (actual, expected, tolerance = 1e-6) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const rectangle = (plane = XY) => {
  const points = [[0, 0], [10, 0], [10, 10], [0, 10]].map(([x, y]) => ({ x, y }));
  return sketch({ plane }).add(...points.map((start, i) => lineSegment({ start, end: points[(i + 1) % points.length] })));
};
const cylinder = (plane = XY, length = 10) => extrude({ sketch: sketch({ plane }).add(circle({ center: { x: 0, y: 0 }, radius: 5 })), length });

function check(solid, expectedVolume) {
  assert.ok(solid instanceof Solid);
  const positions = solid.triangulate(), edges = new Map();
  let volume = 0;
  for (let i = 0; i < positions.length; i += 9) {
    const points = [0, 3, 6].map(j => Array.from(positions.subarray(i + j, i + j + 3)));
    assert.ok(vec3.length(vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], points[1], points[0]), vec3.subtract([0, 0, 0], points[2], points[0]))) > 0);
    volume += vec3.dot(points[0], vec3.cross([0, 0, 0], points[1], points[2])) / 6;
    for (let j = 0; j < 3; j++) {
      const a = points[j].join(','), b = points[(j + 1) % 3].join(','), key = [a, b].sort().join('|');
      edges.set(key, [...(edges.get(key) ?? []), a < b ? 1 : -1]);
    }
  }
  for (const directions of edges.values()) assert.deepEqual(directions.sort(), [-1, 1]);
  for (const boundary of solid.boundaries) assert.equal(solid.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  assert.ok(volume > 0);
  if (expectedVolume !== undefined) close(volume, expectedVolume, Math.max(1e-5, expectedVolume * 0.0005));
  return volume;
}

test('rounded-rectangle pocket lips and the concave floor chamfer together without modifying the input', () => {
  const width = 100, height = 60, radius = 10, wallThickness = 5;
  const part = sketch().add(roundPolyline({ segments: rectangleSegments({ center, width, height }), radius })).extrude(20);
  const face = part.surfaces.find(surface => surface.plane && vec3.equals(surface.plane.normal, Z));
  const cutPart = part.extrudeCut({
    sketch: sketch(face).add(roundPolyline({
      segments: rectangleSegments({ center, width: width - wallThickness * 2, height: height - wallThickness * 2 }),
      radius: radius - wallThickness,
    })), length: -10,
  });
  const child = node(); cutPart.add(child);
  const cached = cutPart.triangulate(), bytes = cached.slice();
  const surfaces = cutPart.surfaces, boundaries = cutPart.boundaries, vertices = cutPart.vertices;
  const coordinates = vertices.map(vertex => [...vertex.position]);
  const selection = ({ face }) => vec3.equals(face.plane.normal, Z);
  const selected = searchBoundaries({ solid: cutPart, boundaries: selection });
  const result = cutPart.chamfer({ length: 1, boundaries: selection });
  assert.equal(selected.length, 3); assert.equal(result.surfaces.length, 8); assert.equal(result.boundaries.length, 7);
  assert.ok(check(result) < check(cutPart));
  const bevels = result.surfaces.slice(-3);
  for (let i = 0; i < bevels.length; i++) {
    const bevel = bevels[i], boundary = selected[i];
    const cap = cutPart.surfaces.find(surface => surface instanceof Face && surface.boundaries.includes(boundary));
    const concave = cap.plane.origin[2] === 10;
    assert.ok(bevel instanceof RuledSurface);
    for (const u of [0.03, 0.13, 0.37, 0.71, 0.92]) {
      const original = boundary.at(u).position, a = bevel.start.at(u).position, b = bevel.end.at(u).position;
      close(vec3.distance(a, original), 1); close(vec3.distance(b, original), 1);
      close(vec3.dot(vec3.subtract([0, 0, 0], b, a), cap.plane.normal), concave ? 1 : -1);
      close(vec3.dot(surfaceFrame(bevel, { x: u, y: 0.4 }).normal, cap.plane.normal), Math.SQRT1_2);
    }
  }
  assert.equal(cutPart.surfaces, surfaces); assert.equal(cutPart.boundaries, boundaries); assert.equal(cutPart.vertices, vertices);
  assert.deepEqual(vertices.map(vertex => [...vertex.position]), coordinates);
  assert.equal(cutPart.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(result.children, [child]); assert.notEqual(result.children, cutPart.children);
  assert.throws(() => cutPart.chamfer({ length: 3, boundaries: selection }), RangeError);
});

test('concave circular pocket chamfers add the expected volume at nondefault angles', () => {
  const source = sketch().add(circle(6)).extrude(10);
  const cap = source.surfaces.find(surface => surface instanceof Face && vec3.equals(surface.plane.normal, Z));
  const pocket = source.extrudeCut({ sketch: sketch(cap).add(circle(4)), length: -6 });
  const bottom = pocket.surfaces.find(surface => surface instanceof Face && surface.plane.origin[2] === 4);
  const original = check(pocket), exactVolume = Math.PI * (6 * 6 * 10 - 4 * 4 * 6), length = 1;
  for (const angleDEG of [30, 60]) {
    const rise = length * Math.tan(angleDEG * Math.PI / 180);
    const result = pocket.chamfer({ length, angle: angleDEG, boundaries: bottom });
    assert.ok(check(result, exactVolume + Math.PI * rise * (4 * length - length * length / 3)) > original);
    const bevel = result.surfaces.at(-1);
    for (const u of [0, 0.13, 0.37, 0.71, 1]) {
      const a = bevel.start.at(u).position, b = bevel.end.at(u).position;
      close(a[2], 4); close(Math.hypot(a[0], a[1]), 3);
      close(b[2], 4 + rise); close(Math.hypot(b[0], b[1]), 4);
    }
  }
  assert.throws(() => pocket.chamfer({ length: 5, boundaries: bottom }), RangeError);
});

test('mixed rims and concave pocket chamfers support rotated planes and negative extrusions', () => {
  const plane = XY.rotate({ axis: X, angle: 31 }).displace([3, 4, 5]);
  const source = sketch({ plane }).add(roundPolyline({ segments: rectangleSegments({ center, width: 20, height: 12 }), radius: 2 })).extrude(-8);
  const normal = vec3.negate([0, 0, 0], plane.normal);
  const cap = source.surfaces.find(surface => surface instanceof Face && vec3.equals(surface.plane.normal, normal));
  const pocket = source.extrudeCut({
    sketch: sketch(cap).add(roundPolyline({ segments: rectangleSegments({ center, width: 16, height: 8 }), radius: 1 })), length: -4,
  });
  for (const angleDEG of [30, 60]) check(pocket.chamfer({
    length: 0.3, angle: angleDEG, boundaries: ({ face }) => !!face && vec3.equals(face.plane.normal, normal),
  }));
});

test('chamfer exports an operation with defaults and leaves topology, children and cached input mesh unchanged', () => {
  assert.equal(operationChamfer, chamfer);
  const part = extrude({ sketch: rectangle(), length: 10 }), child = node();
  part.add(child);
  const surfaces = part.surfaces, boundaries = part.boundaries, vertices = part.vertices;
  const coordinates = vertices.map(vertex => [...vertex.position]), cached = part.triangulate(), bytes = cached.slice();
  const result = part.chamfer({ boundaries: [0] });
  assert.notEqual(result, part);
  assert.equal(part.surfaces, surfaces); assert.equal(part.boundaries, boundaries); assert.equal(part.vertices, vertices);
  assert.deepEqual(vertices.map(vertex => [...vertex.position]), coordinates);
  assert.equal(part.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(part.children, [child]); assert.deepEqual(result.children, [child]);
  assert.notEqual(part.children, result.children);
  assert.equal(result.surfaces.length, 7);
  check(result, 1000 - 10 * 0.5 * 0.5 / 2);
  assert.deepEqual(result.triangulate(), chamfer({ solid: part, boundaries: [0] }).triangulate());
});

test('omitted and empty indices chamfer every original edge, including shared planar corners', () => {
  const part = extrude({ sketch: rectangle(), length: 10 });
  const all = part.chamfer(), explicit = chamfer({ solid: part, boundaries: [] });
  assert.equal(all.surfaces.length, 18);
  assert.ok(check(all) < 1000);
  assert.deepEqual(all.triangulate(), explicit.triangulate());
  assert.deepEqual(chamfer({ solid: part, boundaries: [0, 0] }).triangulate(), chamfer({ solid: part, boundaries: [0] }).triangulate());
});

test('selected indices always refer to the input topology; length and degrees control asymmetric cuts', () => {
  const part = extrude({ sketch: rectangle(), length: 10 });
  const angleDEG = 30, length = 1, rise = length * Math.tan(angleDEG * Math.PI / 180);
  const result = part.chamfer({ boundaries: [0], length, angle: angleDEG });
  check(result, 1000 - 10 * length * rise / 2);
  assert.equal(result.surfaces.length, 7);
  const diagonal = result.surfaces.at(-1).plane.normal;
  close(Math.abs(vec3.dot(diagonal, part.surfaces[0].plane.normal)), Math.cos(angleDEG * Math.PI / 180));
  check(chamfer({ solid: part, boundaries: [0, 1, 8], length: 0.3 }));
});

test('curved rims become exact ruled bevels and source walls use mathematical surface trims', () => {
  const part = cylinder(), result = chamfer({ solid: part });
  const radius = 5, inner = 4.5, height = 10, rise = 0.5;
  const expected = Math.PI * radius ** 2 * (height - 2 * rise)
    + 2 * Math.PI * rise * (radius ** 2 + radius * inner + inner ** 2) / 3;
  check(result, expected);
  assert.ok(result.triangulate().length / 9 < 5000, 'A cylindrical trim must not subdivide its straight direction needlessly');
  assert.equal(result.surfaces.length, 5);
  const wall = result.surfaces.find(surface => surface instanceof TrimmedSurface);
  assert.equal(wall.surface, part.surfaces[2]);
  for (const t of [0, 0.13, 0.37, 0.71, 1]) {
    const bottom = result.surfaces[3], top = result.surfaces[4];
    assert.ok(bottom instanceof RuledSurface && top instanceof RuledSurface);
    const a = bottom.start.at(t).position, b = bottom.end.at(t).position;
    close(Math.hypot(a[0], a[1]), 4.5); close(a[2], 0);
    close(Math.hypot(b[0], b[1]), 5); close(b[2], 0.5);
    const uv = wall.parameters(t, 0.3);
    close(vec3.distance(wall.at(t, 0.3).position, wall.surface.at(uv.x, uv.y).position), 0);
  }
  assert.ok(result.boundaries.every(boundary => boundary instanceof SpatialCurve && boundary.isLoop()));
  assert.equal(part.surfaces[2] instanceof RuledSurface, true);
  assert.equal(part.surfaces[2].start, part.boundaries[0]);
});

test('plane placement, reversed extrusion and nondefault chamfer angles work for straight and curved solids', () => {
  for (const plane of [XY, ZX, YZ]) for (const length of [10, -10]) {
    check(chamfer({ solid: extrude({ sketch: rectangle(plane), length }), boundaries: [0], angle: 30 }), 1000 - 10 * 0.25 * Math.tan(Math.PI / 6) / 2);
    const result = chamfer({ solid: cylinder(plane, length), boundaries: [0], angle: 30 });
    check(result);
    const bevel = result.surfaces.at(-1), a = bevel.start.at(0.23).position, b = bevel.end.at(0.23).position;
    close(Math.abs(vec3.dot(vec3.subtract([0, 0, 0], b, a), plane.normal)), 0.5 * Math.tan(Math.PI / 6));
  }
});

test('general planar evaluators, sampling overrides, holes and drafted walls work without circle-specific equations', () => {
  let samples = 0;
  const ellipse = planarCurve({ at: t => {
    const angleRAD = 2 * Math.PI * (t === 1 ? 0 : t);
    return { x: 8 * Math.cos(angleRAD), y: 5 * Math.sin(angleRAD) };
  } });
  const defaultSample = ellipse.sample.bind(ellipse);
  ellipse.sample = options => { samples++; return defaultSample(options); };
  const s = sketch().add(ellipse, circle({ center: { x: 0, y: 0 }, radius: 1 }));
  const part = extrude({ sketch: s, length: 10, angle: 3 });
  assert.ok(samples > 0);
  const rim = part.boundaries[0], rimSample = rim.sample.bind(rim);
  let rimSamples = 0;
  rim.sample = options => { rimSamples++; return rimSample(options); };
  const result = chamfer({ solid: part, length: 0.2 });
  assert.ok(rimSamples > 0);
  check(result);
  assert.equal(result.surfaces.filter(surface => surface instanceof TrimmedSurface).length, 2);
  assert.equal(result.surfaces.filter(surface => surface instanceof Face).length, 2);
  assert.equal(result.surfaces.length, 8);
  assert.ok(result.surfaces.every(surface => surface instanceof Face || surface instanceof SpatialSurface));
});

test('drafted rectangular parts with curved holes chamfer all boundaries together', () => {
  const s = rectangle().add(circle({ center: { x: 5, y: 5 }, radius: 1 }));
  const part = extrude({ sketch: s, length: 4, angle: 3 });
  check(chamfer({ solid: part, length: 0.2 }));
});

test('a smooth periodic solid with no physical boundaries returns a new solid without seams', () => {
  const path = SpatialCurve.fromPlanarCurve({ curve: circle({ center: { x: 0, y: 0 }, radius: 8 }) });
  const part = extrudeAlongCurve({ sketch: sketch().add(circle({ center: { x: 0, y: 0 }, radius: 1 })), curve: path });
  const result = chamfer({ solid: part });
  assert.notEqual(part, result); assert.deepEqual(result.surfaces, part.surfaces);
  assert.deepEqual(result.boundaries, []);
});

test('invalid arguments and unresolved or oversized intersections throw without modifying the input', () => {
  const part = extrude({ sketch: rectangle(), length: 10 }), cached = part.triangulate();
  for (const length of [0, -1, NaN, Infinity]) assert.throws(() => chamfer({ solid: part, length }), RangeError);
  for (const angle of [0, -1, 90, 180, NaN, Infinity]) assert.throws(() => chamfer({ solid: part, angle }), RangeError);
  for (const boundaries of [[-1], [1.5], [12], [NaN], null]) assert.throws(() => chamfer({ solid: part, boundaries }), RangeError);
  assert.throws(() => chamfer({ solid: {}, length: 1 }), TypeError);
  assert.throws(() => chamfer({ solid: part, length: 20 }), RangeError);
  assert.throws(() => chamfer({ solid: cylinder(), length: 6 }), RangeError);
  assert.throws(() => chamfer({ solid: cylinder(), length: 5 }), RangeError);
  assert.throws(() => chamfer({ solid: cylinder(), length: 4, angle: 75 }), RangeError);
  assert.throws(() => chamfer({ solid: new Solid({ surfaces: [part.surfaces[0]] }) }), /manifold/);
  assert.equal(part.triangulate(), cached);
});

test('open curved chamfers share exact end contacts and local concave straight bevels add material', () => {
  const arc = planarCurve({ at: t => {
    const angleRAD = Math.PI * t;
    return { x: t === 1 ? -5 : 5 * Math.cos(angleRAD), y: t === 0 || t === 1 ? 0 : 5 * Math.sin(angleRAD) };
  } });
  const s = sketch().add(arc, lineSegment({ start: arc.end, end: arc.start }));
  const part = extrude({ sketch: s, length: 10 });
  const curved = part.boundaries.findIndex(boundary => boundary instanceof SpatialCurve);
  const beveled = chamfer({ solid: part, boundaries: [curved] });
  assert.ok(check(beveled) < check(part));
  const blend = beveled.surfaces.at(-1);
  for (const end of [blend.sides.u0, blend.sides.u1]) assert.equal(beveled.surfaces.filter(surface => surface.boundaries.includes(end)).length, 2);
  const points = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]].map(([x, y]) => ({ x, y }));
  const concave = extrude({ sketch: sketch().add(...points.map((start, i) => lineSegment({ start, end: points[(i + 1) % points.length] }))), length: 10 });
  const inside = concave.boundaries.find(boundary => boundary.start.position[0] === 1 && boundary.start.position[1] === 1
    && boundary.end.position[0] === 1 && boundary.end.position[1] === 1);
  check(chamfer({ solid: concave, boundaries: inside, length: 0.2 }), 70 + 10 * 0.2 ** 2 / 2);
  assert.throws(() => chamfer({ solid: concave }), /corner|overlap/);
});
