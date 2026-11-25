import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { round, circle, rectangle, polyline, lineSegment, roundPolyline, Edge, Face, node, planarCurve, setTriangulationResolution,
  sketch, Solid, SpatialCurve, SpatialSurface, SurfaceRegion, TrimmedSurface, XY, YZ, ZX, X, Z } from 'libcompass';
import { round as operationRound } from 'libcompass/operations/round';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';
import { surfaceFrame } from '../dist/internal/surfaceGeometry.js';
import { roundPlanes } from '../dist/internal/roundPlanes.js';
import { roundCurves } from '../dist/internal/roundCurves.js';
import { RoundTopology } from '../dist/internal/roundTopology.js';
import { UnsupportedRoundError } from '../dist/internal/roundUnsupported.js';
import { orientLoop } from '../dist/internal/boundaryLoops.js';
import { containsInterior } from '../dist/internal/polygon.js';

setTriangulationResolution(0.0128);
const center = { x: 0, y: 0 };
const cube = (plane = XY, length = 2) => sketch({ plane }).add(rectangle({ center, corner2: { x: 1, y: 1 } })).extrude({ length });
const cylinder = (plane = XY, length = 2) => sketch({ plane }).add(circle({ center, radius: 1 })).extrude({ length });
const plate = (plane = XY, length = 12) => sketch({ plane }).add(rectangle({ center, width: 100, height: 64 }),
  circle({ center: { x: -28, y: 0 }, radius: 10 }), circle({ center: { x: 28, y: 0 }, radius: 10 })).extrude(length);
const close = (a, b, tolerance = 1e-7) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const vertical = solid => solid.boundaries.map((boundary, i) => [boundary, i])
  .filter(([boundary]) => Math.abs(boundary.start.position[2] - boundary.end.position[2]) > 1).map(([, i]) => i);

