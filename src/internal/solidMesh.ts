import type { Solid } from '../Solid.js';
import { TRIANGULATION_RESOLUTION } from '../triangulation.js';

/** Reuse operation validation meshes without touching source or child memo caches. */
const meshes = new WeakMap<Solid, { resolution: number; positions: Float32Array }>();
export function retainSolidMesh(solid: Solid, positions: Float32Array): void {
  meshes.set(solid, { resolution: TRIANGULATION_RESOLUTION, positions });
}
export function solidMesh(solid: Solid): Float32Array | undefined {
  const entry = meshes.get(solid);
  return entry?.resolution === TRIANGULATION_RESOLUTION ? entry.positions : undefined;
}
export function forgetSolidMesh(solid: Solid): void { meshes.delete(solid); }
