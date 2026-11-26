import { Plane } from '../Plane.js';
import { X, Y, Z } from './axes.js';

/**
 * Shared {@link Plane} at the world origin with local axes +X, +Y and normal +Z.
 * Treat this default plane and its coordinate arrays as immutable.
 */
export const XY = new Plane({ b: X, c: Y });

/**
 * Shared {@link Plane} at the world origin with local axes +Y, +X and normal -Z.
 * Treat this default plane and its coordinate arrays as immutable.
 */
export const YX = new Plane({ b: Y, c: X });

/**
 * Shared {@link Plane} at the world origin with local axes +X, +Z and normal -Y.
 * Treat this default plane and its coordinate arrays as immutable.
 */
export const XZ = new Plane({ b: X, c: Z });

/**
 * Shared {@link Plane} at the world origin with local axes +Z, +X and normal +Y.
 * Treat this default plane and its coordinate arrays as immutable.
 */
export const ZX = new Plane({ b: Z, c: X });

/**
 * Shared {@link Plane} at the world origin with local axes +Y, +Z and normal +X.
 * Treat this default plane and its coordinate arrays as immutable.
 */
export const YZ = new Plane({ b: Y, c: Z });

/**
 * Shared {@link Plane} at the world origin with local axes +Z, +Y and normal -X.
 * Treat this default plane and its coordinate arrays as immutable.
 */
export const ZY = new Plane({ b: Z, c: Y });
