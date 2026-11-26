import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import type { Tessellation } from './Tessellation.js';

export const samePosition = (a: Vertex, b: Vertex): boolean => Array.from(a.position).every((value, i) => value === b.position[i]);

/** Assemble closed loops from shared boundary identities; reject branching joins. */
export function assembleBoundaryLoops(boundaries: readonly SpatialBoundary[]): SpatialBoundary[][] {
  const remaining = new Set(boundaries), result: SpatialBoundary[][] = [];
  while (remaining.size) {
    const first = remaining.values().next().value!, loop = [first]; remaining.delete(first);
    let vertex = first.end;
    while (vertex !== first.start) {
      const adjacent = [...remaining].filter(boundary => boundary.start === vertex || boundary.end === vertex);
      if (adjacent.length !== 1) throw new RangeError('Boolean trims cannot be sewn into manifold boundary loops');
      const next = adjacent[0]; remaining.delete(next); loop.push(next); vertex = next.start === vertex ? next.end : next.start;
    }
    result.push(loop);
  }
  return result;
}

/** Orient shared boundary objects along an ordered, closed trim loop. */
export function orientLoop(loop: readonly SpatialBoundary[]): { boundary: SpatialBoundary; reversed: boolean }[] {
  if (!loop.length) throw new RangeError('A surface needs a closed boundary');
  const first = loop[0];
  if (loop.length === 1) {
    if (!first.isLoop()) throw new RangeError('Surface boundaries must form closed loops');
    return [{ boundary: first, reversed: false }];
  }
  const next = loop[1];
  const reversed = !samePosition(first.end, next.start) && !samePosition(first.end, next.end);
  const start = reversed ? first.end : first.start;
  let current = start;
  const result = loop.map(boundary => {
    const reverse = !samePosition(current, boundary.start);
    if (reverse && !samePosition(current, boundary.end)) throw new RangeError('Surface boundaries must form ordered, closed loops');
    current = reverse ? boundary.start : boundary.end;
    return { boundary, reversed: reverse };
  });
  if (!samePosition(current, start)) throw new RangeError('Surface boundaries must form closed loops');
  return result;
}

/** Sample a trim loop without duplicate joins or its repeated closing endpoint. */
export function sampleLoop(loop: readonly SpatialBoundary[], tessellation: Tessellation): Vertex[] {
  return orientLoop(loop).flatMap(({ boundary, reversed }) => {
    const vertices = tessellation.vertices(boundary);
    return (reversed ? [...vertices].reverse() : vertices).slice(0, -1);
  });
}
