import { Edge } from '../Edge.js';
import { Line } from '../Line.js';
import { LineSegment } from '../LineSegment.js';
import { Node } from '../Node.js';
import { PlanarCurve } from '../PlanarCurve.js';
import { Plane } from '../Plane.js';
import { validatePoint, type Point } from '../Point.js';
import { Sketch } from '../Sketch.js';
import { Solid } from '../Solid.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { Surface } from '../Surface.js';
import { validateVertex, type Vertex } from '../Vertex.js';

/** Finite mathematical geometry accepted by measure; infinite geometry and generic nodes are excluded. */
export type Measurable = Sketch | Point | Vertex | LineSegment | Edge | PlanarCurve | SpatialCurve | Surface | Solid;

/** Axis-aligned bounds in model units; planar objects use local XY with Z = 0. */
export interface BoundingBox {
  /** Minimum XYZ coordinates. Sketch bounds use the sketch's world-space plane. */
  min: [number, number, number];
  /** Maximum XYZ coordinates. */
  max: [number, number, number];
  /** Extents along X, Y and Z: max minus min. */
  size: [number, number, number];
}

/** Measurements in model units, square units and cubic units, respectively. */
export interface Measurement {
  /** Combined axis-aligned bounds, or null when the geometry is empty. */
  boundingBox: BoundingBox | null;
  /** Total polyline length, present for curves and segments. */
  length?: number;
  /** Total triangle area, present for surfaces. */
  surfaceArea?: number;
  /** Total enclosed volume, present for solids; inputs must be closed and consistently oriented. */
  volume?: number;
}

type Kind = 'bounds' | 'length' | 'surfaceArea' | 'volume';
function kind(object: Measurable): Kind {
  if (object instanceof Solid) return 'volume';
  if (object instanceof Surface) return 'surfaceArea';
  if (object instanceof LineSegment || object instanceof Edge || object instanceof PlanarCurve || object instanceof SpatialCurve) return 'length';
  if (object instanceof Sketch) return 'bounds';
  if (object && typeof object === 'object' && !(object instanceof Node) && !(object instanceof Plane) && !(object instanceof Line)) {
    if ('x' in object && 'y' in object) { validatePoint(object as Point); return 'bounds'; }
    if ('position' in object) { validateVertex(object as Vertex); return 'bounds'; }
  }
  throw new TypeError('Measure requires finite mathematical geometry; infinite geometry and arbitrary nodes are not supported');
}

/**
 * Measure finite geometry, returning and automatically logging one measurement object.
 * @param options.object - One sketch, point/vertex, curve/segment, surface, or solid,
 * or a nonempty array with the same measurement type. Planar and spatial curves
 * may be mixed. Arrays combine bounds and sum lengths, areas or volumes, counting
 * each entry independently; overlaps are not boolean-unioned.
 * @param options.log - Output destination; defaults to console.log. Hosts can forward it to their script console.
 * @returns Combined boundingBox and, when applicable, length, surfaceArea, or volume.
 * Sketches and points return bounds only. Empty geometry has null bounds and zero
 * area/volume. Standalone planar geometry uses XY with Z = 0; sketches use their
 * placement plane. Infinite sketch construction lines are ignored, finite points
 * are included. Solids use only their own surfaces, excluding node children.
 * @remarks
 * Curves use sample(), respecting overrides and the current triangulation
 * resolution. Surfaces and solids use fresh surface tessellation, leaving input
 * geometry and memo caches unchanged. Bounds approximate curved extrema at that
 * resolution; hidden oscillations require a sampling override. Areas and lengths
 * are polyline/triangle approximations. Volume integrates oriented triangles;
 * solids must be closed and consistently oriented. Returned data is a snapshot.
 * @throws {@link TypeError} for unsupported geometry, mixed measurement types, or an invalid logger.
 * @throws {@link RangeError} for empty arrays, nonfinite geometry, or unresolved sampling/tessellation.
 * @example
 * ```ts
 * const dimensions = measure({ object: part }); // Also prints to the console.
 * const perimeter = measure({ object: rectangle({ center, corner2: { x: 5, y: 3 } }) });
 * const area = measure({ object: part.surfaces });
 * ```
 */
