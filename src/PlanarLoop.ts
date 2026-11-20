import type { Point } from './Point.js';

/** Area and strict interior containment for a closed, simple planar boundary.
 * Implementations may approximate the boundary with sampled polylines. */
export interface PlanarLoop {
  /** Positive enclosed area in square model units. */
  area(): number;
  /** Test strict interior membership; boundary points are excluded. */
  contains(options: { point: Point }): boolean;
}
