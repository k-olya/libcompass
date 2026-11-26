import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Surface } from '../Surface.js';
import type { Vertex } from '../Vertex.js';
import type { ParametricFace } from './surfaceGeometry.js';
import { boundaryPlacement } from './surfaceRails.js';

/** Operation-local incidence index; preserves native surface and boundary order. */
export class SurfaceGraph {
  readonly boundaries = new Map<SpatialBoundary, Surface[]>();
  readonly vertices = new Map<Vertex, Surface[]>();
  private readonly areas = new Map<readonly SpatialBoundary[], number>();
  private readonly placements = new Map<Surface, Map<SpatialBoundary, ReturnType<typeof boundaryPlacement>>>();

  constructor(surfaces: readonly Surface[]) {
    for (const surface of surfaces) {
      for (const boundary of new Set(surface.boundaries)) {
        const adjacent = this.boundaries.get(boundary) ?? [];
        adjacent.push(surface); this.boundaries.set(boundary, adjacent);
      }
      for (const vertex of surface.vertices) {
        const adjacent = this.vertices.get(vertex) ?? [];
        adjacent.push(surface); this.vertices.set(vertex, adjacent);
      }
    }
  }

  adjoining(boundary: SpatialBoundary): Surface[] { return this.boundaries.get(boundary) ?? []; }
  atVertex(vertex: Vertex): Surface[] { return this.vertices.get(vertex) ?? []; }

  placement(surface: ParametricFace, boundary: SpatialBoundary): ReturnType<typeof boundaryPlacement> {
    const entries = this.placements.get(surface) ?? new Map();
    let placement = entries.get(boundary);
    if (!placement) { placement = boundaryPlacement(surface, boundary, this.areas); entries.set(boundary, placement); this.placements.set(surface, entries); }
    return placement;
  }

  validate(label: string): void {
    for (const surfaces of this.boundaries.values()) if (surfaces.length !== 2) {
      throw new RangeError(`${label} requires a closed manifold solid with two surfaces per boundary`);
    }
  }
}
