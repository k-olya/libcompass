import { PlanarCurve } from '../PlanarCurve.js';
import { validatePoint, type Point } from '../Point.js';
import { degtorad } from '../util/angles.js';

/**
 * Create an exact elliptical loop in local sketch coordinates.
 * @param options.center - Ellipse center in local XY coordinates.
 * @param options.radiusX - Positive semi-axis length along local X before rotation.
 * @param options.radiusY - Positive semi-axis length along local Y before rotation.
 * @param options.rotation - Counterclockwise rotation in degrees about center; defaults to zero.
 * @returns A counterclockwise PlanarCurve on [0, 1] with an analytic tangent.
 * at(0) is the rotated +X semi-axis endpoint; at(1) shares that endpoint object.
 * Sampling and lifting use the ordinary curve methods; geometry stays mathematical.
 * @throws {@link RangeError} for nonfinite coordinates/rotation or nonpositive/nonfinite radii.
 * @example
 * ```ts
 * s.add(ellipse({ center: { x: 0, y: 0 }, radiusX: 10, radiusY: 5, rotation: 30 }));
 * ```
 */
export function ellipse({ center, radiusX, radiusY, rotation: rotationDEG = 0 }: {
  /** Center in sketch coordinates, retained by reference. Treat captured geometry as immutable. */
  center: Point;
  /** Positive X semi-axis length before rotation, in model units. */
  radiusX: number;
  /** Positive Y semi-axis length before rotation, in model units. */
  radiusY: number;
  /** Counterclockwise orientation in degrees; defaults to zero. */
  rotation?: number;
}): PlanarCurve {
  validatePoint(center);
  if (![radiusX, radiusY].every(radius => Number.isFinite(radius) && radius > 0)) {
    throw new RangeError('Ellipse radii must be positive and finite');
  }
  if (!Number.isFinite(rotationDEG)) throw new RangeError('Ellipse rotation must be finite');
  const rotationRAD = degtorad(rotationDEG % 360), cos = Math.cos(rotationRAD), sin = Math.sin(rotationRAD);
  const at = (t: number): Point => {
    const angleRAD = t === 1 ? 0 : t * 2 * Math.PI;
    const x = radiusX * Math.cos(angleRAD), y = radiusY * Math.sin(angleRAD);
    return { x: center.x + x * cos - y * sin, y: center.y + x * sin + y * cos };
  };
  const start = at(0);
  return new PlanarCurve({ at, start, end: start,
    tangent: t => {
      const angleRAD = t * 2 * Math.PI;
      const x = -radiusX * Math.sin(angleRAD), y = radiusY * Math.cos(angleRAD);
      return [x * cos - y * sin, x * sin + y * cos];
    },
  });
}
