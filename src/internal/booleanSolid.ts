import { vec3, type ReadonlyVec3 } from 'gl-matrix';
import { Face } from '../Face.js';
import { Plane } from '../Plane.js';
import { Solid } from '../Solid.js';
import type { SpatialBoundary } from '../SpatialBoundary.js';
import { SpatialSurface } from '../SpatialSurface.js';
import { Surface } from '../Surface.js';
import { SurfaceRegion } from '../SurfaceRegion.js';
import type { Vertex } from '../Vertex.js';
import { BooleanMesh } from './booleanMesh.js';
import { booleanTopology, sameBooleanBoundary, type BooleanPatch } from './booleanTopology.js';
import { orientLoop } from './boundaryLoops.js';
import { containsPoint } from './polygon.js';
import { surfaceFrame } from './surfaceGeometry.js';
import { localCurve, trimFace } from './trimFace.js';
import { trimSpatialSurface } from './trimSpatialSurface.js';
import { validateSweepMesh } from './validateSweepMesh.js';
import { generalBoolean } from './generalBoolean.js';
import { unifyUnion } from './unifyUnion.js';

const distance = (plane: Plane, point: ReadonlyVec3) => vec3.dot(vec3.subtract([0, 0, 0], point, plane.origin), plane.normal);

function points(surface: Surface): Vertex[] {
  return surface instanceof SpatialSurface ? surface.sample().vertices.flat() : surface.boundaries.flatMap(boundary => boundary.sample());
}

function onFace(face: Face, position: ReadonlyVec3, tolerance: number): boolean {
  if (Math.abs(distance(face.plane, position)) > tolerance) return false;
  const projected = vec3.scaleAndAdd([0, 0, 0], position, face.plane.normal, -distance(face.plane, position));
  const point = face.plane.toLocal(projected);
  const polygons = face.boundaryLoops.map(loop => orientLoop(loop).flatMap(({ boundary, reversed }) => {
    const samples = boundary.sample().map(vertex => face.plane.toLocal(vertex));
    return (reversed ? samples.reverse() : samples).slice(0, -1);
  }));
  return containsPoint(polygons[0], point) && !polygons.slice(1).some(loop => containsPoint(loop, point));
}

/** Interior probes come from retained math patches, never from a replacement solid. */
function probes(surface: Surface): { point: ReadonlyVec3; normal: ReadonlyVec3 }[] {
  if (surface instanceof SpatialSurface) return [[0.37, 0.43], [0.61, 0.57], [0.23, 0.71]].map(([u, v]) => ({
    point: surface.at(u, v).position, normal: surfaceFrame(surface, { x: u, y: v }).normal,
  }));
  if (!(surface instanceof Face)) throw new RangeError('Boolean requires planar faces or parametric spatial surfaces');
  const mesh = surface.triangulate(), triangles: { area: number; point: ReadonlyVec3; normal: ReadonlyVec3 }[] = [];
  for (let i = 0; i < mesh.length; i += 9) {
    const [a, b, c] = [0, 3, 6].map(j => Array.from(mesh.subarray(i + j, i + j + 3)) as [number, number, number]);
    const center = vec3.scale([0, 0, 0], vec3.add([0, 0, 0], vec3.add([0, 0, 0], a, b), c), 1 / 3);
    const point = vec3.scaleAndAdd([0, 0, 0], center, surface.plane.normal, -distance(surface.plane, center));
    triangles.push({ area: vec3.length(vec3.cross([0, 0, 0], vec3.subtract([0, 0, 0], b, a), vec3.subtract([0, 0, 0], c, a))), point, normal: surface.plane.normal });
  }
  return triangles.sort((a, b) => b.area - a.area).slice(0, 3);
}

/** An existing side or a supported transverse trim supplies an exact closed cut rail. */
function intersectionRails(surface: SpatialSurface, plane: Plane, tolerance: number): SpatialBoundary[] {
  const onPlane = (boundary: SpatialBoundary) => boundary.sample().every(point => Math.abs(distance(plane, point.position)) <= tolerance);
  const existing = surface.boundaries.filter(onPlane);
  if (existing.length) return existing;
  const trimmed = trimSpatialSurface(surface, plane, 'positive');
  const rails = trimmed.flatMap(patch => patch.boundaries.filter(onPlane));
  if (!rails.length || rails.some(boundary => !boundary.isLoop())) throw new RangeError('Boolean requires a supported closed curved intersection rail');
  return rails;
}

