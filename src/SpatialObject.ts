import type { Edge } from './Edge.js';
import type { Plane } from './Plane.js';
import type { Solid } from './Solid.js';
import type { SpatialCurve } from './SpatialCurve.js';
import type { SpatialLine } from './SpatialLine.js';
import type { Surface } from './Surface.js';

/** World-space geometry accepted by the nonmutating rotate and displace operations. */
export type SpatialObject = Plane | SpatialLine | SpatialCurve | Edge | Surface | Solid;
