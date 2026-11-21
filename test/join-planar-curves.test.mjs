import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlanarCurve, SpatialCurve, XY, center, centerRectangle, lineSegment, roundPolyline, sketch, spatialCurve } from 'libcompass';
import { joinPlanarCurves } from '../dist/internal/joinPlanarCurves.js';
import { sketchProfiles } from '../dist/internal/profiles.js';
import { validateSweepMesh } from '../dist/internal/validateSweepMesh.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const entry = (curve, reversed = false) => ({ curve, reversed, straight: false });
function quarters(rx, ry, reversed = []) {
  const points = [{ x: rx, y: 0 }, { x: 0, y: ry }, { x: -rx, y: 0 }, { x: 0, y: -ry }];
  return points.map((point, i) => new PlanarCurve({ at: t => {
    if (reversed.includes(i)) t = 1 - t;
    const angleRAD = (i + t) * Math.PI / 2;
    return t === 0 ? point : t === 1 ? points[(i + 1) % 4] : { x: rx * Math.cos(angleRAD), y: ry * Math.sin(angleRAD) };
  } }));
}

test('rounded-square arcs extrude a seamless cylinder and round into an exact sphere', () => {
  const arcs = roundPolyline({ segments: centerRectangle({ center, corner: { x: 10, y: 10 } }), radius: 10 });
  const source = sketch().add(arcs), elements = [...source.elements];
  const cylinder = source.extrude({ length: 20 });
  assert.deepEqual(source.elements, elements);
  assert.equal(cylinder.surfaces.length, 3);
  assert.equal(cylinder.boundaries.length, 2);
  assert.equal(cylinder.vertices.length, 2);
  assert.ok(cylinder.boundaries.every(boundary => boundary instanceof SpatialCurve && boundary.isLoop()));
  validateSweepMesh(cylinder.triangulate());
  const sphere = cylinder.round({ radius: 10 });
  assert.equal(sphere.surfaces.length, 2);
  for (const surface of sphere.surfaces) for (const u of [0, 0.123, 0.5, 0.82, 1]) for (const v of [0, 0.24, 0.71, 1]) {
    const [x, y, z] = surface.at(u, v).position;
    close(Math.hypot(x, y, z - 10), 10);
  }
  validateSweepMesh(sphere.triangulate());
});

test('smooth runs remain open and join across the profile seam despite reversed source curves', () => {
  const arcs = quarters(3, 2, [1]);
  const diameter = lineSegment({ start: arcs[0].start, end: arcs[1].start });
  const source = sketch().add(arcs[1], diameter, arcs[0]);
  const profile = sketchProfiles(source)[0];
  assert.equal(profile.boundaries.length, 2);
  const merged = profile.boundaries.find(boundary => !boundary.straight).curve;
  assert.equal(merged.isLoop(), false);
  assert.deepEqual([merged.start, merged.end], [arcs[1].start, arcs[0].start]);
  for (const t of [0, 0.13, 0.49, 0.5, 0.84, 1]) {
    const expected = t < 0.5 ? arcs[1].at(2 * t) : arcs[0].at(2 - 2 * t);
    assert.deepEqual(merged.at(t), expected);
  }
  close(merged.tangent(0.5)[0], 1);
  const solid = source.extrude({ length: 2 });
  assert.equal(solid.surfaces.length, 4);
  assert.equal(solid.boundaries.length, 6);
  validateSweepMesh(solid.triangulate());
});

