import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import { PlanarCurve } from '../PlanarCurve.js';
import { SpatialSurface } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import { trimFace } from '../internal/trimFace.js';
import { trimSpatialSurface } from '../internal/trimSpatialSurface.js';

/**
 * Trim a surface with cutting geometry, returning its retained connected pieces.
 * @param options.surface - Original planar face or parametric spatial surface; never mutated.
 * @param options.cutter - World-space cutting plane, or a closed planar curve in
 * a Face's local plane coordinates. Open curves and coincident cuts are ambiguous.
 * @param options.keep - 'positive' (default) or 'negative' relative to a plane's
 * normal; 'inside' (default) or 'outside' for a closed curve.
 * @returns New surfaces with exact boundaries, or [] if the whole input is removed.
 * Faces can split into several pieces, and closed curve cuts can create holes.
 * @remarks
 * Planar cuts assemble exact retained edges/curves; samples are used only for
 * intersection discovery and region analysis. Curved surfaces retain their
 * original evaluator through {@link TrimmedSurface}, as chamfers do. Their plane
 * intersection must form one continuous rail crossing each line of an open
 * parameter direction exactly once, without touching the ends. Cuts needing
 * several charts (including cuts of doubly periodic tori), curved cutters on
 * spatial surfaces, tangent contacts and unresolved intersections currently throw.
 * Surfaces are open patches: this operation does not cap or trim an entire solid.
 * @throws {@link RangeError} for incompatible keep, unsupported topology or unresolved intersections.
 * @example
 * ```ts
 * const pieces = trimSurface({ surface: part.surfaces[0], cutter: YZ, keep: 'positive' });
 * scene.add(solid({ surfaces: pieces }));
 * ```
 */
export function trimSurface({ surface, cutter, keep = cutter instanceof Plane ? 'positive' : 'inside' }: {
  /** Input face or parametric surface, retained unchanged. */
  surface: Surface;
  /** Cutting plane in world space, or closed cutter in a Face's local XY frame. */
  cutter: Plane | PlanarCurve;
  /** Retained plane side, or closed-curve interior/exterior. */
  keep?: 'positive' | 'negative' | 'inside' | 'outside';
}): Surface[] {
  if (!(surface instanceof Face || surface instanceof SpatialSurface)) throw new TypeError('Trim surface requires a Face or SpatialSurface');
  if (!(cutter instanceof Plane || cutter instanceof PlanarCurve)) throw new TypeError('Trim surface requires a cutting plane or closed planar curve');
  if (!(cutter instanceof Plane ? ['positive', 'negative'] : ['inside', 'outside']).includes(keep)) throw new RangeError('Trim keep must match the cutter: positive/negative for a plane, inside/outside for a curve');
  if (surface instanceof Face) return trimFace(surface, cutter, keep);
  if (!(cutter instanceof Plane)) throw new RangeError('Curved-surface trimming currently requires a cutting plane');
  return trimSpatialSurface(surface, cutter, keep);
}
