import type { Point } from '../Point.js';
import type { Vertex } from '../Vertex.js';
import { vec3 } from 'gl-matrix';

/** Constrained flips in a curvature metric, retaining Float32 triangle quality. */
export function legalizeTriangles(triangles: number[], samples: readonly { uv: Point; point: Vertex }[], metric: readonly [number, number, number] = [1, 0, 1]): void {
  const points = samples.map(({ uv }) => ({ uv: { x: metric[0] * uv.x + metric[1] * uv.y, y: metric[2] * uv.y } }));
  const positions = samples.map(({ point }) => Array.from(point.position, Math.fround) as [number, number, number]);
  const quality = (a: number, b: number, c: number) => {
    const ab = vec3.subtract([0, 0, 0], positions[b], positions[a]), ac = vec3.subtract([0, 0, 0], positions[c], positions[a]);
    return vec3.length(vec3.cross([0, 0, 0], ab, ac)) / Math.max(vec3.squaredLength(ab), vec3.squaredLength(ac), vec3.squaredDistance(positions[b], positions[c]));
  };
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  for (let pass = 0; pass < 64; pass++) {
    const edges = new Map<string, { index: number; a: number; b: number; c: number }>(); let changed = false;
    const occupied = new Set<number>();
    for (let index = 0; index < triangles.length; index += 3) {
      if (occupied.has(index)) continue;
      for (let k = 0; k < 3; k++) {
        const [a, b, c] = [0, 1, 2].map(j => triangles[index + (k + j) % 3]), key = [a, b].sort((a, b) => a - b).join(',');
        const other = edges.get(key);
        if (!other) { edges.set(key, { index, a, b, c }); continue; }
        if (occupied.has(other.index)) continue;
        const d = other.c, [pa, pb, pc, pd] = [a, b, c, d].map(id => points[id].uv);
        if (cross(pc, pd, pa) * cross(pc, pd, pb) >= -1e-24) continue;
        const x = [pa, pb, pc].map(p => ({ x: p.x - pd.x, y: p.y - pd.y }));
        const determinant = x.reduce((sum, p, i) => sum + (p.x ** 2 + p.y ** 2) * (x[(i + 1) % 3].x * x[(i + 2) % 3].y - x[(i + 1) % 3].y * x[(i + 2) % 3].x), 0);
        const before = Math.min(quality(a, b, c), quality(a, b, d)), after = Math.min(quality(c, d, a), quality(c, d, b));
        // Curvature anisotropy must not create slivers that lose their shape
        // when coordinates are finally stored as Float32.
        const repairsSliver = before < 1e-5 && after > before * 1.01;
        if (after < 1e-5 && after < before * 0.99) continue;
        if (!repairsSliver && determinant * Math.sign(cross(pa, pb, pc)) <= 1e-18) continue;
        const oriented = (ids: number[]) => cross(...ids.map(id => points[id].uv) as [Point, Point, Point]) > 0 ? ids : [ids[0], ids[2], ids[1]];
        triangles.splice(index, 3, ...oriented([c, d, a])); triangles.splice(other.index, 3, ...oriented([d, c, b]));
        occupied.add(index); occupied.add(other.index); changed = true; break;
      }
    }
    if (!changed) break;
  }
}