test('composites retain nonuniform sample overrides, parameters, resolution, and exact lifted tangents', () => {
  const arcs = quarters(3, 2, [1]);
  const parameters = [[0, 0.1, 0.4, 0.7, 1], [0, 0.2, 0.55, 1]];
  const requests = [];
  arcs.slice(0, 2).forEach((curve, i) => {
    curve.sampleParameters = () => { throw new Error('Bypassed sample override'); };
    curve.sample = options => { requests.push(options.resolution); return parameters[i].map(t => curve.at(t)); };
  });
  const diameter = lineSegment({ start: arcs[0].start, end: arcs[1].start });
  const merged = sketchProfiles(sketch().add(arcs[1], diameter, arcs[0]))[0].boundaries.find(boundary => !boundary.straight).curve;
  requests.length = 0;
  const samples = merged.sampleWithParameters({ resolution: 0.03 });
  const expected = [...parameters[1].map(t => t / 2), ...parameters[0].slice().reverse().slice(1).map(t => (2 - t) / 2)];
  assert.deepEqual(samples.map(({ t }) => t), expected);
  assert.deepEqual(requests, [0.03, 0.03]);
  for (const { t, point } of samples) {
    const expectedPoint = merged.at(t);
    close(point.x, expectedPoint.x); close(point.y, expectedPoint.y);
  }
  const lifted = SpatialCurve.fromPlanarCurve({ curve: merged, plane: XY });
  assert.deepEqual(lifted.sampleWithParameters({ resolution: 0.02 }).map(({ t }) => t), expected);
  assert.deepEqual(requests.slice(-2), [0.02, 0.02]);
  for (const t of [0, 0.3, 0.5, 1]) {
    const tangent = merged.tangent(t), spatial = lifted.tangent(t);
    close(spatial[0], tangent[0]); close(spatial[1], tangent[1]); close(spatial[2], 0);
  }
});

test('existing loops never join each other or an open curve touching their endpoints', () => {
  const loop = x => new PlanarCurve({ at: t => {
    const angleRAD = (t === 1 ? 0 : t) * 2 * Math.PI;
    return { x: x + (x === 0 ? 1 : -1) * Math.cos(angleRAD), y: Math.sin(angleRAD) };
  } });
  const a = loop(0), b = loop(2);
  assert.deepEqual(a.start, b.start);
  const boundaries = [entry(a), entry(b)];
  assert.equal(joinPlanarCurves(boundaries), boundaries);
  const open = new PlanarCurve({ at: t => ({ x: 1, y: t }) });
  for (const boundaries of [[entry(a), entry(open)], [entry(open, true), entry(a)]]) {
    assert.equal(joinPlanarCurves(boundaries), boundaries);
  }
  assert.throws(() => sketch().add(a, b).extrude({ length: 1 }), /intersect|touch/i);
});

test('sharp corners, cusps, and unresolved tangents keep their physical joins', () => {
  const a = new PlanarCurve({ at: t => ({ x: t, y: 0 }) });
  for (const b of [
    new PlanarCurve({ at: t => ({ x: 1, y: t }) }),
    new PlanarCurve({ at: t => ({ x: 1 - t, y: t * t }) }),
    new PlanarCurve({ at: t => ({ x: 1 + t, y: 0 }), tangent: () => [0, 0] }),
  ]) {
    const boundaries = [entry(a), entry(b)];
    assert.equal(joinPlanarCurves(boundaries), boundaries);
  }
  // Both quadratics meet smoothly at p; their other, coincident endpoints have a corner.
  const p = { x: 1, y: 1 }, origin = { x: 0, y: 0 };
  const upper = new PlanarCurve({ at: t => ({ x: t, y: 2 * t - t * t }) });
  const lower = new PlanarCurve({ at: t => ({ x: 1 + t - 2 * t * t, y: 1 - t * t }) });
  assert.deepEqual(upper.end, p); assert.deepEqual(lower.end, origin);
  const boundaries = [entry(upper), entry(lower)];
  assert.equal(joinPlanarCurves(boundaries).length, 2);
});

test('sweeps and drafts use the same joined exact profiles without intermediate seams', () => {
  const source = sketch().add(quarters(3, 2));
  const sweep = source.extrudeAlongCurve({ curve: spatialCurve({ at: t => ({ position: [0, 0, 4 * t] }) }) });
  assert.equal(sweep.surfaces.length, 3);
  assert.equal(sweep.boundaries.length, 2);
  validateSweepMesh(sweep.triangulate());
  const draft = source.extrude({ length: 2, angle: -5 });
  assert.equal(draft.surfaces.length, 3);
  assert.equal(draft.boundaries.length, 2);
  validateSweepMesh(draft.triangulate());
});