function check(solid, expectedVolume, euler = 2) {
  const mesh = solid.triangulate();
  validateSweepMesh(mesh);
  const vertices = new Set(), edges = new Set();
  let volume = 0;
  for (let i = 0; i < mesh.length; i += 9) {
    const points = [0, 3, 6].map(offset => Array.from(mesh.subarray(i + offset, i + offset + 3)));
    volume += vec3.dot(points[0], vec3.cross([0, 0, 0], points[1], points[2])) / 6;
    for (let j = 0; j < 3; j++) {
      vertices.add(points[j].join(','));
      edges.add([points[j].join(','), points[(j + 1) % 3].join(',')].sort().join('|'));
    }
  }
  assert.equal(vertices.size - edges.size + mesh.length / 9, euler);
  for (const boundary of solid.boundaries) assert.equal(solid.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  if (expectedVolume !== undefined) close(volume, expectedVolume, expectedVolume * 0.018);
  return volume;
}

function checkSurface(surface, equation) {
  for (const u of [0, 0.13, 0.37, 0.71, 1]) for (const v of [0, 0.17, 0.43, 0.81, 1]) equation(surface.at(u, v).position);
}

test('straight rounds preserve distant curved holes, and both kinds of round compose in one operation', () => {
  const source = plate(), child = node(); source.add(child);
  const surfaces = [...source.surfaces], boundaries = [...source.boundaries], vertices = [...source.vertices];
  const cached = source.triangulate(), bytes = cached.slice();
  const radius = 1, core = [98, 62, 10];
  const boxVolume = core[0] * core[1] * core[2] + 2 * (core[0] * core[1] + core[1] * core[2] + core[2] * core[0])
    + Math.PI * core.reduce((a, b) => a + b) + 4 * Math.PI / 3;
  const cylindersVolume = 2 * Math.PI * 10 ** 2 * 12;
  const outside = source.round({ radius, boundaries: ({ boundary }) => boundary instanceof Edge });
  const holes = boundaries.filter(boundary => boundary.isLoop());
  assert.equal(outside.surfaces.length, 28);
  assert.ok(holes.every(boundary => outside.boundaries.includes(boundary)));
  assert.ok(source.surfaces.filter(surface => surface instanceof SpatialSurface).every(surface => outside.surfaces.includes(surface)));
  assert.ok(holes.every(boundary => outside.vertices.includes(boundary.start)));
  check(outside, boxVolume - cylindersVolume, -2);
  const together = source.round({ radius });
  assert.equal(together.surfaces.length, 32);
  assert.ok(holes.every(boundary => !together.boundaries.includes(boundary)));
  const rimVolume = 4 * Math.PI * ((2 - Math.PI / 2) * 10 + 5 / 3 - Math.PI / 2);
  check(together, boxVolume - cylindersVolume - rimVolume, -2);
  assert.deepEqual(source.surfaces, surfaces); assert.deepEqual(source.boundaries, boundaries); assert.deepEqual(source.vertices, vertices);
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(together.children, [child]); assert.notEqual(together.children, source.children);
});

test('a local straight round preserves untouched faces, boundaries and shared vertices by identity', () => {
  const source = plate(), edge = source.boundaries.find(boundary => boundary instanceof Edge);
  const touched = [edge.start, edge.end];
  const result = source.round({ radius: 1, boundaries: edge });
  for (const surface of source.surfaces) if (surface.vertices.every(vertex => !touched.includes(vertex))) assert.ok(result.surfaces.includes(surface));
  for (const boundary of source.boundaries) if (!touched.includes(boundary.start) && !touched.includes(boundary.end)) {
    assert.ok(result.boundaries.includes(boundary));
    assert.ok(result.vertices.includes(boundary.start)); assert.ok(result.vertices.includes(boundary.end));
  }
  for (const vertex of result.vertices) {
    for (const other of result.vertices) if (vec3.exactEquals(vertex.position, other.position)) assert.equal(vertex, other);
  }
  check(result, undefined, -2);
});

test('convex local rounds do not require remote regions to lie behind their adjoining planes', () => {
  const source = sketch().add(polyline({ loop: true, points: [
    { x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 6 }, { x: 0, y: 6 },
  ] })).extrude(4);
  const at = (x, y) => source.boundaries.find(boundary => boundary instanceof Edge &&
    [boundary.start, boundary.end].every(vertex => vertex.position[0] === x && vertex.position[1] === y));
  check(source.round({ radius: 0.3, boundaries: at(2, 6) }), 80 - (1 - Math.PI / 4) * 0.3 ** 2 * 4);
  check(source.round({ radius: 0.3, boundaries: at(2, 2) }), 80 + (1 - Math.PI / 4) * 0.3 ** 2 * 4);
  const moved = source.rotate({ axis: X, angle: 31 }).displace([3,4,5]);
  check(moved.round({ radius: 0.3, boundaries: source.boundaries.indexOf(at(2,2)) }), 80 + (1 - Math.PI / 4) * 0.3 ** 2 * 4);
  assert.throws(() => source.round({ radius: 0.3 }), /mixed convex\/concave/);
});

function checkTangency(result, blend) {
  for (const v of [0, 1]) {
    const boundary = blend.sides[v === 0 ? 'v0' : 'v1'];
    const retained = result.surfaces.find(surface => surface !== blend && surface.boundaries.includes(boundary));
    for (const u of [0.13, 0.37, 0.71]) {
      let expected;
      if (retained instanceof Face) expected = retained.plane.normal;
      else {
        const side = Object.keys(retained.sides).find(side => retained.sides[side] === boundary);
        const uv = t => side === 'v0' ? { x: t, y: 0 } : side === 'v1' ? { x: t, y: 1 } : side === 'u0' ? { x: 0, y: t } : { x: 1, y: t };
        const position = boundary.at(u).position;
        const t = vec3.distance(retained.at(uv(u).x, uv(u).y).position, position) < vec3.distance(retained.at(uv(1-u).x, uv(1-u).y).position, position) ? u : 1-u;
        expected = surfaceFrame(retained, uv(t)).normal;
      }
      close(vec3.dot(surfaceFrame(blend, { x: u, y: v }).normal, expected), 1, 2e-5);
    }
  }
}

function inOriginalProfile(source, point) {
  const cap = source.surfaces.find(surface => surface instanceof Face && Math.abs(surface.plane.normal[2]) > 0.9);
  const loop = orientLoop(cap.outer).flatMap(({ boundary, reversed }) => {
    const points = boundary.sample({ resolution: 1e-6 });
    return (reversed ? [...points].reverse() : points).slice(0,-1).map(vertex => cap.plane.toLocal(vertex));
  });
  const offset = vec3.subtract([0,0,0], point, cap.plane.origin);
  return containsInterior(loop, { x: vec3.dot(offset, cap.plane.xAxis), y: vec3.dot(offset, cap.plane.yAxis) });
}

test('analytic concave rounds fill rectangular holes and meet in concave spherical pocket corners', () => {
  const source = sketch().add(rectangle({ center, width: 10, height: 10 }), rectangle({ center, width: 4, height: 4 })).extrude(4);
  const insideVertical = solid => solid.boundaries.filter(boundary => boundary instanceof Edge && Math.abs(boundary.start.position[2]-boundary.end.position[2]) > 1 &&
    [boundary.start, boundary.end].every(vertex => Math.abs(Math.abs(vertex.position[0])-2) < 1e-7 && Math.abs(Math.abs(vertex.position[1])-2) < 1e-7));
  const radius = 0.3, edges = insideVertical(source);
  const analytic = roundPlanes(source, edges, radius, new RoundTopology(radius, source.vertices));
  const rounded = new Solid({ surfaces: analytic });
  check(rounded, 336 + (4-Math.PI)*radius**2*4, 0);
  rounded.surfaces.slice(-4).forEach(blend => checkTangency(rounded, blend));
  const base = sketch().add(rectangle({ center, width: 10, height: 10 })).extrude(6);
  const cap = base.surfaces.find(surface => surface instanceof Face && surface.plane.normal[2] > 0);
  const pocket = base.extrudeCut({ sketch: sketch(cap).add(rectangle({ center, width: 4, height: 4 })), length: -4 });
  const floor = pocket.surfaces.find(surface => surface instanceof Face && surface.plane.normal[2] > 0 && surface.boundaries.every(boundary => boundary.start.position[2] === 2));
  const result = pocket.round({ radius, boundaries: [floor, ...insideVertical(pocket)] });
  assert.ok(check(result) > check(pocket));
  result.surfaces.slice(-4).forEach(surface => checkSurface(surface, point => {
    const c = [Math.sign(point[0])*(2-radius), Math.sign(point[1])*(2-radius), 2+radius];
    close(vec3.distance(point, c), radius);
  }));
});

test('the numerical solver rounds open boundaries between two planar faces directly', () => {
  const source = cube(), edge = source.boundaries[0], radius = 0.2;
  const result = new Solid({ surfaces: roundCurves(source.surfaces, [edge], radius, new RoundTopology(radius, source.vertices)) });
  close(check(result), check(source.round({ radius, boundaries: edge })), 0.002);
  const blend = result.surfaces.at(-1);
  assert.equal(blend.periodicU, false); assert.ok(blend.sides.u0); assert.ok(blend.sides.u1);
  checkTangency(result, blend);
});

test('open curved rims trim both ends and share closing arcs with planar end caps', () => {
  for (const [plane, length] of [[XY,2], [YZ,-2]]) {
    const source = sketch({ plane }).add(lineSegment({ start: { x: 1, y: 0 }, end: { x: -1, y: 0 } }),
      planarCurve({ at: t => ({ x: Math.cos(Math.PI*t), y: t === 1 ? 0 : Math.sin(Math.PI*t) }) })).extrude(length);
    const selected = source.boundaries.filter(boundary => boundary instanceof SpatialCurve);
    let sampled = 0;
    selected.forEach(boundary => { const sample = boundary.sample.bind(boundary); boundary.sample = options => { sampled++; return sample(options); }; });
    const cached = source.triangulate(), bytes = cached.slice();
    const result = source.round({ radius: 0.2, boundaries: selected });
    assert.ok(sampled > 0); assert.equal(result.surfaces.length, 6);
    assert.ok(check(result) < check(source));
    for (const blend of result.surfaces.slice(-2)) {
      assert.equal(blend.periodicU, false); assert.ok(blend.sides.u0); assert.ok(blend.sides.u1);
      checkTangency(result, blend);
      for (const end of [blend.sides.u0, blend.sides.u1]) assert.equal(result.surfaces.filter(surface => surface.boundaries.includes(end)).length, 2);
    }
    const limit = source.round({ radius: 1, boundaries: selected });
    assert.equal(limit.surfaces.length, 3);
    check(limit, 2*Math.PI/3);
    const c = vec3.scaleAndAdd([0,0,0], plane.origin, plane.normal, length/2);
    limit.surfaces.filter(surface => surface instanceof SpatialSurface).forEach(surface => checkSurface(surface, point => close(vec3.distance(point,c),1)));
    assert.throws(() => source.round({ radius: 1.1, boundaries: selected }), /folds|consumes|overlap|domain/);
    assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
  }
});

test('numerical fallback rounds convex and concave straight edges adjoining curved surfaces', () => {
  const convex = sketch().add(polyline({ points: [{x:0,y:2},{x:-5,y:2},{x:-5,y:-2},{x:0,y:-2}] }),
    planarCurve({ at: t => ({ x: 8*t*(1-t), y: -2+4*t }) })).extrude(4);
  const concave = sketch().add(polyline({ points: [{x:0,y:0},{x:8,y:0},{x:8,y:2},{x:4,y:2}] }),
    planarCurve({ at: t => ({ x: 4-2*t, y: 2+2*t*t }) }),
    polyline({ points: [{x:2,y:4},{x:2,y:8},{x:0,y:8},{x:0,y:0}] })).extrude(4);
  for (const [source, x, y, sense] of [[convex,0,-2,1], [concave,2,4,-1]]) {
    const edge = source.boundaries.find(boundary => boundary instanceof Edge && [boundary.start,boundary.end].every(vertex => vertex.position[0] === x && vertex.position[1] === y));
    const child = node(); source.add(child); const cached = source.triangulate(), bytes = cached.slice();
    assert.throws(() => roundPlanes(source, [edge], 0.2, new RoundTopology(0.2)), UnsupportedRoundError);
    const result = source.round({ radius: 0.2, boundaries: edge });
    check(result);
    // Independent mesh errors can exceed the volume of a small fillet.
    assert.equal(inOriginalProfile(source, result.surfaces.at(-1).at(0.5,0.5).position), sense === 1);
    checkTangency(result, result.surfaces.at(-1));
    assert.deepEqual(result.children, [child]); assert.notEqual(result.children, source.children);
    assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
  }
});

test('numerical fallback trims oblique planar end caps instead of requiring perpendicular caps', () => {
  const source = sketch().add(rectangle({ center, width: 4, height: 4 })).extrude({ length: 4, axis: [0.4,0,1] });
  const edge = source.boundaries.find(boundary => boundary instanceof Edge && boundary.start.position[2] !== boundary.end.position[2]);
  assert.throws(() => roundPlanes(source, [edge], 0.2, new RoundTopology(0.2)), /oblique/);
  const result = source.round({ radius: 0.2, boundaries: edge });
  assert.ok(check(result) < check(source)); checkTangency(result, result.surfaces.at(-1));
});

test('numerical fallback supports two curved adjoining surfaces and reversed chart directions', () => {
  const source = sketch().add(planarCurve({ at: t => ({ x: -2+4*t, y: -4*t*(1-t) }) }),
    planarCurve({ at: t => ({ x: 2-4*t, y: 4*t*(1-t) }) })).extrude(4);
  const edge = source.boundaries.find(boundary => boundary instanceof Edge && boundary.start.position[0] === 2);
  const curved = source.surfaces.find(surface => surface instanceof SpatialSurface);
  const reversed = new SpatialSurface({ at: (u,v) => curved.at(1-u,v), reversed: !curved.reversed,
    sides: { u0: curved.sides.u1, u1: curved.sides.u0, v0: curved.sides.v0, v1: curved.sides.v1 }, boundaryLoops: curved.boundaryLoops });
  for (const input of [source, new Solid({ surfaces: source.surfaces.map(surface => surface === curved ? reversed : surface) })]) {
    const result = input.round({ radius: 0.1, boundaries: edge });
    check(result); assert.equal(inOriginalProfile(input, result.surfaces.at(-1).at(0.5,0.5).position), true);
    checkTangency(result, result.surfaces.at(-1));
  }
});

test('open curved walls away from a selected corner retain their exact topology', () => {
  const source = sketch().add(polyline({ points: [
    { x: 0, y: 2 }, { x: -5, y: 2 }, { x: -5, y: -2 }, { x: 0, y: -2 },
  ] }), planarCurve({ at: t => ({ x: 8 * t * (1 - t), y: -2 + 4 * t }) })).extrude(4);
  const edge = source.boundaries.find(boundary => boundary instanceof Edge &&
    [boundary.start, boundary.end].every(vertex => vertex.position[0] === -5 && vertex.position[1] === -2));
  const wall = source.surfaces.find(surface => surface instanceof SpatialSurface);
  const samples = wall.boundaries.filter(boundary => boundary instanceof SpatialCurve).map(boundary => {
    const points = boundary.sample(), saved = [...points];
    boundary.sample = () => points;
    return { points, saved };
  });
  const result = source.round({ radius: 0.3, boundaries: edge });
  assert.ok(result.surfaces.includes(wall));
  assert.ok(wall.boundaries.every(boundary => result.boundaries.includes(boundary)));
  check(result, (20 + 16 / 3) * 4 - (1 - Math.PI / 4) * 0.3 ** 2 * 4);
  samples.forEach(({ points, saved }) => assert.deepEqual(points, saved));
});

test('local rounding with preserved holes respects rotated planes and negative extrusion', () => {
  const plane = YZ.rotate({ axis: X, angle: 27 }).displace([3, 4, 5]);
  const source = plate(plane, -12);
  const result = source.round({ radius: 1, boundaries: ({ boundary }) => boundary instanceof Edge });
  assert.ok(source.surfaces.filter(surface => surface instanceof SpatialSurface).every(surface => result.surfaces.includes(surface)));
  check(result, undefined, -2);
});

test('rounds still reject holes intersecting or touching the affected region', () => {
  const source = sketch().add(rectangle({ center, width: 10, height: 6 }), circle({ center: { x: 3, y: 0 }, radius: 1 })).extrude(4);
  const cached = source.triangulate(), bytes = cached.slice();
  check(source.round({ radius: 0.4 }), undefined, 0);
  for (const radius of [0.5, 0.6, 1]) assert.throws(() => source.round({ radius }), RangeError);
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
});

test('rounded-rectangle blind pockets round their convex lips and concave floor together', () => {
  const width = 100, height = 60, radius = 10, wallThickness = 5;
  const part = sketch().add(roundPolyline({ segments: rectangle({ center, width, height }), radius })).extrude(20);
  const face = part.surfaces.find(surface => surface.plane && vec3.equals(surface.plane.normal, Z));
  const cutPart = part.extrudeCut({
    sketch: sketch(face).add(roundPolyline({
      segments: rectangle({ center, width: width - wallThickness * 2, height: height - wallThickness * 2 }),
      radius: radius - wallThickness,
    })), length: -10,
  });
  const selected = cutPart.boundaries.filter(boundary => cutPart.surfaces.some(surface =>
    surface instanceof Face && vec3.equals(surface.plane.normal, Z) && surface.boundaries.includes(boundary)));
  const child = node(); cutPart.add(child);
  const cached = cutPart.triangulate(), bytes = cached.slice(), surfaces = [...cutPart.surfaces], boundaries = [...cutPart.boundaries];
  const rounded = cutPart.round({ radius: 1, boundaries: ({ face }) => vec3.equals(face.plane.normal, Z) });
  assert.equal(selected.length, 3);
  assert.equal(rounded.surfaces.length, 8); assert.equal(rounded.boundaries.length, 7);
  const sourceVolume = check(cutPart), roundedVolume = check(rounded);
  assert.ok(roundedVolume < sourceVolume);
  assert.deepEqual(cutPart.surfaces, surfaces); assert.deepEqual(cutPart.boundaries, boundaries);
  assert.equal(cutPart.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(rounded.children, [child]); assert.notEqual(rounded.children, cutPart.children);
  const blends = rounded.surfaces.slice(-3);
  for (let i = 0; i < blends.length; i++) {
    const blend = blends[i], boundary = selected[i];
    const adjoining = cutPart.surfaces.filter(surface => surface.boundaries.includes(boundary));
    const cap = adjoining.find(surface => surface instanceof Face), wall = adjoining.find(surface => surface instanceof SpatialSurface);
    const side = wall.sides.v0 === boundary ? 0 : 1, concave = cap.plane.origin[2] === 10;
    for (const u of [0.03, 0.13, 0.37, 0.71, 0.92]) {
      const contact = blend.at(u, 0).position;
      const center = vec3.scaleAndAdd([0, 0, 0], contact, cap.plane.normal, concave ? 1 : -1);
      for (const v of [0, 0.2, 0.6, 1]) close(vec3.distance(blend.at(u, v).position, center), 1);
      for (const v of [0, 1]) {
        const normal = surfaceFrame(blend, { x: u, y: v }).normal;
        const sourceNormal = v === 0 ? cap.plane.normal : surfaceFrame(wall, { x: u, y: side }).normal;
        close(vec3.dot(normal, sourceNormal), 1, 1e-6);
      }
    }
  }
  assert.throws(() => cutPart.round({ radius: 3, boundaries: ({ face }) => vec3.equals(face.plane.normal, Z) }), RangeError);
});

test('a concave pocket floor adds material and can converge to an exact spherical bowl', () => {
  const source = sketch().add(circle(6)).extrude(10);
  const cap = source.surfaces.find(surface => surface instanceof Face && vec3.equals(surface.plane.normal, Z));
  const pocket = source.extrudeCut({ sketch: sketch(cap).add(circle(4)), length: -6 });
  const bottom = pocket.surfaces.find(surface => surface instanceof Face && surface.plane.origin[2] === 4);
  const original = check(pocket);
  const small = pocket.round({ radius: 1, boundaries: bottom });
  assert.ok(check(small) > original);
  const bowl = pocket.round({ radius: 4, boundaries: bottom });
  assert.equal(bowl.surfaces.length, 5);
  assert.ok(check(bowl) > original);
  checkSurface(bowl.surfaces.at(-1), ([x, y, z]) => close(x * x + y * y + (z - 8) ** 2, 16));
});

test('mixed straight/curved rims and concave rounds support rotated placement and negative extrusion', () => {
  const plane = XY.rotate({ axis: X, angle: 31 }).displace([3, 4, 5]);
  const source = sketch({ plane }).add(roundPolyline({ segments: rectangle({ center, width: 20, height: 12 }), radius: 2 })).extrude(-8);
  const normal = vec3.negate([0, 0, 0], plane.normal);
  const cap = source.surfaces.find(surface => surface instanceof Face && vec3.equals(surface.plane.normal, normal));
  const pocket = source.extrudeCut({ sketch: sketch(cap).add(roundPolyline({ segments: rectangle({ center, width: 16, height: 8 }), radius: 1 })), length: -4 });
  check(pocket.round({ radius: 0.3, boundaries: ({ face }) => !!face && vec3.equals(face.plane.normal, normal) }));
});

test('a cylinder rounds all the way to a mathematical sphere with no caps or cylindrical remnant', () => {
  const sphere = cylinder().round({ radius: 1 });
  assert.equal(sphere.surfaces.length, 2);
  assert.ok(sphere.surfaces.every(surface => surface instanceof SpatialSurface && !(surface instanceof TrimmedSurface)));
  sphere.surfaces.forEach(surface => checkSurface(surface, ([x, y, z]) => close(x * x + y * y + (z - 1) ** 2, 1)));
  check(sphere, 4 * Math.PI / 3);
  for (const z of [0, 2]) assert.ok(sphere.vertices.some(vertex => vec3.distance(vertex.position, [0, 0, z]) < 1e-7));
  assert.equal(sphere.boundaries.length, 1, 'Only the shared equator remains, with no zero-length pole boundaries');
});

test('a cylinder with a hole becomes a mathematical torus when all four rims meet', () => {
  const tube = sketch().add(circle({ center, radius: 3 }), circle({ center, radius: 1 })).extrude({ length: 2 });
  const torus = round({ solid: tube, radius: 1 });
  assert.equal(torus.surfaces.length, 4);
  assert.ok(torus.surfaces.every(surface => surface instanceof SpatialSurface && !(surface instanceof TrimmedSurface)));
  torus.surfaces.forEach(surface => checkSurface(surface, ([x, y, z]) => close((Math.hypot(x, y) - 2) ** 2 + (z - 1) ** 2, 1)));
  check(torus, 4 * Math.PI ** 2, 0);
});

test('rounding every cube edge creates six planar faces, twelve cylindrical blends and eight spherical corners', () => {
  const radius = 0.3, result = cube().round({ radius }), side = 2 - 2 * radius;
  assert.equal(result.surfaces.filter(surface => surface instanceof Face).length, 6);
  assert.equal(result.surfaces.length, 26);
  check(result, side ** 3 + 6 * side ** 2 * radius + 3 * Math.PI * side * radius ** 2 + 4 * Math.PI * radius ** 3 / 3);
  for (const surface of result.surfaces.slice(-8)) checkSurface(surface, point => {
    const nearestCore = [Math.sign(point[0]) * 0.7, Math.sign(point[1]) * 0.7, point[2] > 1 ? 1.7 : 0.3];
    close(vec3.distance(point, nearestCore), radius);
  });
});

test('rounding four parallel cube edges preserves the two flat end faces and adds four tangent rounds', () => {
  const source = cube(), radius = 0.3, result = round({ solid: source, radius, boundaries: vertical(source) });
  assert.equal(result.surfaces.length, 10);
  assert.equal(result.surfaces.filter(surface => surface instanceof SpatialSurface).length, 4);
  const caps = result.surfaces.filter(surface => surface instanceof Face && Math.abs(surface.plane.normal[2]) > 0.9);
  assert.equal(caps.length, 2);
  assert.ok(caps.every(face => face.outer.length === 8));
  check(result, (4 - (4 - Math.PI) * radius ** 2) * 2);
});

test('four cube rounds at half the side length consume all side strips and produce a cylinder', () => {
  const source = cube(), result = source.round({ radius: 1, boundaries: vertical(source) });
  assert.equal(result.surfaces.length, 6);
  assert.equal(result.surfaces.filter(surface => surface instanceof Face).length, 2);
  for (const surface of result.surfaces.filter(surface => surface instanceof SpatialSurface)) {
    checkSurface(surface, ([x, y]) => close(x * x + y * y, 1));
  }
  check(result, 2 * Math.PI);
});

test('all twelve cube edges can converge too, leaving a sphere made of eight spherical octants', () => {
  const result = cube().round({ radius: 1 });
  assert.equal(result.surfaces.length, 8);
  result.surfaces.forEach(surface => checkSurface(surface, ([x, y, z]) => close(x * x + y * y + (z - 1) ** 2, 1)));
  check(result, 4 * Math.PI / 3);
});

test('defaults, duplicate indices, method and operation agree without modifying source topology or memo caches', () => {
  assert.equal(round, operationRound);
  const source = cube(), child = node(); source.add(child);
  const surfaces = source.surfaces, boundaries = source.boundaries, vertices = source.vertices;
  const coordinates = vertices.map(vertex => [...vertex.position]), cached = source.triangulate(), bytes = cached.slice();
  const result = source.round();
  assert.notEqual(result, source); assert.deepEqual(result.children, [child]); assert.notEqual(result.children, source.children);
  assert.equal(source.surfaces, surfaces); assert.equal(source.boundaries, boundaries); assert.equal(source.vertices, vertices);
  assert.deepEqual(source.vertices.map(vertex => [...vertex.position]), coordinates);
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(result.triangulate(), round({ solid: source, radius: 0.5, boundaries: [] }).triangulate());
  assert.deepEqual(source.round({ boundaries: [0] }).triangulate(), source.round({ boundaries: [0, 0] }).triangulate());
  check(source.round({ boundaries: [0] }));
});

test('non-limit curved rounds preserve exact source trims and are tangent at both contact rails', () => {
  const source = cylinder(), result = source.round({ radius: 0.25 });
  const wall = result.surfaces.find(surface => surface instanceof TrimmedSurface);
  assert.equal(wall.surface, source.surfaces[2]);
  assert.equal(result.surfaces.length, 5);
  const blends = result.surfaces.slice(-2);
  for (const blend of blends) for (const u of [0.13, 0.37, 0.71]) for (const v of [0, 1]) {
    const a = blend.at(u - 1e-5, v).position, b = blend.at(u + 1e-5, v).position;
    const c = blend.at(u, v === 0 ? 0 : 1 - 1e-5).position, d = blend.at(u, v === 0 ? 1e-5 : 1).position;
    const normal = vec3.normalize([0, 0, 0], vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], b, a), vec3.subtract([0, 0, 0], d, c)));
    const point = blend.at(u, v).position, expected = v === 0 ? [0, 0, point[2] < 1 ? -1 : 1] : [point[0], point[1], 0];
    close(Math.abs(vec3.dot(normal, expected)), 1, 1e-6);
  }
  check(result);
});

