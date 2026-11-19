import { Circle } from '../Circle.js';
import { LineSegment } from '../LineSegment.js';
import type { Point } from '../Point.js';
import type { Sketch } from '../Sketch.js';
import { containsPoint, signedArea, validateLoops } from './polygon.js';

/** Exact input profiles; curves are never sampled to decide topology. */
export type Profile = { circle: Circle; points?: never } | { points: Point[]; circle?: never };

export const profileArea = (profile: Profile): number => profile.circle ? Math.PI * profile.circle.radius ** 2 : Math.abs(signedArea(profile.points));
export const profileAnchor = (profile: Profile): Point => profile.circle ? profile.circle.at(0) : profile.points[0];
export const profileContains = (profile: Profile, point: Point): boolean => profile.circle
  ? Math.hypot(point.x - profile.circle.center.x, point.y - profile.circle.center.y) < profile.circle.radius
  : containsPoint(profile.points, point);

/** Assemble segment loops and classify circle intersections analytically. */
export function sketchProfiles(sketch: Sketch): Profile[] {
  const circles = sketch.elements.filter((element): element is Circle => element instanceof Circle)
    .map(circle => new Circle({ center: { ...circle.center }, radius: circle.radius }));
  const segments = new Set(sketch.elements.filter((element): element is LineSegment => element instanceof LineSegment));
  const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
  const degree = (point: Point) => [...segments].filter(segment => equal(segment.start, point) || equal(segment.end, point)).length;
  for (const segment of segments) {
    if (degree(segment.start) !== 2 || degree(segment.end) !== 2) throw new RangeError('Sketch segments must form closed, unbranched loops');
  }
  const polygons: Point[][] = [];
  while (segments.size) {
    const first = segments.values().next().value!;
    segments.delete(first);
    const points = [{ ...first.start }];
    let end = first.end;
    while (!equal(end, first.start)) {
      points.push({ ...end });
      const next = [...segments].find(segment => equal(segment.start, end) || equal(segment.end, end));
      if (!next) throw new RangeError('Sketch segments must form closed loops');
      segments.delete(next);
      end = equal(next.start, end) ? next.end : next.start;
    }
    polygons.push(points);
  }
  if (!polygons.length && !circles.length) throw new RangeError('Extrusion needs at least one closed profile');
  validateLoops(polygons);
  for (const circle of circles) {
    for (const polygon of polygons) {
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i], b = polygon[(i + 1) % polygon.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const fraction = Math.max(0, Math.min(1, ((circle.center.x - a.x) * dx + (circle.center.y - a.y) * dy) / (dx * dx + dy * dy)));
        const distance = Math.hypot(a.x + dx * fraction - circle.center.x, a.y + dy * fraction - circle.center.y);
        const farthest = Math.max(Math.hypot(a.x - circle.center.x, a.y - circle.center.y), Math.hypot(b.x - circle.center.x, b.y - circle.center.y));
        const tolerance = Math.max(circle.radius, farthest) * 1e-10;
        if (distance <= circle.radius + tolerance && farthest >= circle.radius - tolerance) throw new RangeError('Profile boundaries must not intersect or touch');
      }
    }
  }
  for (let i = 0; i < circles.length; i++) {
    for (let j = i + 1; j < circles.length; j++) {
      const a = circles[i], b = circles[j];
      const distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y);
      const sum = a.radius + b.radius, difference = Math.abs(a.radius - b.radius), tolerance = sum * 1e-10;
      if (distance <= sum + tolerance && distance >= difference - tolerance) throw new RangeError('Profile boundaries must not intersect or touch');
    }
  }
  const profiles: Profile[] = [...circles.map(circle => ({ circle })), ...polygons.map(points => ({ points }))];
  if (profiles.some(profile => !Number.isFinite(profileArea(profile)) || profileArea(profile) <= 0)) throw new RangeError('Profile area must be positive and finite');
  return profiles;
}
