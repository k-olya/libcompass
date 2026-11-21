/** Library-wide midpoint-to-chord deviation in model units; defaults to 0.0128. Change with setTriangulationResolution(). */
export let TRIANGULATION_RESOLUTION = 0.0128;

/**
 * Set the library-wide sampling and tessellation resolution.
 * @param resolution - Maximum midpoint deviation in model units, from 0.001 to 1 inclusive.
 * @remarks Smaller values produce more triangles. Rerun modeling operations to
 * rebuild geometry at the new setting; existing memoized nodes retain their caches.
 * @throws {@link RangeError} if resolution is nonfinite or outside [0.001, 1].
 */
export function setTriangulationResolution(resolution: number): void {
  if (!Number.isFinite(resolution) || resolution < 0.001 || resolution > 1) {
    throw new RangeError('Triangulation resolution must be between 0.001 and 1');
  }
  TRIANGULATION_RESOLUTION = resolution;
}
