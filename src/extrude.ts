import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Circle } from './Circle.js';
import { Edge } from './Edge.js';
import { Face } from './Face.js';
import { LineSegment } from './LineSegment.js';
import type { Point } from './Point.js';
import type { Sketch } from './Sketch.js';
import { Solid } from './Solid.js';
import { validateVertex, type Vertex } from './Vertex.js';
import { containsPoint, signedArea, validateLoops } from './util/polygon.js';

function profiles(sketch: Sketch, circleSegments: number): Point[][] {
  const loops = sketch.elements.filter((element) => element instanceof Circle).map((circle) => circle.sample(circleSegments));
  const segments = new Set(sketch.elements.filter((element) => element instanceof LineSegment));
  // Endpoints are matched by coordinates, allowing independent point objects.
  const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  const degree = (point: Point) => [...segments].filter((segment) => equal(segment.start, point) || equal(segment.end, point)).length;
  for (const segment of segments) {
    if (degree(segment.start) !== 2 || degree(segment.end) !== 2) {
      throw new RangeError('Sketch segments must form closed, unbranched loops');
    }
  }
  while (segments.size) {
    const first = segments.values().next().value!;
    segments.delete(first);
    const loop = [first.start];
    let end = first.end;
    while (!equal(end, first.start)) {
      loop.push(end);
      const next = [...segments].find((segment) => equal(segment.start, end) || equal(segment.end, end));
      if (!next) throw new RangeError('Sketch segments must form closed loops');
      segments.delete(next);
      end = equal(next.start, end) ? next.end : next.start;
    }
    loops.push(loop);
  }
  if (!loops.length) throw new RangeError('Extrusion needs at least one closed profile');
  validateLoops(loops);
  return loops;
}

/**
 * Extrude all filled sketch regions along a world-space displacement vector.
 *
 * @remarks
 * Closed profiles use even-odd nesting to determine material, holes, and
 * islands, independently of contour winding and insertion order. Points and
 * infinite lines are ignored as construction geometry. Segment endpoints must
 * match exactly by local XY coordinates. Circles are faceted during extrusion.
 *
 * The result is a snapshot: later edits to the sketch's elements do not change
 * it. Caps and walls share vertex and edge identities. Each triangle is wound
 * outward, including when the displacement opposes the sketch plane normal.
 *
 * @param options - Sketch, world-space displacement, and optional circle resolution.
 * @param options.sketch - Drawing containing closed segment loops and/or circles.
 * @param options.direction - Finite world-space displacement, not a unit direction;
 * oblique extrusion is supported. Its normal component must exceed the
 * relative coplanarity tolerance of `1e-10` times its length.
 * @param options.circleSegments - Polygon segments per circle; integer of at least
 * three, defaulting to 64. Validation uses these tessellated boundaries.
 * @returns A new solid with caps and walls for all filled regions, including
 * disconnected components and through holes.
 * @throws {@link RangeError} if the direction is nonfinite, zero, or effectively
 * coplanar; circle resolution is invalid; profiles are absent, open, branched,
 * degenerate, intersecting, or touching; or triangulation fails at the current
 * numeric tolerance.
 *
 * @example
 * ```ts
 * const sketch = new Sketch().add(
 *   new Circle({ center: { x: 0, y: 0 }, radius: 5 }),
 *   new Circle({ center: { x: 0, y: 0 }, radius: 2 }),
 * );
 * const tube = extrude({ sketch, direction: [0, 0, 10], circleSegments: 32 });
 * const positions = tube.triangulate();
 * ```
 */
export function extrude({ sketch, direction, circleSegments = 64 }: {
  sketch: Sketch;
  direction: ReadonlyVec3;
  circleSegments?: number;
}): Solid {
  if (![direction[0], direction[1], direction[2]].every(Number.isFinite)) {
    throw new RangeError('Extrusion direction must be finite');
  }
  const depth = vec3.dot(sketch.plane.normal, direction);
  if (Math.abs(depth) <= vec3.length(direction) * 1e-10 || !Number.isFinite(depth)) {
    throw new RangeError('Extrusion direction must leave the sketch plane');
  }
  if (!Number.isInteger(circleSegments) || circleSegments < 3) {
    throw new RangeError('Circle resolution must be an integer of at least three');
  }
  const loops = profiles(sketch, circleSegments);
  const areas = loops.map((loop) => Math.abs(signedArea(loop)));
  const parents = loops.map((loop, i) => {
    let parent = -1;
    loops.forEach((candidate, j) => {
      if (i !== j && areas[j] > areas[i] && containsPoint(candidate, loop[0]) &&
          (parent === -1 || areas[j] < areas[parent])) parent = j;
    });
    return parent;
  });
  const depths = parents.map((parent) => {
    let depth = 0;
    for (let index = parent; index !== -1; index = parents[index]) depth++;
    return depth;
  });

  const faces: Face[] = [];
  // Share boundary objects across caps and sides, including hole boundaries.
  const edgeMap = new Map<Vertex, Map<Vertex, Edge>>();
  const edge = (a: Vertex, b: Vertex): Edge => {
    const existing = edgeMap.get(a)?.get(b) ?? edgeMap.get(b)?.get(a);
    if (existing) return existing;
    const result = new Edge({ start: a, end: b });
    if (!edgeMap.has(a)) edgeMap.set(a, new Map());
    edgeMap.get(a)!.set(b, result);
    return result;
  };
  const face = (boundaries: Vertex[][]) => {
    const edges = boundaries.flatMap((loop) => loop.map((a, i) => edge(a, loop[(i + 1) % loop.length])));
    faces.push(new Face({ outer: boundaries[0], holes: boundaries.slice(1), edges }));
  };

  loops.forEach((outer, index) => {
    if (depths[index] % 2 !== 0) return;
    const region = [outer, ...loops.filter((_, i) => parents[i] === index)];
    const oriented = region.map((loop, i) => (signedArea(loop) > 0) === (i === 0) ? [...loop] : [...loop].reverse());
    const bottom = oriented.map((loop) => loop.map((point) => sketch.plane.toWorld(point)));
    const top = bottom.map((loop) => loop.map((vertex) => validateVertex({ position: vec3.add([0, 0, 0], vertex.position, direction) })));
    face(depth > 0 ? bottom.map((loop) => [...loop].reverse()) : bottom);
    face(depth > 0 ? top : top.map((loop) => [...loop].reverse()));
    bottom.forEach((loop, i) => loop.forEach((a, j) => {
      const next = (j + 1) % loop.length;
      const side = [a, loop[next], top[i][next], top[i][j]];
      face([depth > 0 ? side : side.reverse()]);
    }));
  });
  return new Solid({ faces });
}
