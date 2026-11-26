import type { Point } from '../Point.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface } from '../SpatialSurface.js';
import { SurfaceRegion, type SurfaceTrim } from '../SurfaceRegion.js';
import { ParametricPatch } from './parametricPatch.js';
import { patchArrangement, type ArrangementArc } from './patchArrangement.js';

export type RegionRail = { boundary: SpatialBoundary; uv(t: number): Point; sourceRange?: readonly [number, number] };

/** Partition native charts by contact rails, including open corner cuts and partial old trims. */
export function trimRegionRails(source: SurfaceRegion | SpatialSurface,
  replacements: ReadonlyMap<SpatialBoundary, RegionRail>,
  boundaryLoops: readonly (readonly SpatialBoundary[])[]): SurfaceRegion {
  const patch = new ParametricPatch(source), expected = new Set(boundaryLoops.flat());
  // Discard old internal partitions, retaining the rectangle's closing seams.
  for (let i = patch.paths.length - 5; i >= 0; i--) if (!patch.paths[i].physical) patch.paths.splice(i, 1);
  const arrangement = patchArrangement(patch, [...replacements.values()].filter(rail => !rail.sourceRange).map(rail => ({ boundary: rail.boundary, at: rail.uv, physical: true })));
  const lifted = new Map<ArrangementArc['path'], ArrangementArc['path']>();
  const retainedArc = (arc: ArrangementArc): ArrangementArc | undefined => {
    if (!arc.path.physical || expected.has(arc.path.boundary)) return arc;
    const replacement = replacements.get(arc.path.boundary), range = replacement?.sourceRange;
    if (!replacement || !range || arc.start < range[0] - 1e-8 || arc.end > range[1] + 1e-8) return undefined;
    const parameter = (t: number) => Math.max(0, Math.min(1, (t - range[0]) / (range[1] - range[0])));
    let path = lifted.get(arc.path);
    if (!path) {
      path = { boundary: replacement.boundary, at: t => arc.path.at(range[0] + (range[1] - range[0]) * t), physical: true };
      lifted.set(arc.path, path);
    }
    return { ...arc, path, start: parameter(arc.start), end: parameter(arc.end) };
  };
  const retained = new Set(arrangement.regions.filter(region => patch.contains(region.probe)
    && [region.outer, ...region.holes].every(loop => loop.every(arc => retainedArc(arc)))));
  const arcs = arrangement.boundary(retained).map(arc => retainedArc(arc)!);
  for (const boundary of expected) {
    const ranges = arcs.filter(arc => arc.path.boundary === boundary).sort((a, b) => a.start - b.start);
    let end = 0;
    for (const range of ranges) {
      if (range.start > end + 1e-8) break;
      end = Math.max(end, range.end);
    }
    if (end < 1 - 1e-8) throw new RangeError('Contact rail overlaps another retained trim or consumes the surface region');
  }
  if (!retained.size || arcs.some(arc => arc.path.physical && !expected.has(arc.path.boundary))) throw new RangeError('Contact rails cannot retain the original surface topology');
  const trims = (arcs: readonly ArrangementArc[]): SurfaceTrim[] => {
    const merged: ArrangementArc[] = [];
    for (const original of arcs) {
      const arc = retainedArc(original)!;
      const previous = merged.at(-1);
      if (previous?.path === arc.path && previous.reversed === arc.reversed
        && Math.abs(arc.reversed ? previous.start - arc.end : previous.end - arc.start) < 1e-10) {
        previous.start = Math.min(previous.start, arc.start); previous.end = Math.max(previous.end, arc.end);
      } else merged.push({ ...arc });
    }
    return merged.map(arc => ({ ...arc.path, start: arc.start, end: arc.end, reversed: arc.reversed, physical: expected.has(arc.path.boundary) }));
  };
  return new SurfaceRegion({ surface: source instanceof SurfaceRegion ? source.surface : source, reversed: source.reversed, boundaryLoops,
    regions: [...retained].map(region => ({ outer: trims(region.outer), holes: region.holes.map(trims) })) });
}
