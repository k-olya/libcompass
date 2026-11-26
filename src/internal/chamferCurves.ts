import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Surface } from '../Surface.js';
import { blendSurfaces } from './blendSurfaces.js';
import { RoundTopology } from './roundTopology.js';

/** Build bevel strips and trim their source surfaces using the shared blend engine. */
export function chamferCurves(surfaces: readonly Surface[], selected: readonly SpatialBoundary[], length: number, angleRAD: number): Surface[] {
  return blendSurfaces(surfaces, selected, { kind: 'chamfer', length, angleRAD }, new RoundTopology(length, surfaces.flatMap(surface => surface.vertices)));
}
