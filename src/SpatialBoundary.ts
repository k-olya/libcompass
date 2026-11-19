import type { Vertex } from './Vertex.js';

/** Shared contract for straight edges and parametric spatial curves. */
export interface SpatialBoundary {
  /** Topological vertex at parameter zero. */
  readonly start: Vertex;
  /** Topological vertex at parameter one. */
  readonly end: Vertex;
  /** Evaluate a world-space vertex at a normalized parameter in [0, 1]. */
  at(t: number): Vertex;
  /** Whether the endpoint coordinates coincide, forming a closed loop. */
  isLoop(): boolean;
  /** Sample at the library resolution, including both endpoints. */
  sample(): Vertex[];
}
