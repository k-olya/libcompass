import { LineSegment } from '../LineSegment.js';
import { PlanarCurve } from '../PlanarCurve.js';
import type { PlanarLoop } from '../PlanarLoop.js';
import type { Point } from '../Point.js';
import type { Sketch } from '../Sketch.js';
import { joinPlanarCurves } from './joinPlanarCurves.js';
import { containsInterior, signedArea, validateLoops } from './polygon.js';

/** Exact oriented boundaries retained alongside temporary analysis polylines. */
export type ProfileBoundary = { curve: PlanarCurve; reversed: boolean; straight: false }
  | { curve: LineSegment; reversed: boolean; straight: true };
export class Profile implements PlanarLoop {
  readonly boundaries: ProfileBoundary[];
  readonly points: Point[];
  readonly signedArea: number;
  readonly anchor: Point;
  constructor({ boundaries }: { boundaries: ProfileBoundary[] }) {
    this.boundaries = joinPlanarCurves(boundaries);
    this.points = this.boundaries.flatMap(({ curve, reversed, straight }) => {
      const points = straight ? [curve.start, curve.end] : curve.sample();
      return (reversed ? [...points].reverse() : points).slice(0, -1);
    });
    this.anchor = this.points[0];
    this.signedArea = signedArea(this.points);
  }
  area(): number { return Math.abs(this.signedArea); }
  contains(options: Point | { point: Point }): boolean { return containsInterior(this.points, 'point' in options ? options.point : options); }
}
export const profileArea = (profile: Profile): number => profile.area();
export const profileAnchor = (profile: Profile): Point => profile.anchor;
export const profileContains = (profile: Profile, point: Point): boolean => profile.contains({ point });

/** Assemble exact boundaries, then analyze their sampled polylines. */
export function sketchProfiles(sketch: Sketch): Profile[] {
  const boundaries: ProfileBoundary[] = sketch.elements.flatMap<ProfileBoundary>(element => element instanceof PlanarCurve
    ? [{ curve: element, reversed: false, straight: false }]
    : element instanceof LineSegment ? [{ curve: element, reversed: false, straight: true }] : []);
  const closed = ({ curve, straight }: ProfileBoundary) => !straight && curve.isLoop();
  const profiles = boundaries.filter(closed).map(boundary => new Profile({ boundaries: [boundary] }));
  const open = new Set(boundaries.filter(boundary => !closed(boundary)));
  const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  const degree = (point: Point) => [...open].filter(({ curve }) => equal(curve.start, point) || equal(curve.end, point)).length;
  for (const { curve } of open) {
    if (degree(curve.start) !== 2 || degree(curve.end) !== 2) throw new RangeError('Sketch boundaries must form closed, unbranched loops');
  }
  while (open.size) {
    const first = open.values().next().value!;
    open.delete(first);
    const loop = [first];
    let end = first.curve.end;
    while (!equal(end, first.curve.start)) {
      const next = [...open].find(({ curve }) => equal(curve.start, end) || equal(curve.end, end));
      if (!next) throw new RangeError('Sketch boundaries must form closed loops');
      open.delete(next);
      next.reversed = !equal(next.curve.start, end);
      loop.push(next);
      end = next.reversed ? next.curve.start : next.curve.end;
    }
    profiles.push(new Profile({ boundaries: loop }));
  }
  if (!profiles.length) throw new RangeError('Extrusion needs at least one closed profile');
  validateLoops(profiles.map(profile => profile.points));
  return profiles;
}

/** Parent contours and nesting depth, independent of insertion order or winding. */
export function profileNesting(profiles: readonly Profile[]): { parents: number[]; depths: number[] } {
  const areas = profiles.map(profileArea);
  const parents = profiles.map((profile, i) => {
    let parent = -1;
    profiles.forEach((candidate, j) => {
      if (i !== j && areas[j] > areas[i] && profileContains(candidate, profileAnchor(profile)) &&
          (parent === -1 || areas[j] < areas[parent])) parent = j;
    });
    return parent;
  });
  const depths = parents.map(parent => {
    let depth = 0;
    for (let i = parent; i !== -1; i = parents[i]) depth++;
    return depth;
  });
  return { parents, depths };
}
