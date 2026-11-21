import type { SpatialObject } from '../SpatialObject.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Solid } from '../Solid.js';
import type { ReadonlyMat4 } from 'gl-matrix';
import type { Vertex } from '../Vertex.js';

/** Shared identity maps while copying one mathematical object and its topology. */
export interface RigidContext {
  map<T extends SpatialObject | SpatialBoundary>(object: T): T;
  vertex(vertex: Vertex): Vertex;
}

/** Solid installs its copier after its dependencies load, avoiding a cycle through boolean surface classes. */
export const rigidCopies: {
  solid?: (object: SpatialObject | SpatialBoundary, context: RigidContext, matrix: ReadonlyMat4) => Solid | undefined;
} = {};
