import { PlanarCurve } from '../PlanarCurve.js';
import { validatePoint, type Point } from '../Point.js';
import { degtorad } from '../util/angles.js';

/**
 * Create an exact circular arc from a center, a point on the arc, or a signed angle.
 * @param options.start - First point in local sketch coordinates.
 * @param options.end - Last point, distinct from start. Omit with center plus angle;
 * the endpoint is then calculated by rotating start about center.
 * @param options.center - Circle center; pair with end/direction or with a signed angle.
 * When end is supplied, start and end must lie on the same circle about this center.
 * @param options.through - Point the arc must pass through; determines its circle
 * and direction with start/end. Omit center and angle. The three points must not be collinear.
 * @param options.direction - 'clockwise' or 'counterclockwise'; defaults to
 * counterclockwise with center/end, or is inferred with through. An explicit direction
 * must agree with the through point.
 * @param options.angle - Signed sweep in degrees, strictly between -360 and 360, excluding zero.
 * Pair with end or center, but not both; omit direction and through.
 * Positive travels counterclockwise; negative travels clockwise. Magnitudes
 * greater than 180 create major arcs.
 * @returns A PlanarCurve with exact endpoints and an analytic unit tangent.
 * Sampling, profile analysis, and lifting use the ordinary curve methods.
 * @throws {@link RangeError} for nonfinite coordinates, coincident endpoints,
 * invalid angles, or geometry outside numeric range.
 * @example
 * ```ts
 * const a = arc({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 }, angle: 180 });
 * const b = arc({ center: { x: 0, y: 0 }, start: { x: 5, y: 0 },
 *   end: { x: 0, y: 5 }, direction: 'counterclockwise' });
 * const c = arc({ start: { x: 0, y: 0 }, through: { x: 5, y: 5 }, end: { x: 10, y: 0 } });
 * const d = arc({ start: { x: 5, y: 0 }, center: { x: 0, y: 0 }, angle: -90 });
 * s.add(a, lineSegment({ start: a.end, end: a.start }));
 * ```
 */
