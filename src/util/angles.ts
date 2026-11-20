/** The circle constant, equal to `Math.PI`. */
export const PI = Math.PI;

/**
 * Convert radians to degrees without wrapping the angle.
 * @param angleRAD - Angle in radians; negative values and multiple turns are allowed.
 * @returns The equivalent angle in degrees.
 * @example
 * ```ts
 * radtodeg(PI / 2); // 90
 * ```
 */
export function radtodeg(angleRAD: number): number { return angleRAD * (180 / PI); }

/**
 * Convert degrees to radians without wrapping the angle.
 * @param angleDEG - Angle in degrees; negative values and multiple turns are allowed.
 * @returns The equivalent angle in radians.
 * @example
 * ```ts
 * degtorad(90); // PI / 2
 * ```
 */
export function degtorad(angleDEG: number): number { return angleDEG * (PI / 180); }
