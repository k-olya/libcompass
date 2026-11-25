import { vec3, type ReadonlyVec3 } from 'gl-matrix';

type Triangle = { points: ReadonlyVec3[]; ids: number[]; min: number[]; max: number[] };
type Tree = { min: number[]; max: number[]; count: number; triangles?: Triangle[]; left?: Tree; right?: Tree };
const sub = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.subtract([0, 0, 0], a, b);
const cross = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.cross([0, 0, 0], a, b);

/** Reject nonmanifold meshes and sampled self intersections before exposing a sweep solid. */
export function validateSweepMesh(positions: Float32Array): void {
  if (!positions.length || positions.length % 9 || positions.some(value => !Number.isFinite(value))) throw new RangeError('Sweep produced invalid mesh coordinates');
  const vertices = new Map<string, number>(), edges = new Map<string, number[]>(), triangles: Triangle[] = [];
  const incident: number[][] = [];
  let volume = 0, scale = 1;
  const origin = positions.subarray(0, 3);
  for (let offset = 0; offset < positions.length; offset += 9) {
    const points = [0, 3, 6].map(i => Array.from(positions.subarray(offset + i, offset + i + 3)) as [number, number, number]);
    const ids = points.map(point => {
      const key = point.join(',');
      let id = vertices.get(key);
      if (id === undefined) { id = vertices.size; vertices.set(key, id); incident.push([]); }
      incident[id].push(triangles.length);
      return id;
    });
    if (new Set(ids).size !== 3 || vec3.length(cross(sub(points[1], points[0]), sub(points[2], points[0]))) === 0) throw new RangeError('Sweep produced a degenerate triangle');
    for (let i = 0; i < 3; i++) {
      const a = ids[i], b = ids[(i + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      const directions = edges.get(key) ?? [];
      directions.push((a < b ? 1 : -1) * (triangles.length + 1)); edges.set(key, directions);
    }
    volume += vec3.dot(sub(points[0], origin), cross(sub(points[1], origin), sub(points[2], origin))) / 6;
    scale = Math.max(scale, ...points.map(point => vec3.distance(point, origin)));
    triangles.push({ points, ids, min: [0, 1, 2].map(i => Math.min(...points.map(p => p[i]))), max: [0, 1, 2].map(i => Math.max(...points.map(p => p[i]))) });
  }
  const adjacent: number[][] = triangles.map(() => []);
  for (const directions of edges.values()) {
    if (directions.length !== 2 || Math.sign(directions[0]) === Math.sign(directions[1])) throw new RangeError('Sweep mesh is not a closed, consistently oriented manifold');
    const [a, b] = directions.map(value => Math.abs(value) - 1);
    adjacent[a].push(b); adjacent[b].push(a);
  }
  incident.forEach((faces, vertex) => {
    const remaining = new Set(faces), pending = [faces[0]];
    while (pending.length) {
      const face = pending.pop()!;
      if (!remaining.delete(face)) continue;
      for (const next of adjacent[face]) if (remaining.has(next) && triangles[next].ids.includes(vertex)) pending.push(next);
    }
    if (remaining.size) throw new RangeError('Sweep touches itself at a nonmanifold vertex');
  });
  if (!Number.isFinite(volume) || volume <= 0) throw new RangeError('Sweep has zero or reversed volume');
  // Float32 input coordinates are exact doubles here. Tolerance covers the
  // arithmetic below; it must not impose a clearance between separate facets.
  const epsilon = scale * Number.EPSILON * 64;
  const build = (items: Triangle[]): Tree => {
    const min = [0, 1, 2].map(i => items.reduce((value, item) => Math.min(value, item.min[i]), Infinity));
    const max = [0, 1, 2].map(i => items.reduce((value, item) => Math.max(value, item.max[i]), -Infinity));
    if (items.length <= 8) return { min, max, count: items.length, triangles: items };
    const axis = [0, 1, 2].sort((a, b) => (max[b] - min[b]) - (max[a] - min[a]))[0];
    items.sort((a, b) => (a.min[axis] + a.max[axis]) - (b.min[axis] + b.max[axis]));
    const middle = items.length >> 1;
    return { min, max, count: items.length, left: build(items.slice(0, middle)), right: build(items.slice(middle)) };
  };
  const overlaps = (a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }) => a.min.every((value, i) => value <= b.max[i] + epsilon && a.max[i] + epsilon >= b.min[i]);
  const root = build(triangles);
  const visit = (a: Tree, b: Tree): void => {
    if (!overlaps(a, b)) return;
    if (a === b && a.left) { visit(a.left, a.left); visit(a.right!, a.right!); visit(a.left, a.right!); return; }
    if (a.triangles && b.triangles) {
      for (let i = 0; i < a.triangles.length; i++) for (let j = a === b ? i + 1 : 0; j < b.triangles.length; j++) {
        const first = a.triangles[i], second = b.triangles[j];
        if (overlaps(first, second) && intersect(first, second, epsilon)) throw new RangeError('Sweep self-intersects or touches itself; trimming is required');
      }
    } else if (a.left && (!b.left || a.count >= b.count)) { visit(a.left, b); visit(a.right!, b); }
    else { visit(a, b.left!); visit(a, b.right!); }
  };
  visit(root, root);
}

function intersect(a: Triangle, b: Triangle, epsilon: number): boolean {
  const shared = a.points.filter((_, i) => b.ids.includes(a.ids[i]));
  if (shared.length === 3) return true;
  if (shared.length === 2) return false; // Incident triangles share their physical mesh edge.
  if (shared.length === 1) {
    // A separating plane through the common vertex proves that these triangles
    // meet only there. This also avoids unstable grazing-plane intersections
    // between adjacent rows on a nearly planar or conical surface.
    const first = a.points.filter(point => point !== shared[0]).map(point => sub(point, shared[0]));
    const second = b.points.filter(point => !vec3.exactEquals(point, shared[0])).map(point => sub(point, shared[0]));
    const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1], cross(first[0], first[1]), cross(second[0], second[1]),
      ...first.flatMap(x => second.map(y => cross(x, y)))] as ReadonlyVec3[];
    for (const axis of axes) {
      const length = vec3.length(axis);
      if (length === 0) continue;
      const da = first.map(point => vec3.dot(point, axis) / length), db = second.map(point => vec3.dot(point, axis) / length);
      if ((Math.min(...da) > epsilon && Math.max(...db) <= epsilon) || (Math.max(...da) < -epsilon && Math.min(...db) >= -epsilon)
        || (Math.min(...db) > epsilon && Math.max(...da) <= epsilon) || (Math.max(...db) < -epsilon && Math.min(...da) >= -epsilon)) return false;
    }
  }
  const normal = (triangle: Triangle) => vec3.normalize([0, 0, 0], cross(sub(triangle.points[1], triangle.points[0]), sub(triangle.points[2], triangle.points[0])));
  const na = normal(a), nb = normal(b);
  const distances = (triangle: Triangle, plane: Triangle, n: ReadonlyVec3) => triangle.points.map(p => vec3.dot(sub(p, plane.points[0]), n));
  const da = distances(a, b, nb), db = distances(b, a, na);
  const oneSide = (values: number[]) => values.every(x => x > epsilon) || values.every(x => x < -epsilon);
  if (oneSide(da) || oneSide(db)) return false;
  const allowed = (point: ReadonlyVec3) => shared.some(p => vec3.distance(p, point) <= epsilon * 4);
  const inside = (point: ReadonlyVec3, triangle: Triangle, n: ReadonlyVec3) => {
    if (triangle.points.every((p, i) => vec3.dot(cross(sub(triangle.points[(i + 1) % 3], p), sub(point, p)), n) >= 0)) return true;
    // Expanding edge half-planes exaggerates tolerance at acute corners. Use
    // Euclidean distance to finite edges so skinny, separated facets stay apart.
    return triangle.points.some((p, i) => {
      const edge = sub(triangle.points[(i + 1) % 3], p);
      const t = Math.max(0, Math.min(1, vec3.dot(sub(point, p), edge) / vec3.squaredLength(edge)));
      return vec3.distance(point, vec3.scaleAndAdd([0, 0, 0], p, edge, t)) <= epsilon;
    });
  };
  if (da.every(x => Math.abs(x) <= epsilon) && db.every(x => Math.abs(x) <= epsilon)) {
    // Coplanar vertices and edge crossings, including boundary contact.
    for (const [first, second, n] of [[a, b, nb], [b, a, na]] as const) {
      if (first.points.some(point => inside(point, second, n) && !allowed(point))) return true;
    }
    const axis = [0, 1, 2].sort((i, j) => Math.abs(na[j]) - Math.abs(na[i]))[0];
    const axes = [0, 1, 2].filter(i => i !== axis);
    const cross2 = (x: ReadonlyVec3, y: ReadonlyVec3) => x[axes[0]] * y[axes[1]] - x[axes[1]] * y[axes[0]];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const p = a.points[i], q = b.points[j], r = sub(a.points[(i + 1) % 3], p), s = sub(b.points[(j + 1) % 3], q);
      const denominator = cross2(r, s);
      if (Math.abs(denominator) < epsilon * epsilon) continue;
      const t = cross2(sub(q, p), s) / denominator, u = cross2(sub(q, p), r) / denominator;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && !allowed(vec3.scaleAndAdd([0, 0, 0], p, r, t))) return true;
    }
    return false;
  }
  for (const [first, second, values, n] of [[a, b, da, nb], [b, a, db, na]] as const) {
    for (let i = 0; i < 3; i++) {
      const j = (i + 1) % 3, p = first.points[i], q = first.points[j];
      if (Math.abs(values[i]) <= epsilon && inside(p, second, n) && !allowed(p)) return true;
      if (values[i] * values[j] < 0) {
        const point = vec3.lerp([0, 0, 0], p, q, values[i] / (values[i] - values[j]));
        if (inside(point, second, n) && !allowed(point)) return true;
      }
    }
  }
  return false;
}
