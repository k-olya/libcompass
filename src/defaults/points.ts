import type { vec3 } from 'gl-matrix';
import type { Point } from '../Point.js';

/** Shared local XY center `{ x: 0, y: 0 }`; treat as immutable. */
export const center: Point = { x: 0, y: 0 };

/** Shared world-space origin vec3 `[0, 0, 0]`; treat as immutable. */
export const origin: vec3 = [0, 0, 0];
