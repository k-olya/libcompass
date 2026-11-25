import assert from 'node:assert/strict';
import { test } from 'node:test';
import { triangulatePolygon } from '../dist/internal/polygon.js';

test('successive near-collinear simplifications restore vertices on their original boundary edge', () => {
  const points = [[0.25343655286374, 0.33034829032847], [0.25801059518606, 0.34557590211199],
    [0.29460293376466, 0.467396796381], [0.36778761092187, 0.71103858491898], [0.7421875, 1], [0, 0.5]]
    .map(([x, y]) => ({ x, y }));
  const triangles = triangulatePolygon([points], 1e-14);
  assert.equal(triangles.length / 3, points.length - 2);
  assert.equal(new Set(triangles).size, points.length);
});

test('near-collinear boundary vertices are restored once without overlapping slivers', () => {
  const points = [[0.5, 1], [0.43, 1], [0.4, 1], [0.4, 0], [0.6, 0], [0.6, 1], [0.57, 1 + 1e-14]]
    .map(([x, y]) => ({ x, y }));
  const triangles = triangulatePolygon([points], 1e-14);
  assert.equal(triangles.length / 3, points.length - 2);
  assert.equal(new Set(triangles).size, points.length);
  const incidence = new Map();
  for (let i = 0; i < triangles.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = triangles[i + j], b = triangles[i + (j + 1) % 3];
    const key = [a, b].sort((a, b) => a - b).join(',');
    incidence.set(key, (incidence.get(key) ?? 0) + 1);
  }
  points.forEach((_, i) => assert.equal(incidence.get([i, (i + 1) % points.length].sort((a, b) => a - b).join(',')), 1));
});
