import type { Sketch } from '../Sketch.js';
import type { Solid } from '../Solid.js';
import type { SpatialCurve } from '../SpatialCurve.js';
import { sketchProfiles } from '../internal/profiles.js';
import { sweepFrames } from '../internal/sweepFrames.js';
import { sweepProfiles } from '../internal/sweepProfiles.js';

/**
 * Extrude filled sketch regions along a smooth, regular spatial curve.
 *
 * @remarks
 * Local (0, 0) follows the path. The sketch plane is rotated onto the starting
 * tangent, then transported with minimal twist; its original position is ignored.
 * Closed paths distribute residual frame rotation by sampled arc length and have
 * no caps or seam edges. Sampling never introduces intermediate solid topology.
 * Smooth runs of connected open profile curves are joined as in extrude(),
 * retaining exact evaluators and sampling overrides; existing loops stay separate.
 * Validation uses temporary polylines and a mesh at the library resolution;
 * arbitrary oscillations hidden by sampling overrides cannot be certified.
 *
 * @param options - Sketch and smooth spatial path; holes and islands use even-odd nesting.
 * @param options.sketch - Closed planar profiles to sweep, preserving local coordinates.
 * @param options.curve - Smooth regular path, open or smoothly closed.
 * @returns A solid retaining parametric surfaces and shared physical boundaries.
 * @throws {@link RangeError} for corners, cusps, unresolved sampling, local folds,
 * or intersections detected in the validation mesh. Offset trimming is not supported.
 *
 * @example
 * ```ts
 * const s = sketch().add(circle({ center: { x: 0, y: 0 }, radius: 2 }));
 * const curve = spatialCurve({ at: t => ({ position: [20 * t, 0, 10 * t * t] }) });
 * scene.add(extrudeAlongCurve({ sketch: s, curve }));
 * ```
 */
export function extrudeAlongCurve({ sketch, curve }: {
  /** Sketch providing the filled local profiles and initial orientation. */
  sketch: Sketch;
  /** Smooth, regular spatial path. */
  curve: SpatialCurve;
}): Solid {
  const profiles = sketchProfiles(sketch);
  const radius = Math.max(...profiles.flatMap(profile => profile.points.map(point => Math.hypot(point.x, point.y))));
  const sweep = sweepFrames(curve, sketch.plane, radius);
  return sweepProfiles(profiles, sweep);
}