export function measure({ object, log = result => console.log(result) }: {
  /** Bounded geometry, or a nonempty flat array sharing one measurement type. */
  object: Measurable | readonly Measurable[];
  /** Optional host output hook; default logs the returned object once to console. */
  log?: (result: Measurement) => void;
}): Measurement {
  if (typeof log !== 'function') throw new TypeError('Measure log must be a function');
  const objects: readonly Measurable[] = Array.isArray(object) ? object : [object as Measurable];
  if (!objects.length) throw new RangeError('Measure requires a nonempty array');
  const category = kind(objects[0]);
  for (const item of objects) if (kind(item) !== category) throw new TypeError('Measure arrays must share one measurement type');
  const result: Measurement = { boundingBox: null };
  if (category !== 'bounds') result[category] = 0;
  const include = (vertex: Vertex) => {
    const point = validateVertex(vertex).position;
    if (!result.boundingBox) result.boundingBox = { min: [point[0], point[1], point[2]], max: [point[0], point[1], point[2]], size: [0, 0, 0] };
    else for (let i = 0; i < 3; i++) {
      result.boundingBox.min[i] = Math.min(result.boundingBox.min[i], point[i]);
      result.boundingBox.max[i] = Math.max(result.boundingBox.max[i], point[i]);
    }
  };
  const planar = (point: Point): Vertex => { validatePoint(point); return { position: [point.x, point.y, 0] }; };
  for (const item of objects) {
    if (item instanceof Sketch) {
      for (const element of item.elements) {
        if (element instanceof Line) continue;
        const points = element instanceof PlanarCurve ? element.sample()
          : element instanceof LineSegment ? [element.start, element.end] : [element];
        for (const point of points) include(item.plane.toWorld(point));
      }
    } else if (item instanceof LineSegment || item instanceof Edge || item instanceof PlanarCurve || item instanceof SpatialCurve) {
      const points = item instanceof LineSegment ? [planar(item.start), planar(item.end)]
        : item instanceof PlanarCurve ? item.sample().map(planar) : item.sample();
      if (points.length < 2) throw new RangeError('Measured curves must sample both endpoints');
      let previous: Vertex | undefined;
      for (const point of points) {
        include(point);
        if (previous) result.length! += Math.hypot(...[0, 1, 2].map(i => point.position[i] - previous!.position[i]));
        previous = point;
      }
    } else if (item instanceof Surface || item instanceof Solid) {
      const positions = item instanceof Solid ? Surface.triangulateAll(item.surfaces) : item.triangulate();
      if (positions.length % 9) throw new RangeError('Measured surfaces must triangulate into XYZ triangles');
      const reference = positions.subarray(0, 3);
      let volume = 0;
      for (let i = 0; i < positions.length; i += 9) {
        const a = positions.subarray(i, i + 3), b = positions.subarray(i + 3, i + 6), c = positions.subarray(i + 6, i + 9);
        include({ position: a }); include({ position: b }); include({ position: c });
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        if (item instanceof Solid) volume += ((a[0] - reference[0]) * nx + (a[1] - reference[1]) * ny + (a[2] - reference[2]) * nz) / 6;
        else result.surfaceArea! += Math.hypot(nx, ny, nz) / 2;
      }
      if (item instanceof Solid) result.volume! += Math.abs(volume);
    } else if ('position' in item) include(item);
    else include(planar(item as Point));
  }
  if (result.boundingBox) for (let i = 0; i < 3; i++) result.boundingBox.size[i] = result.boundingBox.max[i] - result.boundingBox.min[i];
  if ([result.length, result.surfaceArea, result.volume, ...(result.boundingBox?.size ?? [])].some(value => value !== undefined && !Number.isFinite(value))) {
    throw new RangeError('Measurement exceeds finite numeric range');
  }
  log(result);
  return result;
}
