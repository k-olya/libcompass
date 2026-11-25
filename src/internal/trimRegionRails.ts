import type { Point } from '../Point.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SurfaceRegion, type SurfaceTrim } from '../SurfaceRegion.js';
import { ParametricPatch } from './parametricPatch.js';
import { patchArrangement, type ArrangementArc } from './patchArrangement.js';

/** Partition retained charts by inward contact rails, keeping exact source equations. */
export function trimRegionRails(source: SurfaceRegion,
  replacements: ReadonlyMap<SpatialBoundary, { boundary: SpatialBoundary; uv(t: number): Point }>,
  boundaryLoops: readonly (readonly SpatialBoundary[])[]): SurfaceRegion {
  const patch = new ParametricPatch(source);
  // Old internal chart partitions are not physical barriers. The four final
  // paths still close the analysis rectangle and its periodic seams.
  for (let i = patch.paths.length - 5; i >= 0; i--) if (!patch.paths[i].physical) patch.paths.splice(i, 1);
  const arrangement = patchArrangement(patch, [...replacements.values()].map(rail => ({
    boundary: rail.boundary, at: rail.uv, physical: true,
  })));
  const retained = new Set(arrangement.regions.filter(region => patch.contains(region.probe)
    && ![region.outer, ...region.holes].some(loop => loop.some(arc => replacements.has(arc.path.boundary)))));
  const arcs = arrangement.boundary(retained), expected = new Set(boundaryLoops.flat());
  for (const boundary of expected) {
    const ranges = arcs.filter(arc => arc.path.boundary === boundary).sort((a, b) => a.start - b.start);
    let end = 0;
    for (const range of ranges) {
      if (range.start > end + 1e-8) break;
      end = Math.max(end, range.end);
    }
    if (end < 1 - 1e-8) throw new RangeError('Contact rail overlaps another retained trim or consumes the surface region');
  }
  if (!retained.size || arcs.some(arc => !expected.has(arc.path.boundary))) {
    throw new RangeError('Contact rails cannot retain the original surface topology');
  }
  const trims = (arcs: readonly ArrangementArc[]): SurfaceTrim[] => {
    const merged: ArrangementArc[] = [];
    for (const arc of arcs) {
      const previous = merged.at(-1);
      if (previous?.path === arc.path && previous.reversed === arc.reversed
        && Math.abs(arc.reversed ? previous.start - arc.end : previous.end - arc.start) < 1e-10) {
        previous.start = Math.min(previous.start, arc.start); previous.end = Math.max(previous.end, arc.end);
      } else merged.push({ ...arc });
    }
    return merged.map(arc => ({ ...arc.path, start: arc.start, end: arc.end, reversed: arc.reversed,
      physical: expected.has(arc.path.boundary) }));
  };
  return new SurfaceRegion({ surface: source.surface, reversed: source.reversed, boundaryLoops,
    regions: [...retained].map(region => ({ outer: trims(region.outer), holes: region.holes.map(trims) })) });
}