export function arc({ start, end, center, through, direction, angle: angleDEG }: {
  /** Shared endpoint at parameter zero. */
  start: Point;
  /** Shared endpoint at parameter one; omit when supplying center plus angle. */
  end?: Point;
  /** Circle center, paired with end/direction or a signed angle. */
  center?: Point;
  /** Point on the arc between start and end; mutually exclusive with center and angle. */
  through?: Point;
  /** Travel direction: default counterclockwise with center/end, inferred with through. Omit with angle. */
  direction?: 'clockwise' | 'counterclockwise';
  /** Signed sweep in degrees: positive counterclockwise, negative clockwise; supply end or center. */
  angle?: number;
}): PlanarCurve {
  validatePoint(start);
  const centerAngle = center !== undefined && angleDEG !== undefined;
  if (centerAngle ? end !== undefined || through !== undefined
    : [center !== undefined, through !== undefined, angleDEG !== undefined].filter(Boolean).length !== 1) {
    throw new RangeError('Choose one arc construction: end/center, end/through, end/angle, or center/angle');
  }
  if (end === undefined && !centerAngle) throw new RangeError('Arc end is required unless supplying center and angle');
  if (end !== undefined) validatePoint(end);
  const dx = end ? end.x - start.x : 0, dy = end ? end.y - start.y : 0;
  if (end && dx === 0 && dy === 0) throw new RangeError('An arc needs distinct endpoints');
  if (direction !== undefined && direction !== 'clockwise' && direction !== 'counterclockwise') {
    throw new RangeError('Arc direction must be clockwise or counterclockwise');
  }
  let sweepRAD = 0, radialX: number, radialY: number;
  if (angleDEG !== undefined) {
    if (direction !== undefined) throw new RangeError('Use the signed arc angle without a separate direction');
    if (!Number.isFinite(angleDEG) || angleDEG === 0 || Math.abs(angleDEG) >= 360) {
      throw new RangeError('Arc angle must be nonzero and strictly between -360 and 360 degrees');
    }
    sweepRAD = degtorad(angleDEG);
    if (sweepRAD === 0) throw new RangeError('Arc angle is too small to represent');
  }
  if (through !== undefined) {
    validatePoint(through);
    const ux = through.x - start.x, uy = through.y - start.y;
    const scale = Math.max(Math.abs(ux), Math.abs(uy), Math.abs(dx), Math.abs(dy));
    const a = ux / scale, b = uy / scale, c = dx / scale, d = dy / scale;
    const determinant = 2 * (a * d - b * c);
    if (!Number.isFinite(determinant) || determinant === 0) throw new RangeError('Arc start, through and end must be distinct and noncollinear');
    const firstSquared = a * a + b * b, secondSquared = c * c + d * d;
    radialX = -(firstSquared * d - secondSquared * b) / determinant * scale;
    radialY = -(a * secondSquared - c * firstSquared) / determinant * scale;
    const radius = Math.hypot(radialX, radialY), x = radialX / radius, y = radialY / radius;
    sweepRAD = Math.atan2((x * dy - y * dx) / radius, 1 + (x * dx + y * dy) / radius);
    if (determinant > 0 && sweepRAD <= 0) sweepRAD += 2 * Math.PI;
    if (determinant < 0 && sweepRAD >= 0) sweepRAD -= 2 * Math.PI;
    if ((direction === 'clockwise' && sweepRAD > 0) || (direction === 'counterclockwise' && sweepRAD < 0)) {
      throw new RangeError('Arc direction must agree with the start, through and end order');
    }
  } else if (center !== undefined) {
    validatePoint(center);
    radialX = start.x - center.x; radialY = start.y - center.y;
    if (end !== undefined) {
      const radius = Math.hypot(radialX, radialY), endX = end.x - center.x, endY = end.y - center.y;
      const endRadius = Math.hypot(endX, endY);
      if (!Number.isFinite(radius) || radius === 0 || !Number.isFinite(endRadius) || endRadius === 0 || Math.abs(radius - endRadius) > 1e-10 * Math.max(radius, endRadius)) {
        throw new RangeError('Arc endpoints must lie on the same positive-radius circle about center');
      }
      const x = radialX / radius, y = radialY / radius, u = endX / endRadius, v = endY / endRadius;
      sweepRAD = Math.atan2(x * v - y * u, x * u + y * v);
      if (sweepRAD === 0) throw new RangeError('Arc endpoints must have distinct angular positions');
      if (direction === 'clockwise' && sweepRAD > 0) sweepRAD -= 2 * Math.PI;
      if (direction !== 'clockwise' && sweepRAD < 0) sweepRAD += 2 * Math.PI;
    }
  } else {
    const offset = 0.5 / Math.tan(sweepRAD / 2);
    radialX = -dx / 2 + dy * offset; radialY = -dy / 2 - dx * offset;
  }
  const radius = Math.hypot(radialX, radialY);
  if (!Number.isFinite(radius) || radius === 0) throw new RangeError('Arc radius must be positive and finite');
  const startX = start.x, startY = start.y;
  const evaluate = (t: number): Point => {
    const rotationRAD = t * sweepRAD;
    // Evaluate the displacement from start, avoiding center subtraction for shallow arcs.
    const deltaCos = -2 * Math.sin(rotationRAD / 2) ** 2, sin = Math.sin(rotationRAD);
    return { x: startX + radialX * deltaCos - radialY * sin, y: startY + radialX * sin + radialY * deltaCos };
  };
  const endpoint = end ?? validatePoint(evaluate(1));
  if (endpoint.x === start.x && endpoint.y === start.y) throw new RangeError('Arc endpoint cannot be distinguished from start at numeric precision');
  return new PlanarCurve({ start, end: endpoint,
    at: t => t === 0 ? start : t === 1 ? endpoint : evaluate(t),
    tangent: t => {
      const rotationRAD = t * sweepRAD, sign = Math.sign(sweepRAD);
      const x = radialX / radius, y = radialY / radius;
      return [sign * (-x * Math.sin(rotationRAD) - y * Math.cos(rotationRAD)),
        sign * (x * Math.cos(rotationRAD) - y * Math.sin(rotationRAD))];
    },
  });
}
