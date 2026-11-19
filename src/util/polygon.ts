import { Point } from '../Point.js';

type Loop = readonly Point[];

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * Compute the algebraic area of a polygon loop in local XY coordinates.
 *
 * @param loop - Ordered boundary points, with an implicit closing edge.
 * @returns Positive area for counterclockwise winding, negative for clockwise,
 * or zero for fewer than three points. This function does not validate the loop.
 */
export function signedArea(loop: Loop): number {
  let area = 0;
  for (let i = 1; i + 1 < loop.length; i++) area += cross(loop[0], loop[i], loop[i + 1]);
  return area / 2;
}

/**
 * Classify a point by even-odd ray casting against a polygon loop.
 *
 * @remarks
 * Points on the boundary have no guaranteed classification. Check boundary
 * intersections or contact separately when validating profiles.
 *
 * @param loop - Ordered boundary points, with an implicit closing edge.
 * @param point - Local XY point to classify.
 * @returns Whether the ray crossing parity places the point inside the loop.
 */
export function containsPoint(loop: Loop, point: Point): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i], b = loop[j];
    if ((a.y > point.y) !== (b.y > point.y) &&
        point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function tolerances(loops: readonly Loop[]) {
  const points = loops.flat();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const size = Math.max(maxX - minX, maxY - minY);
  return { length: size * 1e-10, area: size * size * 1e-10 };
}

function onSegment(a: Point, b: Point, p: Point, length: number, area: number): boolean {
  return Math.abs(cross(a, b, p)) <= area &&
    p.x >= Math.min(a.x, b.x) - length && p.x <= Math.max(a.x, b.x) + length &&
    p.y >= Math.min(a.y, b.y) - length && p.y <= Math.max(a.y, b.y) + length;
}

function intersects(a: Point, b: Point, c: Point, d: Point, length: number, area: number): boolean {
  const abC = cross(a, b, c), abD = cross(a, b, d);
  const cdA = cross(c, d, a), cdB = cross(c, d, b);
  if (((abC > area && abD < -area) || (abC < -area && abD > area)) &&
      ((cdA > area && cdB < -area) || (cdA < -area && cdB > area))) return true;
  return onSegment(a, b, c, length, area) || onSegment(a, b, d, length, area) ||
    onSegment(c, d, a, length, area) || onSegment(c, d, b, length, area);
}

/**
 * Validate simple contour boundaries and their separation from one another.
 *
 * @remarks
 * Nested and disconnected loops are both accepted; this does not assign outer
 * boundaries or holes. Comparisons use scale-relative numeric tolerances.
 *
 * @param loops - Ordered point loops without repeated closing points.
 * @throws {@link RangeError} if a loop has fewer than three points, effectively
 * zero or nonfinite area, a degenerate or overlapping edge, or if any boundaries
 * intersect or touch. An empty collection is accepted.
 */
export function validateLoops(loops: readonly Loop[]): void {
  const tolerance = tolerances(loops);
  const edges: { a: Point; b: Point; loop: number; index: number }[] = [];
  loops.forEach((loop, loopIndex) => {
    if (loop.length < 3 || !Number.isFinite(signedArea(loop)) ||
        Math.abs(signedArea(loop)) <= tolerance.area) {
      throw new RangeError('A profile needs at least three points and nonzero area');
    }
    loop.forEach((a, i) => {
      const b = loop[(i + 1) % loop.length], previous = loop[(i + loop.length - 1) % loop.length];
      if (Math.hypot(b.x - a.x, b.y - a.y) <= tolerance.length ||
          (Math.abs(cross(previous, a, b)) <= tolerance.area &&
           (previous.x - a.x) * (b.x - a.x) + (previous.y - a.y) * (b.y - a.y) > 0)) {
        throw new RangeError('Profile edges must have length and must not overlap');
      }
      edges.push({ a, b, loop: loopIndex, index: i });
    });
  });
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i];
    for (let j = i + 1; j < edges.length; j++) {
      const b = edges[j];
      const distance = Math.abs(a.index - b.index);
      if (a.loop === b.loop && (distance === 1 || distance === loops[a.loop].length - 1)) continue;
      if (intersects(a.a, a.b, b.a, b.b, tolerance.length, tolerance.area)) {
        throw new RangeError('Profile boundaries must not intersect or touch');
      }
    }
  }
}