test('general curves, source sampling overrides and drafted walls are handled without curve-type equations', () => {
  let sampled = 0;
  const ellipse = planarCurve({ at: t => ({ x: 2 * Math.cos(2 * Math.PI * (t === 1 ? 0 : t)), y: Math.sin(2 * Math.PI * (t === 1 ? 0 : t)) }) });
  const sample = ellipse.sample.bind(ellipse);
  ellipse.sample = options => { sampled++; return sample(options); };
  const source = sketch().add(ellipse).extrude({ length: 2, angle: 3 });
  assert.ok(sampled > 0);
  sampled = 0;
  const rim = source.boundaries[0], sampleRim = rim.sample.bind(rim);
  rim.sample = options => { sampled++; return sampleRim(options); };
  const result = source.round({ radius: 0.1 });
  assert.ok(sampled > 0); assert.equal(result.surfaces.length, 5);
  check(result);
});

test('placement and negative extrusion length preserve rounding orientation and closed topology', () => {
  for (const plane of [XY, YZ, ZX]) for (const length of [-2, 2]) {
    check(cylinder(plane, length).round({ radius: 1 }), 4 * Math.PI / 3);
    check(cube(plane, length).round({ radius: 0.25 }));
  }
});

test('resolution changes affect tessellation only, and transformed rounds retain valid mathematical geometry', () => {
  const source = cylinder();
  setTriangulationResolution(0.04);
  const coarse = source.round({ radius: 1 });
  const coarseMesh = coarse.triangulate();
  setTriangulationResolution(0.004);
  const fine = source.round({ radius: 1 });
  assert.ok(fine.triangulate().length > coarseMesh.length);
  const moved = fine.displace({ vector: [4, 5, 6] });
  check(moved, 4 * Math.PI / 3);
  assert.equal(moved.vertices.length, fine.vertices.length);
  for (const z of [6, 8]) assert.ok(moved.vertices.some(vertex => vec3.distance(vertex.position, [4, 5, z]) < 1e-7));
  setTriangulationResolution(0.0128);
});