export function booleanSolid(solid: Solid, tool: Solid, operation: 'intersect' | 'difference' | 'union'): Solid {
  if (!(solid instanceof Solid) || !(tool instanceof Solid)) throw new TypeError('Boolean operands must be Solid instances');
  const result = (surfaces: readonly Surface[]) => new Solid({ surfaces }).add(solid.children);
  const meshes = new Map<Surface, BooleanMesh>();
  const mesh = (surface: Surface) => {
    let analysis = meshes.get(surface);
    if (!analysis) { analysis = new BooleanMesh(surface.triangulate()); meshes.set(surface, analysis); }
    return analysis;
  };
  const validate = (operand: Solid): BooleanMesh => {
    for (const boundary of operand.boundaries) if (operand.surfaces.filter(surface => surface.boundaries.includes(boundary)).length !== 2) {
      throw new RangeError('Boolean requires shared closed manifold input topology');
    }
    const positions = Surface.triangulateAll(operand.surfaces);
    if (positions.length) validateSweepMesh(positions);
    return new BooleanMesh(positions);
  };
  const a = validate(solid), b = solid === tool ? a : validate(tool);
  if (solid === tool) return result(operation === 'difference' ? [] : solid.surfaces);
  if (!a.triangles.length || !b.triangles.length) return result(operation === 'union' ? [...solid.surfaces, ...tool.surfaces] : operation === 'difference' ? solid.surfaces : []);
  const scale = Math.max(1, ...a.bounds.max.map((x, i) => x - a.bounds.min[i]), ...b.bounds.max.map((x, i) => x - b.bounds.min[i]));
  const tolerance = scale * 1e-8;
  // Regularized booleans discard zero-volume face/edge/point contact.
  if (operation === 'union'
    ? a.bounds.min.some((x, i) => x > b.bounds.max[i] + tolerance || a.bounds.max[i] < b.bounds.min[i] - tolerance)
    : a.bounds.min.some((x, i) => x >= b.bounds.max[i] - tolerance || a.bounds.max[i] <= b.bounds.min[i] + tolerance)) {
    if (operation === 'union') return result([...solid.surfaces, ...tool.surfaces]);
    return result(operation === 'difference' ? solid.surfaces : []);
  }
  const sameMesh = a.triangles.length === b.triangles.length && (() => {
    const key = (analysis: BooleanMesh) => analysis.triangles.map(triangle => triangle.points.map(point => Array.from(point).join(',')).sort().join('|')).sort().join(';');
    return key(a) === key(b);
  })();
  if (sameMesh) return result(operation === 'difference' ? [] : solid.surfaces);
  const finish = (surfaces: Surface[]): Solid => {
    if (operation === 'union') surfaces = unifyUnion(surfaces, tolerance);
    for (const boundary of new Set(surfaces.flatMap(surface => surface.boundaries))) if (surfaces.filter(surface => surface.boundaries.includes(boundary)).length !== 2) {
      throw new RangeError('Boolean could not sew shared closed manifold boundaries');
    }
    if (surfaces.length) {
      try { validateSweepMesh(Surface.triangulateAll(surfaces)); }
      catch (cause) { throw new RangeError(`Boolean result validation failed: ${cause instanceof Error ? cause.message.replaceAll('Sweep', 'Solid') : cause}`, { cause }); }
    }
    return result(surfaces);
  };
  const general = () => finish(generalBoolean(solid, tool, operation, a, b, tolerance));
  let separatingPlanes: Plane[] | undefined;
  const boundaryContactOnly = (face: Face): boolean => {
    if (operation !== 'union') return false;
    separatingPlanes ??= ([[solid, a, b], [tool, b, a]] as const).flatMap(([operand, own, other]) => operand.surfaces
      .filter((surface): surface is Face => surface instanceof Face)
      .filter(surface => own.triangles.every(triangle => triangle.points.every(point => distance(surface.plane, point) <= tolerance))
        && other.triangles.every(triangle => triangle.points.every(point => distance(surface.plane, point) >= -tolerance)))
      .map(surface => surface.plane));
    // Across a separating plane, a transverse face can meet the other operand
    // only on its boundary. Open curved contact there does not partition its area.
    return separatingPlanes.some(plane => Math.abs(vec3.dot(plane.normal, face.plane.normal)) < 1 - 1e-10);
  };
  if ([...solid.surfaces, ...tool.surfaces].some(surface => surface instanceof SurfaceRegion)) return general();
  for (const first of solid.surfaces) if (operation !== 'union' && first instanceof SpatialSurface) for (const second of tool.surfaces) {
    if (second instanceof SpatialSurface && mesh(first).intersects(mesh(second), tolerance)) {
      return general();
    }
  }
  const split = (source: Surface, cutters: readonly Surface[]): Surface[] => {
    let patches = [source];
    for (const cutter of cutters) {
      patches = patches.flatMap(patch => {
        if (cutter instanceof Face) {
          const signed = points(patch).map(point => distance(cutter.plane, point.position));
          if (!signed.some(value => value > tolerance) || !signed.some(value => value < -tolerance)) return [patch];
          if (patch instanceof Face) return [...trimFace(patch, cutter.plane, 'positive'), ...trimFace(patch, cutter.plane, 'negative')];
          if (!(patch instanceof SpatialSurface)) throw new RangeError('Boolean encountered an unsupported surface');
          if (!mesh(patch).intersects(mesh(cutter), tolerance)) return [patch];
          return [...trimSpatialSurface(patch, cutter.plane, 'positive'), ...trimSpatialSurface(patch, cutter.plane, 'negative')];
        }
        if (!(cutter instanceof SpatialSurface) || !(patch instanceof Face)) return [patch];
        if (!mesh(patch).intersects(mesh(cutter), tolerance)) return [patch];
        if (boundaryContactOnly(patch)) return [patch];
        let pieces = [patch];
        for (const rail of intersectionRails(cutter, patch.plane, tolerance)) {
          // A coincident rim adds no partition. Its adjacent planar face handles side selection.
          const coincident = patch.boundaries.some(boundary => sameBooleanBoundary(boundary, rail, false, tolerance) || sameBooleanBoundary(boundary, rail, true, tolerance));
          if (coincident) continue;
          if (!rail.isLoop()) throw new RangeError('Boolean open curved intersections require multiple-chart trimming');
          const local = localCurve(rail, patch);
          pieces = pieces.flatMap(piece => [...trimFace(piece, local, 'inside'), ...trimFace(piece, local, 'outside')]);
        }
        return pieces;
      });
      if (patches.length > 10000) throw new RangeError('Boolean surface partition budget exceeded');
    }
    return patches;
  };
  try {
    const selected: BooleanPatch[] = [];
    for (const [operand, other, analysis, left] of [[solid, tool, b, true], [tool, solid, a, false]] as const) {
      for (const surface of operand.surfaces) for (const patch of split(surface, other.surfaces)) {
        const decisions = probes(patch).map(({ point, normal }) => {
          const coplanar = other.surfaces.find(candidate => candidate instanceof Face && Math.abs(vec3.dot(candidate.plane.normal, normal)) > 1 - 1e-10 && onFace(candidate, point, tolerance));
          if (coplanar instanceof Face) {
            const same = vec3.dot(coplanar.plane.normal, normal) > 0;
            return operation === 'difference' ? left && !same : left && same;
          }
          const inside = analysis.contains(point);
          return operation === 'union' ? !inside : operation === 'intersect' || !left ? inside : !inside;
        });
        if (!decisions.length || decisions.some(value => value !== decisions[0])) throw new RangeError('Boolean patch classification is unresolved; additional surface intersection trimming is required');
        if (decisions[0]) selected.push({ surface: patch, reverse: operation === 'difference' && !left });
      }
    }
    return finish(booleanTopology(selected, tolerance));
  } catch (cause) {
    if (!(cause instanceof RangeError)) throw cause;
    return general();
  }
}