/**
 * Triangulate a planar polygon with disjoint holes without adding vertices.
 *
 * @remarks
 * The first loop is the outer boundary. Remaining loops must be disjoint holes
 * strictly inside it, with no nested holes. Their winding does not matter.
 * Greedy planar triangulation uses O(n³) work and O(n²) storage for n vertices,
 * with scale-relative numeric tolerances.
 *
 * @param loops - Outer boundary followed by holes, without repeated closing points.
 * @returns Flat groups of three indices addressing `loops.flat()`. Triangle
 * winding matches the outer boundary, and holes are excluded.
 * @throws {@link RangeError} if no outer boundary is supplied, boundaries are
 * invalid or incorrectly nested, or a complete triangulation cannot be produced
 * at the current numeric tolerance.
 */
export function triangulatePolygon(loops: readonly Loop[]): number[] {
  if (loops.length === 0) throw new RangeError('A face needs an outer boundary');
  validateLoops(loops);
  const [outer, ...holes] = loops;
  for (const hole of holes) {
    if (!containsPoint(outer, hole[0]) || holes.some((other) => other !== hole && containsPoint(other, hole[0]))) {
      throw new RangeError('Face holes must be disjoint and inside the outer boundary');
    }
  }
  const points = loops.flat(), tolerance = tolerances(loops);
  const inside = (p: Point) => containsPoint(outer, p) && !holes.some((hole) => containsPoint(hole, p));
  const edges: [number, number][] = [];
  const adjacent = points.map(() => new Set<number>());
  const add = (a: number, b: number) => {
    edges.push([a, b]); adjacent[a].add(b); adjacent[b].add(a);
  };
  let offset = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length; i++) add(offset + i, offset + (i + 1) % loop.length);
    offset += loop.length;
  }

  // ponytail: O(n^3) greedy planar triangulation; use a faster constrained
  // triangulator if large sketches make this a bottleneck.
  const candidates: { a: number; b: number; length: number }[] = [];
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      if (!adjacent[a].has(b)) candidates.push({ a, b, length: Math.hypot(points[b].x - points[a].x, points[b].y - points[a].y) });
    }
  }
  candidates.sort((a, b) => a.length - b.length);
  for (const { a, b } of candidates) {
    const start = points[a], end = points[b];
    if (!inside(new Point((start.x + end.x) / 2, (start.y + end.y) / 2))) continue;
    if (points.some((p, i) => i !== a && i !== b && onSegment(start, end, p, tolerance.length, tolerance.area))) continue;
    if (edges.some(([c, d]) => c !== a && c !== b && d !== a && d !== b &&
        intersects(start, end, points[c], points[d], tolerance.length, tolerance.area))) continue;
    add(a, b);
  }

  const triangles: number[] = [];
  let area = 0;
  for (let a = 0; a < points.length; a++) {
    for (const b of adjacent[a]) {
      if (b <= a) continue;
      for (const c of adjacent[b]) {
        if (c <= b || !adjacent[a].has(c)) continue;
        const signed = cross(points[a], points[b], points[c]);
        if (Math.abs(signed) <= tolerance.area) continue;
        const order = signed > 0 ? [a, b, c] : [a, c, b];
        const [p, q, r] = order.map((i) => points[i]);
        if (!inside(new Point((p.x + q.x + r.x) / 3, (p.y + q.y + r.y) / 3))) continue;
        if (points.some((s, i) => i !== a && i !== b && i !== c &&
            cross(p, q, s) > tolerance.area && cross(q, r, s) > tolerance.area && cross(r, p, s) > tolerance.area)) continue;
        triangles.push(...(signedArea(outer) > 0 ? order : order.reverse()));
        area += Math.abs(signed) / 2;
      }
    }
  }
  const expectedArea = Math.abs(signedArea(outer)) - holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
  if (triangles.length / 3 !== points.length + 2 * holes.length - 2 ||
      Math.abs(area - expectedArea) > Math.max(tolerance.area * points.length, expectedArea * 1e-8)) {
    throw new RangeError('Could not triangulate this profile at the current numeric tolerance');
  }
  return triangles;
}
