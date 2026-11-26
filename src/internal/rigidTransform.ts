import { mat4, vec3, type ReadonlyMat4, type ReadonlyVec3 } from 'gl-matrix';
import { Edge } from '../Edge.js';
import { Plane } from '../Plane.js';
import { SpatialCurve } from '../SpatialCurve.js';
import { SpatialLine } from '../SpatialLine.js';
import type { SpatialObject } from '../SpatialObject.js';
import { Surface, transformSurface } from '../Surface.js';
import { validateVertex, type Vertex } from '../Vertex.js';
import { rememberSample, sampleParameter } from './curveSamples.js';
import { rigidCopies } from './rigidContext.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';

/** Copy analytic geometry through a rigid matrix, retaining shared topology and sampling overrides. */
export function rigidTransform<T extends SpatialObject>(object: T, matrix: ReadonlyMat4): T {
  const reflected = mat4.determinant(matrix) < 0;
  const copies = new WeakMap<object, object>();
  const point = (p: ReadonlyVec3) => validateVertex({ position: vec3.transformMat4([0, 0, 0], p, matrix) }).position;
  const direction = (p: ReadonlyVec3): ReadonlyVec3 => validateVertex({ position: [
    matrix[0] * p[0] + matrix[4] * p[1] + matrix[8] * p[2],
    matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2],
    matrix[2] * p[0] + matrix[6] * p[1] + matrix[10] * p[2],
  ] }).position;
  const vertex = (source: Vertex): Vertex => {
    let copy = copies.get(source) as Vertex | undefined;
    if (!copy) { copy = { position: point(source.position) }; copies.set(source, copy); }
    return copy;
  };
  const map = <U extends SpatialObject | SpatialBoundary>(source: U): U => {
    const cached = copies.get(source);
    if (cached) return cached as U;
    let copy: SpatialObject;
    if (source instanceof SpatialLine) {
      copy = new SpatialLine({ direction: direction(source), origin: point(source.origin) });
    } else if (source instanceof Plane) {
      const origin = point(source.origin);
      copy = new Plane({ a: origin, b: vec3.add([0, 0, 0], origin, direction(source.xAxis)),
        c: vec3.add([0, 0, 0], origin, direction(source.yAxis)) });
    } else if (source instanceof Edge) {
      copy = new Edge({ start: vertex(source.start), end: vertex(source.end) });
    } else if (source instanceof SpatialCurve) {
      const start = vertex(source.start), end = vertex(source.end);
      const curve = source.planarCurve && source.plane
        ? SpatialCurve.fromPlanarCurve({ curve: source.planarCurve, plane: map(source.plane), start, end })
        : new SpatialCurve({ at: t => vertex(source.at(t)), start, end });
      curve.tangent = t => direction(source.tangent(t));
      curve.sample = options => {
        const samples = source.sample(options);
        return samples.map((sample, i) => {
          const mapped = vertex(sample), t = sampleParameter(source, sample, i, samples.length);
          return t === undefined ? mapped : rememberSample(curve, mapped, t);
        });
      };
      copy = curve;
    } else if (source instanceof Surface) {
      copy = transformSurface(source, { map, vertex, reflected });
    } else {
      const solid = rigidCopies.solid?.(source, { map, vertex, reflected }, matrix);
      if (!solid) throw new TypeError('Transform requires a plane, spatial line/curve, edge, surface or solid');
      copy = solid;
    }
    copies.set(source, copy);
    return copy as U;
  };
  return map(object);
}
