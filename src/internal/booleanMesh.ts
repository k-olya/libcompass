import { vec3, type ReadonlyVec3 } from 'gl-matrix';

type Triangle = { points: ReadonlyVec3[]; min: number[]; max: number[] };
type Tree = { min: number[]; max: number[]; triangles?: Triangle[]; left?: Tree; right?: Tree };
const sub = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.subtract([0, 0, 0], a, b);
const cross = (a: ReadonlyVec3, b: ReadonlyVec3) => vec3.cross([0, 0, 0], a, b);
const overlaps = (a: Tree | Triangle, b: Tree | Triangle, tolerance: number) => a.min.every((x, i) => x <= b.max[i] + tolerance && a.max[i] + tolerance >= b.min[i]);

function tree(triangles: Triangle[]): Tree {
  const min = [0, 1, 2].map(i => triangles.reduce((n, t) => Math.min(n, t.min[i]), Infinity));
  const max = [0, 1, 2].map(i => triangles.reduce((n, t) => Math.max(n, t.max[i]), -Infinity));
  if (triangles.length <= 8) return { min, max, triangles };
  const axis = [0, 1, 2].sort((a, b) => max[b] - min[b] - (max[a] - min[a]))[0];
  triangles.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
  const middle = triangles.length >> 1;
  return { min, max, left: tree(triangles.slice(0, middle)), right: tree(triangles.slice(middle)) };
}

/** Triangle SAT, including coplanar contacts. Used only to discover unsupported surface intersections. */
function intersects(a: Triangle, b: Triangle, tolerance: number): boolean {
  const edges = (t: Triangle) => t.points.map((point, i) => sub(t.points[(i + 1) % 3], point));
  const first = edges(a), second = edges(b), na = cross(first[0], first[1]), nb = cross(second[0], second[1]);
  const axes = [na, nb, ...first.flatMap(x => second.map(y => cross(x, y))),
    ...first.map(x => cross(x, na)), ...second.map(x => cross(x, nb))];
  for (const axis of axes) {
    const length = vec3.length(axis);
    if (length < 1e-20) continue;
    const project = (point: ReadonlyVec3) => vec3.dot(sub(point, a.points[0]), axis) / length;
    const da = a.points.map(project), db = b.points.map(project);
    if (Math.min(...da) > Math.max(...db) + tolerance || Math.min(...db) > Math.max(...da) + tolerance) return false;
  }
  return true;
}

/** Temporary analysis mesh; never used as the boolean's output geometry. */
export class BooleanMesh {
  readonly triangles: Triangle[];
  readonly bounds: Tree;
  constructor(positions: Float32Array) {
    this.triangles = [];
    for (let i = 0; i < positions.length; i += 9) {
      const points = [0, 3, 6].map(j => Array.from(positions.subarray(i + j, i + j + 3)) as [number, number, number]);
      this.triangles.push({ points, min: [0, 1, 2].map(k => Math.min(...points.map(p => p[k]))),
        max: [0, 1, 2].map(k => Math.max(...points.map(p => p[k]))) });
    }
    this.bounds = tree([...this.triangles]);
  }

  /** Generalized winding number supports disconnected shells and enclosed cavities. */
  contains(point: ReadonlyVec3): boolean {
    let windingRAD = 0;
    for (const triangle of this.triangles) {
      const [a, b, c] = triangle.points.map(p => sub(p, point));
      const [la, lb, lc] = [a, b, c].map(p => vec3.length(p));
      windingRAD += 2 * Math.atan2(vec3.dot(a, cross(b, c)), la * lb * lc + vec3.dot(a, b) * lc + vec3.dot(b, c) * la + vec3.dot(c, a) * lb);
    }
    if (!Number.isFinite(windingRAD)) throw new RangeError('Boolean point classification is unresolved');
    return Math.abs(windingRAD) > 2 * Math.PI;
  }

  intersects(other: BooleanMesh, tolerance: number): boolean {
    const visit = (a: Tree, b: Tree): boolean => {
      if (!overlaps(a, b, tolerance)) return false;
      if (a.triangles && b.triangles) return a.triangles.some(x => b.triangles!.some(y => overlaps(x, y, tolerance) && intersects(x, y, tolerance)));
      if (a.left) return visit(a.left, b) || visit(a.right!, b);
      return visit(a, b.left!) || visit(a, b.right!);
    };
    return visit(this.bounds, other.bounds);
  }
}
