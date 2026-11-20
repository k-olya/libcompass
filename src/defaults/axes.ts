import type { ReadonlyVec3 } from 'gl-matrix';

/** Shared world +X unit vector `[1, 0, 0]`; treat as immutable. */
export const X: ReadonlyVec3 = [1, 0, 0];

/** Shared world +Y unit vector `[0, 1, 0]`; treat as immutable. */
export const Y: ReadonlyVec3 = [0, 1, 0];

/** Shared world +Z unit vector `[0, 0, 1]`; treat as immutable. */
export const Z: ReadonlyVec3 = [0, 0, 1];
