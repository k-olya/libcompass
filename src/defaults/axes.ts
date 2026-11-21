import { SpatialLine } from '../SpatialLine.js';

/** Shared world +X unit spatial line `[1, 0, 0]` with zero origin; treat as immutable. */
export const X = new SpatialLine({ direction: [1, 0, 0] });

/** Shared world +Y unit spatial line `[0, 1, 0]` with zero origin; treat as immutable. */
export const Y = new SpatialLine({ direction: [0, 1, 0] });

/** Shared world +Z unit spatial line `[0, 0, 1]` with zero origin; treat as immutable. */
export const Z = new SpatialLine({ direction: [0, 0, 1] });
