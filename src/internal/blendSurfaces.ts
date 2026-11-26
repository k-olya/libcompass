import { vec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import { RuledSurface } from '../RuledSurface.js';
import { Plane } from '../Plane.js';
import type { Point } from '../Point.js';
import { SpatialCurve } from '../SpatialCurve.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface, type SurfaceSides } from '../SpatialSurface.js';
import type { Surface } from '../Surface.js';
import { TrimmedSurface } from '../TrimmedSurface.js';
import { SurfaceRegion, type SurfaceTrim } from '../SurfaceRegion.js';
import type { Vertex } from '../Vertex.js';
import { parameterizedSamples } from './curveSamples.js';
import { RoundTopology, spherical, sub, unit, type RoundRail } from './roundTopology.js';
import { atSurface, checkedUV, solve3, surfaceFrame, type ParametricFace } from './surfaceGeometry.js';
import { orientLoop } from './boundaryLoops.js';
import { curveParameter, sliceSpatialCurve } from './curveTrimming.js';
import { UnsupportedRoundError } from './roundUnsupported.js';
import { RoundContacts } from './roundContacts.js';
import { blendSection, type BlendSettings } from './blendSection.js';
import { SurfaceGraph } from './surfaceGraph.js';
import { trimRegionRails } from './trimRegionRails.js';
import { blendCorner, type BlendCorner } from './blendCorner.js';
import { blendJunction, type BlendStrip, type JunctionEnd } from './blendJunction.js';

type Side = keyof SurfaceSides;
type Trim = { rail: RoundRail; uv(t: number): Point; side?: Side; reversed: boolean; sourceRange?: readonly [number, number] };

/** Shared strip construction, end intersections, exact chart trimming and contact sewing. */
export function blendSurfaces(surfaces: readonly Surface[], selected: readonly SpatialBoundary[], settings: BlendSettings, topology: RoundTopology): Surface[] {
  if (!selected.length) return [...surfaces];
  const radius = settings.kind === 'round' ? settings.radius : settings.length;
  const graph = new SurfaceGraph(surfaces);
  topology.retain(graph.boundaries.keys());
  const replacements = new Map<Surface, Map<SpatialBoundary, Trim>>(), rounded: Surface[] = [];
  const contacts = new Map<SpatialBoundary, Map<Vertex, Vertex>>(), ends = new Map<Vertex, RoundRail>();
  const strips = new Map<SpatialBoundary, BlendStrip>();
  for (const boundary of selected) {
    const source = graph.adjoining(boundary);
    if (source.length !== 2 || !source.every(surface => surface instanceof Face || surface instanceof SpatialSurface || surface instanceof SurfaceRegion)) {
      throw new RangeError('Blend requires two regular adjoining surfaces');
    }
    const supports = source as ParametricFace[];
    strips.set(boundary, { boundary, source: supports,
      section: blendSection(supports, supports.map(surface => graph.placement(surface, boundary)), boundary, settings, topology.tolerance) });
  }
  const junctions = new Map<Vertex, Map<SpatialBoundary, JunctionEnd>>();
  const endpointSelections = new Map<Vertex, SpatialBoundary[]>(), corners = new Map<Vertex, BlendCorner>();
  for (const boundary of selected) if (!boundary.isLoop()) for (const vertex of [boundary.start, boundary.end]) {
    const entries = endpointSelections.get(vertex) ?? []; entries.push(boundary); endpointSelections.set(vertex, entries);
  }
  for (const [vertex, selections] of endpointSelections) if (selections.length > 1) {
    const supports = graph.atVertex(vertex);
    const incident = new Set(supports.flatMap(surface => surface.boundaries.filter(boundary => boundary.start === vertex || boundary.end === vertex)));
    if (supports.length !== 3 || incident.size !== 3
      || !supports.every(surface => surface instanceof Face || surface instanceof SpatialSurface || surface instanceof SurfaceRegion)) {
      throw new UnsupportedRoundError('Blend junctions require a regular three-support neighborhood');
    }
    if (settings.kind === 'round' && selections.length === 3) {
      corners.set(vertex, blendCorner(supports as ParametricFace[], selections, vertex, settings.radius, topology));
    } else {
      const junction = blendJunction(selections.map(boundary => strips.get(boundary)!), vertex, topology);
      junctions.set(vertex, junction.ends);
      if (junction.cut) {
        const { surface, rail, uv } = junction.cut;
        ends.set(vertex, rail);
        if (!(surface instanceof Face) && rail.boundary) {
          const entries = replacements.get(surface) ?? new Map();
          entries.set(rail.boundary, { rail, uv, reversed: false }); replacements.set(surface, entries);
        }
      }
      if (junction.unselectedContact) {
        const unselected = [...incident].find(boundary => !selections.includes(boundary))!;
        const entries = contacts.get(unselected) ?? new Map(); entries.set(vertex, junction.unselectedContact); contacts.set(unselected, entries);
      }
    }
  }
  for (const boundary of selected) {
    const closed = boundary.isLoop();
    const adjacent = graph.adjoining(boundary);
    if (adjacent.length !== 2 || !adjacent.every(surface => surface instanceof Face || surface instanceof SpatialSurface || surface instanceof SurfaceRegion)) {
      throw new RangeError('Round requires two regular adjoining planar or spatial surfaces');
    }
    const source = adjacent as ParametricFace[], placements = source.map(surface => graph.placement(surface, boundary));
    const section = strips.get(boundary)!.section;
    const pair = (t: number) => section(closed && t === 1 ? 0 : t);
    const caps = closed ? [] : [boundary.start, boundary.end].map(vertex => {
      if (corners.has(vertex) || junctions.has(vertex)) return undefined;
      const candidates = graph.atVertex(vertex).filter(surface => !(adjacent as Surface[]).includes(surface));
      if (candidates.length !== 1 || !(candidates[0] instanceof Face || candidates[0] instanceof SpatialSurface || candidates[0] instanceof SurfaceRegion)) throw new UnsupportedRoundError('Open blend ends require one regular end surface');
      return candidates[0] as ParametricFace;
    });
    const raw = (t: number, v: number): Vertex => pair(t).at(v);
    const bounds = new Map<number, number[]>();
    const capParameters = new Map<number, Point[]>();
    const cornerStations = new Map<number, number>();
    const station = (u: number, v: number): number => {
      if (closed) return u;
      let range = bounds.get(v);
      if (!range) {
        const extrapolate = !(boundary instanceof SpatialCurve) && source.every(surface => surface instanceof Face);
        const parameters: Point[] = [];
        range = caps.map((cap, end) => {
          if (!cap) {
            const junction = junctions.get(end ? boundary.end : boundary.start)?.get(boundary);
            if (junction) return junction.station(v);
            const cached = cornerStations.get(end);
            if (cached !== undefined) return cached;
            const corner = corners.get(end ? boundary.end : boundary.start)!;
            let t = end;
            for (let iteration = 0; ; iteration++) {
              const center = pair(t).center!, error = sub(corner.center, center);
              if (vec3.length(error) <= topology.tolerance * 0.5) { cornerStations.set(end, t); return t; }
              if (iteration >= 30) throw new RangeError('Round strip cannot meet its corner ball');
              const a = Math.max(0, t - 1e-5), b = Math.min(1, t + 1e-5);
              const derivative = vec3.scale([0, 0, 0], sub(pair(b).center!, pair(a).center!), 1 / (b - a));
              if (vec3.squaredLength(derivative) < 1e-20) throw new RangeError('Round corner station is singular');
              t += vec3.dot(error, derivative) / vec3.squaredLength(derivative);
              if (t < -1e-9 || t > 1 + 1e-9) throw new RangeError('Round corner exceeds its boundary interval');
              t = Math.max(0, Math.min(1, t));
            }
          }
          if (!(cap instanceof Face)) {
            const vertex = end ? boundary.end : boundary.start;
            const neighbor = cap.boundaries.find(edge => edge.start === vertex || edge.end === vertex)!;
            let uv = graph.placement(cap, neighbor).uv(neighbor.start === vertex ? 0 : 1), t = end;
            for (let iteration = 0; ; iteration++) {
              const delta = sub(atSurface(cap, uv).position, raw(t, v).position);
              if (vec3.length(delta) <= Math.max(1e-11, radius * 1e-10)) { parameters[end] = uv; return t; }
              if (iteration >= 30) throw new RangeError('Blend end-surface intersection did not converge');
              const a = extrapolate ? t - 1e-5 : Math.max(0, t - 1e-5), b = extrapolate ? t + 1e-5 : Math.min(1, t + 1e-5);
              const derivative = vec3.scale([0, 0, 0], sub(raw(b, v).position, raw(a, v).position), 1 / (b - a));
              const { du, dv } = surfaceFrame(cap, uv);
              const step = solve3(derivative, vec3.negate([0, 0, 0], du), vec3.negate([0, 0, 0], dv), delta);
              t += step[0]; uv = checkedUV(cap, { x: uv.x + step[1], y: uv.y + step[2] });
              if (!extrapolate) {
                if (t < -1e-9 || t > 1 + 1e-9) throw new UnsupportedRoundError('Blend end intersection exceeds its source chart');
                t = Math.max(0, Math.min(1, t));
              }
            }
          }
          const distance = (t: number) => vec3.dot(sub(raw(t, v).position, cap.plane.origin), cap.plane.normal);
          let t = end;
          for (let iteration = 0; ; iteration++) {
            const error = distance(t);
            if (Math.abs(error) <= Math.max(1e-12, radius * 1e-11)) return t;
            if (iteration === 20) throw new RangeError('Round end-cap intersection did not converge');
            const a = extrapolate ? t - 1e-4 : Math.max(0, t - 1e-4), b = extrapolate ? t + 1e-4 : Math.min(1, t + 1e-4);
            const derivative = (distance(b) - distance(a)) / (b - a);
            if (Math.abs(derivative) < 1e-10) throw new RangeError('Round end cap is tangent or numerically unresolved');
            t -= error / derivative;
            if (!extrapolate) {
              if (t < -1e-9 || t > 1 + 1e-9) throw new UnsupportedRoundError('Round end-cap trimming exceeds the source chart; extended surface intersection is required');
              t = Math.max(0, Math.min(1, t));
            }
          }
        });
        if (range[1] < range[0] - 1e-9) throw new RangeError('Round radius consumes the open boundary between its end caps');
        bounds.set(v, range); capParameters.set(v, parameters);
      }
      return range[0] + (range[1] - range[0]) * u;
    };
    const rails = source.map((_surface, index) => {
      const a = station(0, index), b = station(1, index);
      const samples = closed ? boundary : sliceSpatialCurve(boundary, a, b, boundary.at(a), boundary.at(b));
      return topology.rail(t => pair(station(t, index)).points[index], samples);
    });
    for (const { t } of parameterizedSamples(boundary)) for (const rail of rails) if (rail.boundary) {
      const a = Math.max(0, t - 1e-4), b = Math.min(1, t + 1e-4);
      if (vec3.dot(sub(rail.at(b).position, rail.at(a).position), sub(boundary.at(b).position, boundary.at(a).position)) < -(topology.tolerance ** 2)) {
        throw new RangeError('Round radius folds a contact rail beyond its convergence');
      }
    }
    adjacent.forEach((surface, index) => {
      const entries = replacements.get(surface) ?? new Map(), side = placements[index].side;
      entries.set(boundary, { rail: rails[index], uv: (t: number) => {
        const uv = pair(station(t, index)).uv[index];
        const start = placements[index].uv(0), end = placements[index].uv(1);
        return closed && t === 1 ? { x: uv.x + end.x - start.x, y: uv.y + end.y - start.y } : uv;
      }, side, reversed: placements[index].reversed });
      replacements.set(surface, entries);
    });
    const normal = (u: number, v: number) => pair(station(u, v)).normal(v);
    const evaluate = (u: number, v: number): Vertex => raw(station(u, v), v);
    const endRails: Partial<Record<Side, RoundRail>> = {};
    if (!closed) for (const t of [0, 1] as const) {
      const vertex = t === 0 ? boundary.start : boundary.end;
      if (junctions.has(vertex)) continue;
      const cap = caps[t];
      const arc = topology.rail(v => evaluate(t, v));
      const corner = corners.get(vertex);
      if (corner) { corner.arcs.set(boundary, arc); endRails[t === 0 ? 'u0' : 'u1'] = arc; continue; }
      if (!cap) throw new RangeError('Blend end has no supporting surface');
      if (cap instanceof Face && arc.boundary?.sample().some(point => Math.abs(vec3.dot(sub(point.position, cap.plane.origin), cap.plane.normal)) > topology.tolerance)) {
        throw new UnsupportedRoundError('Open round contacts leave the end cap; end-surface intersection trimming is required');
      }
      ends.set(vertex, arc); endRails[t === 0 ? 'u0' : 'u1'] = arc;
      if (!(cap instanceof Face) && arc.boundary) {
        const entries = replacements.get(cap) ?? new Map();
        entries.set(arc.boundary, { rail: arc, uv: (v: number) => { station(t, v); return capParameters.get(v)![t]; }, reversed: false });
        replacements.set(cap, entries);
      }
      adjacent.forEach((surface, i) => {
        const neighbors = surface.boundaries.filter(other => other !== boundary && (other.start === vertex || other.end === vertex) && cap.boundaries.includes(other));
        if (neighbors.length !== 1 || selected.includes(neighbors[0])) throw new UnsupportedRoundError('Open round cannot resolve its neighboring end trim');
        const neighbor = neighbors[0], entries = contacts.get(neighbor) ?? new Map();
        entries.set(vertex, rails[i].at(t)); contacts.set(neighbor, entries);
      });
    }
    if (settings.kind === 'chamfer' && rails.some(rail => !rail.boundary)) throw new RangeError('Chamfer rail converges; use a smaller length');
    const hasJunction = !closed && [boundary.start, boundary.end].some(vertex => junctions.has(vertex));
    let patch: Surface | undefined = hasJunction ? undefined : settings.kind === 'chamfer' && closed
      ? new RuledSurface({ start: rails[0].boundary!, end: rails[1].boundary!, reversed:
        vec3.dot(vec3.cross([0, 0, 0], sub(rails[0].at(0.501).position, rails[0].at(0.499).position),
          sub(rails[1].at(0.5).position, rails[0].at(0.5).position)), normal(0.5, 0.5)) < 0 })
      : topology.patch(evaluate, { v0: rails[0], v1: rails[1], ...endRails }, normal, closed);
    if (hasJunction) {
      const trim = (rail: RoundRail, at: (t: number) => Point, reversed = false): SurfaceTrim => {
        if (!rail.boundary) throw new RangeError('A connected blend converges before its corner');
        const flip = rail.at(0) !== rail.boundary.start;
        return { boundary: rail.boundary, at: t => at(flip ? 1 - t : t), reversed: flip !== reversed };
      };
      const end = (u: 0 | 1): SurfaceTrim[] => {
        const junction = junctions.get(u ? boundary.end : boundary.start)?.get(boundary);
        return junction ? junction.seams.map(seam => trim(seam.rail, t => ({ x: u, y: seam.v(t) }), seam.v(1) < seam.v(0)))
          : [trim(endRails[u ? 'u1' : 'u0']!, t => ({ x: u, y: t }))];
      };
      const outer = [trim(rails[0], t => ({ x: t, y: 0 })), ...end(1), trim(rails[1], t => ({ x: t, y: 1 }), true),
        ...end(0).reverse().map(trim => ({ ...trim, reversed: !trim.reversed }))];
      const at = (u: number, v: number) => v === 0 ? rails[0].at(u) : v === 1 ? rails[1].at(u) : evaluate(u, v);
      const du = sub(at(0.501, 0.5).position, at(0.499, 0.5).position), dv = sub(at(0.5, 0.501).position, at(0.5, 0.499).position);
      const surface = new SpatialSurface({ at, reversed: vec3.dot(vec3.cross([0, 0, 0], du, dv), normal(0.5, 0.5)) < 0 });
      patch = new SurfaceRegion({ surface, regions: [{ outer }], boundaryLoops: [outer.map(trim => trim.boundary)] });
    }
    if (patch && settings.kind === 'chamfer' && !closed && source.every(surface => surface instanceof Face)
      && (hasJunction || caps.every(cap => cap instanceof Face))) {
      const point = evaluate(0.5, 0).position, x = unit(sub(evaluate(0.51, 0).position, evaluate(0.49, 0).position));
      const outward = unit(vec3.cross([0, 0, 0], x, sub(evaluate(0.5, 1).position, point)));
      if (vec3.dot(outward, normal(0.5, 0.5)) < 0) vec3.negate(outward, outward);
      const y = vec3.cross([0, 0, 0], outward, x);
      patch = new Face({ outer: patch.boundaryLoops[0], plane: new Plane({ a: point,
        b: vec3.add([0, 0, 0], point, x), c: vec3.add([0, 0, 0], point, y) }) });
    }
    if (patch) rounded.push(patch);
  }
  for (const corner of corners.values()) {
    const [a, b, c] = corner.sources;
    const arc = (first: ParametricFace, second: ParametricFace) => {
      const boundary = [...corner.arcs.keys()].find(boundary => first.boundaries.includes(boundary) && second.boundaries.includes(boundary))!;
      return corner.arcs.get(boundary)!;
    };
    const normal = (u: number, v: number) => spherical(spherical(corner.normals[0], corner.normals[1], u), corner.normals[2], v);
    const patch = topology.patch((u, v) => ({ position: vec3.scaleAndAdd([0, 0, 0], corner.center, normal(u, v), radius * corner.sense) }),
      { v0: arc(a, b), u0: arc(a, c), u1: arc(b, c), v1: { at: () => corner.points[2] } }, normal);
    if (patch) rounded.push(patch);
  }
  for (const [boundary, vertices] of contacts) {
    const start = vertices.get(boundary.start) ?? boundary.start, end = vertices.get(boundary.end) ?? boundary.end;
    const a = start === boundary.start ? 0 : curveParameter(boundary, start.position), b = end === boundary.end ? 1 : curveParameter(boundary, end.position);
    if (b < a - 1e-9 || vec3.distance(boundary.at(a).position, start.position) > topology.tolerance || vec3.distance(boundary.at(b).position, end.position) > topology.tolerance) {
      throw new RangeError('Round consumes an end trim or its contacts leave the neighboring boundary');
    }
    const rail = vec3.distance(start.position, end.position) <= topology.tolerance ? { at: () => start }
      : { boundary: sliceSpatialCurve(boundary, a, b, start, end), at: (t: number) => boundary.at(a + (b - a) * t) };
    for (const surface of graph.adjoining(boundary)) {
      if (!(surface instanceof Face || surface instanceof SpatialSurface || surface instanceof SurfaceRegion)) throw new UnsupportedRoundError('Open round end trims require a regular surface chart');
      const placement = graph.placement(surface, boundary), entries = replacements.get(surface) ?? new Map();
      entries.set(boundary, { rail, uv: (t: number) => placement.uv(a + (b - a) * t), side: placement.side, reversed: placement.reversed, sourceRange: [a, b] }); replacements.set(surface, entries);
    }
  }
  const contactTopology = new RoundContacts(topology);
  const retained = surfaces.flatMap(surface => {
    const entries = replacements.get(surface);
    if (!entries) return [surface];
    const loops = surface.boundaryLoops.map(loop => {
      const pieces = orientLoop(loop).map(({ boundary, reversed }) => {
        const trim = entries.get(boundary), rail = trim?.rail ?? { boundary, at: (t: number) => boundary.at(t) };
        return { rail, start: rail.at(reversed ? 1 : 0), end: rail.at(reversed ? 0 : 1), vertex: reversed ? boundary.start : boundary.end };
      });
      return [...new Set(pieces.flatMap((piece, i) => {
        const next = pieces[(i + 1) % pieces.length], result = piece.rail.boundary ? [piece.rail.boundary] : [];
        if (vec3.distance(piece.end.position, next.start.position) <= topology.tolerance) return result;
        const arc = ends.get(piece.vertex);
        if (!arc?.boundary || ![false, true].some(reverse => vec3.distance(arc.at(reverse ? 1 : 0).position, piece.end.position) <= topology.tolerance && vec3.distance(arc.at(reverse ? 0 : 1).position, next.start.position) <= topology.tolerance)) {
          throw new RangeError('Round face trim cannot join its endpoint rails');
        }
        return [...result, arc.boundary];
      }))];
    });
    if (surface instanceof Face) return contactTopology.face(surface, loops,
      new Set([...entries.values()].flatMap(trim => trim.rail.boundary ? [trim.rail.boundary] : [])));
    if (surface instanceof SurfaceRegion || [...entries.keys()].some(boundary => !surface.boundaries.includes(boundary))) {
      const rails = new Map([...entries].map(([boundary, trim]) => {
        if (!trim.rail.boundary) throw new UnsupportedRoundError('Surface region blends require noncollapsing contact rails');
        return [boundary, { boundary: trim.rail.boundary, uv: trim.uv, sourceRange: trim.sourceRange }] as const;
      }));
      return [trimRegionRails(surface as SpatialSurface | SurfaceRegion, rails, loops)];
    }
    const original = surface as SpatialSurface;
    const trims = new Map([...entries.values()].map(trim => [trim.side!, trim]));
    const uv = (side: Side, t: number) => {
      const trim = trims.get(side); return trim?.uv(trim.reversed ? 1 - t : t);
    };
    const corners = [uv('v0', 0) ?? uv('u0', 0) ?? { x: 0, y: 0 }, uv('v0', 1) ?? uv('u1', 0) ?? { x: 1, y: 0 },
      uv('v1', 0) ?? uv('u0', 1) ?? { x: 0, y: 1 }, uv('v1', 1) ?? uv('u1', 1) ?? { x: 1, y: 1 }];
    const lerp = (a: Point, b: Point, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    const chart = (u: number, v: number): Point => {
      const left = uv('u0', v) ?? lerp(corners[0], corners[2], v), right = uv('u1', v) ?? lerp(corners[1], corners[3], v);
      const bottom = uv('v0', u) ?? lerp(corners[0], corners[1], u), top = uv('v1', u) ?? lerp(corners[2], corners[3], u);
      if (right.x < left.x - 1e-8 || top.y < bottom.y - 1e-8) throw new RangeError('Round radius overlaps opposing surface trims');
      const blend = (axis: 'x' | 'y') => (1 - u) * ((1 - v) * corners[0][axis] + v * corners[2][axis]) + u * ((1 - v) * corners[1][axis] + v * corners[3][axis]);
      return { x: (1 - v) * bottom.x + v * top.x + (1 - u) * left.x + u * right.x - blend('x'),
        y: (1 - v) * bottom.y + v * top.y + (1 - u) * left.y + u * right.y - blend('y') };
    };
    const at = (u: number, v: number) => atSurface(original, chart(u, v));
    const collapsed = (!original.periodicU && [0, 0.5, 1].every(t => vec3.distance(at(0, t).position, at(1, t).position) <= topology.tolerance))
      || (!original.periodicV && [0, 0.5, 1].every(t => vec3.distance(at(t, 0).position, at(t, 1).position) <= topology.tolerance));
    if (collapsed) return [];
    const sides = Object.fromEntries(Object.entries(original.sides).map(([side, boundary]) => [side,
      entries.has(boundary) ? entries.get(boundary)!.rail.boundary : boundary]));
    return [new TrimmedSurface({ surface: original, at: chart, sides, boundaryLoops: loops.filter(loop => loop.length) })];
  });
  return [...retained, ...rounded.map(surface => contactTopology.surface(surface))];
}