test('invalid options, nonmanifold input, oversized radii and unsupported corners fail explicitly', () => {
  const source = cube(), cached = source.triangulate();
  for (const radius of [0, -1, NaN, Infinity]) assert.throws(() => round({ solid: source, radius }), RangeError);
  for (const boundaries of [[-1], [0.5], [12], [NaN], null]) assert.throws(() => round({ solid: source, boundaries }), RangeError);
  assert.throws(() => round({ solid: {} }), TypeError);
  assert.throws(() => new Solid({ surfaces: [source.surfaces[0]] }).round(), /manifold/);
  assert.throws(() => source.round({ radius: 1.1 }), error => error instanceof RangeError && !(error instanceof UnsupportedRoundError) && /consumes/.test(error.message));
  assert.throws(() => cylinder().round({ radius: 1.1 }), RangeError);
  assert.throws(() => source.round({ boundaries: [0, 1] }), /one selected edge or all three/);
  // A curved boundary at the selected edge's endpoint still needs curved corner trimming.
  const mixed = sketch().add(lineSegment({ start: { x: 1, y: 0 }, end: { x: -1, y: 0 } }),
    planarCurve({ at: t => ({ x: Math.cos(Math.PI * t), y: t === 1 ? 0 : Math.sin(Math.PI * t) }) })).extrude(2);
  const straightRim = mixed.boundaries.find(boundary => boundary instanceof Edge && boundary.start.position[2] === 0 && boundary.end.position[2] === 0);
  assert.throws(() => mixed.round({ radius: 0.1, boundaries: straightRim }), /curved corner trimming/);
  assert.equal(source.triangulate(), cached);
  const empty = new Solid({ surfaces: [] });
  assert.deepEqual(empty.round().surfaces, []); assert.notEqual(empty.round(), empty);
});

