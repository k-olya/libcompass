import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { circle, difference, extrude, extrudeCut, Face, intersect, lineSegment, node, plane, sketch, solid,
  SpatialSurface, spatialCurve, setTriangulationResolution } from 'libcompass';
import { difference as differenceOperation } from 'libcompass/operations/difference';
import { intersect as intersectOperation } from 'libcompass/operations/intersect';
import { extrudeCut as cutOperation } from 'libcompass/operations/extrudeCut';
import { sameBooleanBoundary } from '../dist/internal/booleanTopology.js';

setTriangulationResolution(0.01);
const close = (a, b, tolerance = 1e-5) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const box = (min = [0, 0, 0], max = [10, 10, 10]) => {
  const points = [[min[0], min[1]], [max[0], min[1]], [max[0], max[1]], [min[0], max[1]]].map(([x, y]) => ({ x, y }));
  const s = sketch({ plane: plane({ a: [0, 0, min[2]], b: [1, 0, min[2]], c: [0, 1, min[2]] }) });
  s.add(...points.map((start, i) => lineSegment({ start, end: points[(i + 1) % points.length] })));
  return extrude({ sketch: s, length: max[2] - min[2] });
};
const roundSketch = (z = 0, radius = 1) => sketch({ plane: plane({ a: [0, 0, z], b: [1, 0, z], c: [0, 1, z] }) })
  .add(circle({ center: { x: 5, y: 5 }, radius }));
function check(result, expected, tolerance = 1e-5) {
  const mesh = result.triangulate(), edges = new Map();
  let volume = 0;
  for (let i = 0; i < mesh.length; i += 9) {
    const points = [0, 3, 6].map(j => Array.from(mesh.subarray(i + j, i + j + 3)));
    const cross = vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], points[1], points[0]), vec3.subtract([0, 0, 0], points[2], points[0]));
    assert.ok(vec3.length(cross) > 0);
    volume += vec3.dot(points[0], vec3.cross([0, 0, 0], points[1], points[2])) / 6;
    for (let j = 0; j < 3; j++) {
      const a = points[j].join(','), b = points[(j + 1) % 3].join(','), key = [a, b].sort().join('|');
      edges.set(key, [...(edges.get(key) ?? []), a < b ? 1 : -1]);
    }
  }
  for (const directions of edges.values()) assert.deepEqual(directions.sort(), [-1, 1]);
  for (const boundary of result.boundaries) assert.equal(result.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  close(volume, expected, tolerance);
  return mesh;
}

test('boolean operations and Solid methods produce new exact closed planar solids', () => {
  assert.equal(differenceOperation, difference); assert.equal(intersectOperation, intersect); assert.equal(cutOperation, extrudeCut);
  const a = box(), b = box([5, 5, 5], [15, 15, 15]), child = node();
  a.add(child);
  const cached = a.triangulate(), bytes = cached.slice(), coordinates = a.vertices.map(vertex => [...vertex.position]);
  const common = a.intersect({ tool: b }), cut = a.difference({ tool: b });
  check(common, 125); check(cut, 875);
  assert.ok(common.surfaces.every(surface => surface instanceof Face));
  assert.equal(common.surfaces.length, 6);
  assert.notEqual(common, a); assert.notEqual(cut, a);
  assert.equal(a.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(a.vertices.map(vertex => [...vertex.position]), coordinates);
  assert.deepEqual(common.children, [child]); assert.notEqual(common.children, a.children);
  check(intersect({ solid: b, tool: a }), 125);
});

test('coplanar, touching, disjoint, equal, empty and contained operands are regularized', () => {
  const a = box();
  check(intersect({ solid: a, tool: box([5, 0, 0], [15, 10, 10]) }), 500);
  check(difference({ solid: a, tool: box([5, 0, 0], [15, 10, 10]) }), 500);
  for (const b of [box([20, 0, 0], [30, 10, 10]), box([10, 0, 0], [20, 10, 10])]) {
    check(intersect({ solid: a, tool: b }), 0); check(difference({ solid: a, tool: b }), 1000);
  }
  for (const b of [a, box()]) { check(intersect({ solid: a, tool: b }), 1000); check(difference({ solid: a, tool: b }), 0); }
  const inside = box([2, 2, 2], [4, 4, 4]);
  check(intersect({ solid: a, tool: inside }), 8);
  check(difference({ solid: a, tool: inside }), 992);
  check(difference({ solid: inside, tool: a }), 0);
  const empty = solid({ surfaces: [] });
  check(intersect({ solid: a, tool: empty }), 0); check(difference({ solid: a, tool: empty }), 1000);
  check(difference({ solid: empty, tool: a }), 0);
});

test('planar booleans can split components and create through holes and blind pockets', () => {
  const a = box();
  const through = box([4, -1, -1], [6, 11, 11]);
  check(difference({ solid: a, tool: through }), 800);
  check(intersect({ solid: a, tool: through }), 200);
  check(difference({ solid: a, tool: box([3, 3, -1], [7, 7, 11]) }), 840);
  check(difference({ solid: a, tool: box([3, 3, 7], [7, 7, 11]) }), 952);
});

test('curved cutter walls remain mathematical for through cuts, blind pockets and intersections', () => {
  const a = box();
  const tool = extrude({ sketch: roundSketch(-1), length: 12 });
  const cut = difference({ solid: a, tool });
  check(cut, 1000 - Math.PI * 10, 0.3);
  assert.ok(cut.surfaces.some(surface => surface instanceof SpatialSurface));
  check(intersect({ solid: a, tool }), Math.PI * 10, 0.3);
  const pocket = a.extrudeCut({ sketch: roundSketch(10), length: -3 });
  check(pocket, 1000 - 3 * Math.PI, 0.1);
  const shorthand = extrudeCut({ solid: a, sketch: roundSketch(-1), length: 12 });
  assert.deepEqual(shorthand.triangulate(), cut.triangulate());
  const startAtFace = a.extrudeCut({ sketch: roundSketch(), length: 10 });
  check(startAtFace, 1000 - Math.PI * 10, 0.3);
  const drafted = a.extrudeCut({ sketch: roundSketch(10), axis: [0, 0, -4], length: 3, angle: 3 });
  const radius = 1 + 3 * Math.tan(3 * Math.PI / 180);
  check(drafted, 1000 - Math.PI * (1 + radius + radius * radius), 0.15);
  const contained = extrude({ sketch: roundSketch(3), length: 2 });
  check(difference({ solid: a, tool: contained }), 1000 - 2 * Math.PI, 0.1);
});

test('invalid inputs throw without changing operands', () => {
  const a = box(), cached = a.triangulate();
  assert.throws(() => difference({ solid: a, tool: {} }), TypeError);
  assert.throws(() => intersect({ solid: a, tool: solid({ surfaces: [a.surfaces[0]] }) }), /closed/);
  assert.throws(() => a.extrudeCut({ sketch: roundSketch(), length: 0 }), /length/);
  assert.equal(a.triangulate(), cached);
});

test('boundary sewing does not mistake hidden oscillations exposed by sample overrides for coincident curves', () => {
  const straight = spatialCurve({ at: t => ({ position: [t, 0, 0] }) });
  const oscillating = spatialCurve({ at: t => ({ position: [t, 0, t === 1 ? 0 : Math.sin(8 * Math.PI * t)] }) });
  oscillating.sample = () => [0, 0.0625, 1].map(t => oscillating.at(t));
  assert.equal(sameBooleanBoundary(straight, oscillating, false, 1e-8), false);
});
