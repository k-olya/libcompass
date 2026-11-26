import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Surface } from '../Surface.js';
import { blendSurfaces } from './blendSurfaces.js';
import type { RoundTopology } from './roundTopology.js';

/** Build round strips and trim their source surfaces using the shared blend engine. */
export function roundCurves(surfaces: readonly Surface[], selected: readonly SpatialBoundary[], radius: number, topology: RoundTopology): Surface[] {
  return blendSurfaces(surfaces, selected, { kind: 'round', radius }, topology);
}