test('opposite edge rounds keep reversed shared rails watertight at the exact limiting radius', () => {
  for (const [plane, length] of [[XY, 20], [XY, -20], [ZX, 20], [YZ, -20]]) {
    const source = sketch({ plane }).add(rectangle({ center, corner2: { x: 10, y: 10 } })).extrude({ length });
    const pairs = source.surfaces.flatMap(face => [[face.outer[0], face.outer[2]], [face.outer[1], face.outer[3]]])
      .map(pair => pair.map(boundary => source.boundaries.indexOf(boundary)));
    const cached = source.triangulate(), bytes = cached.slice();
    for (const boundaries of pairs) for (const radius of [9.9, 10]) {
      const result = source.round({ radius, boundaries });
      assert.equal(result.surfaces.length, radius === 10 ? 7 : 8);
      check(result, 8000 - 40 * radius ** 2 * (1 - Math.PI / 4));
    }
    assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
  }
});


test('opposing rounds share partial contact intervals and split the remaining planar cap', () => {
  const source = sketch().add(
    roundPolyline({ segments: rectangle({ center, width: 20, height: 12 }), radius: 3 }),
    roundPolyline({ segments: rectangle({ center, width: 14, height: 8 }), radius: 1 }),
  ).extrude(5);
  const cached = source.triangulate(), bytes = cached.slice();
  const rounded = source.round({ radius: 1, boundaries: ({ face }) => face?.plane.normal[2] === 1 });
  const roundedVolume = check(rounded, undefined, 0);
  assert.ok(roundedVolume < check(source, undefined, 0));
  const moved = rounded.rotate({ axis: X, angle: 17 }).displace([1, 2, 3]);
  close(check(moved, undefined, 0), roundedVolume, roundedVolume * 1e-6);
  assert.equal(rounded.surfaces.filter(surface => surface instanceof Face && surface.plane.normal[2] === 1).length, 2);
  const blends = rounded.surfaces.slice(-2);
  assert.ok(blends.every(surface => surface instanceof SurfaceRegion));
  assert.ok(blends[0].boundaries.some(boundary => blends[1].boundaries.includes(boundary)));
  assert.throws(() => source.round({ radius: 1.01, boundaries: ({ face }) => face?.plane.normal[2] === 1 }), RangeError);
  assert.equal(source.triangulate(), cached); assert.deepEqual(cached, bytes);
});
