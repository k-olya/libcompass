import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vec3 } from 'gl-matrix';
import { center, negZ, node, rectangle, roundPolyline, sketch, SurfaceRegion, X } from 'libcompass';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';
import { surfaceFrame } from '../dist/internal/surfaceGeometry.js';
import { boundaryPlacement } from '../dist/internal/surfaceRails.js';

const bottom = ({ face }) => face?.plane.normal && vec3.equals(face.plane.normal, negZ);
const top = ({ face }) => face?.plane.normal[2] > 0 && face.plane.normal[2] < 0.99;
function volume(part) {
  const positions = part.triangulate();
  validateSweepMesh(positions);
  for (const boundary of part.boundaries) assert.equal(part.surfaces.filter(surface => surface.boundaries.includes(boundary)).length, 2);
  let sum = 0;
  for (let i = 0; i < positions.length; i += 9) sum += vec3.dot(positions.subarray(i, i + 3),
    vec3.cross([0, 0, 0], positions.subarray(i + 3, i + 6), positions.subarray(i + 6, i + 9))) / 6;
  return sum;
}

test('an asymmetric pencil box with a deep pocket supports bottom chamfer then top rounds', () => {
  const body = sketch().add(roundPolyline({ segments: rectangle({ center, width: 76.5, height: 79.5 }), radius: 12 })).extrude(160);
  const pocket = body.extrudeCut({ sketch: sketch(body.surfaces.find(surface => surface.plane?.normal[2] === 1))
    .add(roundPolyline({ segments: rectangle({ center, width: 67.5, height: 73.5 }), radius: 9 })), length: -157 });
  const tool = sketch().add(rectangle({ center, width: 160, height: 160 })).extrude(80)
    .rotate({ axis: X, angle: 30 }).displace([0, 0, 120]);
  const cut = pocket.difference({ tool }), chamfered = cut.chamfer({ length: 1, boundaries: bottom });
  const cached = chamfered.triangulate(), bytes = cached.slice(), surfaces = [...chamfered.surfaces];
  const result = chamfered.round({ radius: 1, boundaries: top });
  assert.equal(result.surfaces.length, 8); assert.equal(result.boundaries.length, 7);
  assert.ok(volume(result) < volume(chamfered));
  const floor = chamfered.surfaces.find(surface => surface.plane?.normal[2] === 1);
  assert.equal(floor.plane.origin[2], 3); assert.ok(result.surfaces.includes(floor));
  assert.equal(chamfered.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(chamfered.surfaces, surfaces);
});

test('chamfer and round reuse boolean-trimmed pencil-box walls and oblique cut rims', () => {
  const body = sketch().add(roundPolyline({ segments: rectangle({ center, width: 79.5, height: 79.5 }), radius: 12 })).extrude(160);
  const pocket = body.extrudeCut({ sketch: sketch(body.surfaces.find(surface => surface.plane?.normal[2] === 1))
    .add(roundPolyline({ segments: rectangle({ center, width: 73.5, height: 73.5 }), radius: 9 })), length: -77 });
  const tool = sketch().add(rectangle({ center, width: 160, height: 160 })).extrude(80)
    .rotate({ axis: X, angle: 30 }).displace([0, 0, 120]);
  const part = pocket.difference({ tool }), child = node(); part.add(child);
  const cached = part.triangulate(), bytes = cached.slice(), surfaces = [...part.surfaces], boundaries = [...part.boundaries];
  const originalVolume = volume(part);
  const bottomChamfer = part.chamfer({ length: 1, boundaries: bottom });
  const bottomRound = part.round({ radius: 1, boundaries: bottom });
  const topChamfer = part.chamfer({ length: 0.5, boundaries: top });
  const topRound = bottomChamfer.round({ radius: 1, boundaries: top });
  for (const result of [bottomChamfer, bottomRound, topChamfer, topRound]) {
    const resultVolume = volume(result);
    assert.ok(resultVolume > originalVolume * 0.99 && resultVolume < originalVolume);
    assert.deepEqual(result.children, [child]); assert.notEqual(result.children, part.children);
    assert.ok(result.surfaces.includes(surfaces[1]), 'The distant pocket floor stays unchanged');
    for (const region of result.surfaces.filter(surface => surface instanceof SurfaceRegion)) {
      assert.ok(surfaces.some(source => source instanceof SurfaceRegion && source.surface === region.surface));
      assert.deepEqual(region.at(0.37, 0.43), region.surface.at(0.37, 0.43));
    }
  }
  // The two top blends must be tangent to their retained walls and cap, with
  // constant-radius circular cross sections, rather than faceted substitutes.
  for (const patch of topRound.surfaces.slice(-2)) for (const u of [0.05, 0.19, 0.41, 0.61, 0.93]) {
    const centers = [patch.sides.v0, patch.sides.v1].map(boundary => {
      const surface = topRound.surfaces.find(surface => surface !== patch && surface.boundaries.includes(boundary));
      const uv = boundaryPlacement(surface, boundary).uv(u), normal = surfaceFrame(surface, uv).normal;
      const blendNormal = surfaceFrame(patch, { x: u, y: boundary === patch.sides.v0 ? 0 : 1 }).normal;
      assert.ok(vec3.distance(normal, blendNormal) < 1e-5, JSON.stringify({ u, uv, normal, blendNormal }));
      return vec3.subtract([0, 0, 0], boundary.at(u).position, normal);
    });
    assert.ok(vec3.distance(...centers) < 1e-5);
    assert.ok(Math.abs(vec3.distance(patch.at(u, 0.37).position, centers[0]) - 1) < 1e-5);
  }
  // At length 1 the two top bevels consume the three-unit wall at its narrowest
  // section. Keep rejecting that contact instead of returning a pinched solid.
  assert.throws(() => part.chamfer({ length: 1, boundaries: top }), RangeError);
  assert.equal(part.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(part.surfaces, surfaces); assert.deepEqual(part.boundaries, boundaries);
});


test('two-unit pencil-box walls round through partial rail convergence and reject overlap', () => {
  const body = sketch().add(roundPolyline({ segments: rectangle({ center, width: 77.5, height: 79.5 }), radius: 8 })).extrude(160);
  const pocket = body.extrudeCut({ sketch: sketch(body.surfaces.find(surface => surface.plane?.normal[2] === 1))
    .add(roundPolyline({ segments: rectangle({ center, width: 71.5, height: 75.5 }), radius: 6 })), length: -158 });
  const tool = sketch().add(rectangle({ center, width: 160, height: 160 })).extrude(80)
    .rotate({ axis: X, angle: 30 }).displace([0, 0, 120]);
  const part = pocket.difference({ tool }).chamfer({ length: 1, boundaries: bottom }), child = node();
  part.add(child);
  const cached = part.triangulate(), bytes = cached.slice(), surfaces = [...part.surfaces], boundaries = [...part.boundaries];
  const initialVolume = volume(part);
  for (const radius of [0.05, 0.2, 0.5, 0.9, 0.99, 1]) {
    let result;
    assert.doesNotThrow(() => { result = part.round({ radius, boundaries: top }); }, `Radius ${radius} must fit`);
    const resultVolume = volume(result);
    assert.ok(resultVolume > initialVolume * 0.99 && resultVolume < initialVolume * 1.001);
    if (radius >= 0.5) assert.ok(resultVolume < initialVolume);
    assert.deepEqual(result.children, [child]); assert.notEqual(result.children, part.children);
    if (radius === 1) {
      const caps = result.surfaces.filter(face => face.plane?.normal[2] > 0 && face.plane.normal[2] < 0.99);
      assert.equal(caps.length, 2, 'The consumed strips divide the retained cap into two faces');
      const blends = result.surfaces.slice(-2);
      assert.ok(blends.every(surface => surface instanceof SurfaceRegion));
      const shared = blends[0].boundaries.filter(boundary => blends[1].boundaries.includes(boundary));
      assert.ok(shared.length >= 2, 'Opposing blends share the converged contact curves');
      for (const boundary of shared) for (const t of [0.1, 0.5, 0.9]) {
        const normals = blends.map(surface => surfaceFrame(surface, boundaryPlacement(surface, boundary).uv(t)).normal);
        assert.ok(vec3.dot(...normals) > 1 - 1e-7, 'The converged blends remain tangent');
      }
    }
  }
  for (const radius of [1.001, 1.1]) assert.throws(() => part.round({ radius, boundaries: top }), RangeError);
  assert.equal(part.triangulate(), cached); assert.deepEqual(cached, bytes);
  assert.deepEqual(part.surfaces, surfaces); assert.deepEqual(part.boundaries, boundaries);
});
