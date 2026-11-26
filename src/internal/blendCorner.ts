import { vec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import type { Point } from '../Point.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import type { Vertex } from '../Vertex.js';
import { solveBlendSystem } from './blendSection.js';
import { RoundTopology, sub, unit, type RoundRail } from './roundTopology.js';
import { atSurface, checkedUV, solve3, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';
import { boundaryPlacement, moveSurfaceUV } from './surfaceRails.js';

export type BlendCorner = { sources: ParametricFace[]; center: vec3; normals: vec3[]; points: Vertex[]; sense: number; arcs: Map<SpatialBoundary, RoundRail> };

/** A ball tangent to three original supports, solved in their native charts. */
export function blendCorner(sources: ParametricFace[], selected: SpatialBoundary[], vertex: Vertex, radius: number, topology: RoundTopology): BlendCorner {
  const initial = sources.map(surface => {
    const boundary = selected.find(boundary => surface.boundaries.includes(boundary))!;
    return boundaryPlacement(surface, boundary).uv(boundary.start === vertex ? 0 : 1);
  });
  const normals = sources.map((surface, i) => surfaceFrame(surface, initial[i]).normal);
  const senses = selected.map(boundary => {
    const [a, b] = sources.filter(surface => surface.boundaries.includes(boundary));
    const placement = boundaryPlacement(a, boundary), t = boundary.start === vertex ? 0 : 1;
    const tangent = unit(sub(boundary.at(Math.min(1, t + 1e-5)).position, boundary.at(Math.max(0, t - 1e-5)).position));
    return vec3.dot(placement.inward(placement.uv(t), tangent), normals[sources.indexOf(b)]) < 0 ? 1 : -1;
  });
  if (senses.some(sense => sense !== senses[0])) throw new RangeError('Round at mixed convex/concave junctions requires a general corner arrangement');
  const sense = senses[0];
  const delta = solve3([normals[0][0], normals[1][0], normals[2][0]], [normals[0][1], normals[1][1], normals[2][1]],
    [normals[0][2], normals[1][2], normals[2][2]], [-radius * sense, -radius * sense, -radius * sense]);
  const center = vec3.add([0, 0, 0], vertex.position, delta as vec3);
  let uv = initial.map((point, i) => moveSurfaceUV(sources[i], point,
    sub(vec3.scaleAndAdd([0, 0, 0], center, normals[i], radius * sense), vertex.position)));
  const contact = (i: number, point: Point) => {
    const position = atSurface(sources[i], point), normal = surfaceFrame(sources[i], point).normal;
    return { point: position, center: vec3.scaleAndAdd([0, 0, 0], position.position, normal, -radius * sense) };
  };
  const evaluate = (values: Point[]) => {
    const contacts = values.map((point, i) => contact(i, point));
    return { contacts, residual: [...sub(contacts[0].center, contacts[1].center), ...sub(contacts[0].center, contacts[2].center)] };
  };
  const tolerance = Math.max(1e-11, radius * 1e-9);
  for (let iteration = 0; ; iteration++) {
    const { contacts, residual } = evaluate(uv), error = Math.hypot(...residual);
    if (error <= tolerance) {
      const center = contacts[0].center, points = contacts.map(contact => topology.vertex(contact.point.position));
      return { sources, center, points, normals: points.map(point => vec3.scale([0, 0, 0], unit(sub(point.position, center)), sense)), sense, arcs: new Map() };
    }
    if (iteration >= 30) throw new RangeError('Round corner offset intersection did not converge');
    const columns = [0, 1, 2, 3, 4, 5].map(index => {
      const i = index >> 1, axis = index % 2 ? 'y' : 'x', surface = sources[i], h = 1e-5;
      const bounded = !(surface instanceof Face) && !(axis === 'x' ? surface.periodicU : surface.periodicV);
      const a = checkedUV(surface, { ...uv[i], [axis]: uv[i][axis] - (bounded && uv[i][axis] < h ? 0 : h) });
      const b = checkedUV(surface, { ...uv[i], [axis]: uv[i][axis] + (bounded && uv[i][axis] > 1 - h ? 0 : h) });
      const derivative = Array.from(sub(contact(i, b).center, contact(i, a).center), value => value / (b[axis] - a[axis]));
      return [...derivative.map(value => i === 2 ? 0 : value * (i ? -1 : 1)), ...derivative.map(value => i === 1 ? 0 : value * (i ? -1 : 1))];
    });
    const step = solveBlendSystem([0, 1, 2, 3, 4, 5].map(row => columns.map(column => column[row])), residual.map(value => -value));
    let next: Point[] | undefined;
    for (let reduction = 0; reduction < 12; reduction++) {
      const scale = 2 ** -reduction, candidate = uv.map((point, i) => ({ x: point.x + scale * step[2 * i], y: point.y + scale * step[2 * i + 1] }));
      const valid = candidate.every((point, i) => sources[i] instanceof Face || ((sources[i].periodicU || point.x >= 0 && point.x <= 1) && (sources[i].periodicV || point.y >= 0 && point.y <= 1)));
      if (valid && Math.hypot(...evaluate(candidate).residual) < error) { next = candidate; break; }
    }
    if (!next) throw new RangeError('Round corner contacts cannot advance within their source charts');
    uv = next;
  }
}
