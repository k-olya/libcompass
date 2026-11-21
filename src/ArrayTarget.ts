import type { SpatialObject } from './SpatialObject.js';

/** World-space geometry, or nested readonly arrays of geometry, accepted by array operations. */
export type ArrayTarget = SpatialObject | readonly ArrayTarget[];

/** Geometry leaf types in an array target, recursively unwrapping arrays while retaining geometry types. */
export type ArrayCopy<T extends ArrayTarget> = ArrayTarget extends T ? SpatialObject : T extends SpatialObject ? T
  : T extends readonly (infer U extends ArrayTarget)[] ? ArrayCopy<U> : never;
