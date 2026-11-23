import type { ReadonlyVec2 } from 'gl-matrix';
import { PlanarCurve } from '../PlanarCurve.js';
import type { Point } from '../Point.js';
import { rememberSample } from './curveSamples.js';
import type { ProfileBoundary } from './profiles.js';

type Piece = ProfileBoundary;
const firstPoint = ({ curve, reversed }: Piece) => reversed ? curve.end : curve.start;
const lastPoint = ({ curve, reversed }: Piece) => reversed ? curve.start : curve.end;
const equal = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const tangent = (piece: Piece, t: number): ReadonlyVec2 => {
  if (!piece.straight) return piece.curve.tangent(t);
  const x = piece.curve.end.x - piece.curve.start.x, y = piece.curve.end.y - piece.curve.start.y, length = Math.hypot(x, y);
  if (!length) throw new RangeError('Cannot join a degenerate line segment');
  return [x / length, y / length];
};

function smooth(a: ProfileBoundary, b: ProfileBoundary): boolean {
  if ((!a.straight && a.curve.isLoop()) || (!b.straight && b.curve.isLoop()) || !equal(lastPoint(a), firstPoint(b))) return false;
  try {
    const x = tangent(a, a.reversed ? 0 : 1), y = tangent(b, b.reversed ? 1 : 0);
    const sign = a.reversed === b.reversed ? 1 : -1;
    return sign * (x[0] * y[0] + x[1] * y[1]) > 0 && Math.abs(x[0] * y[1] - x[1] * y[0]) <= 1e-7;
  } catch (error) {
    // An unresolved endpoint tangent cannot justify removing a topological join.
    if (error instanceof RangeError) return false;
    throw error;
  }
}

/** Compose equations, not polylines; each source keeps one equal normalized interval. */
function joined(pieces: readonly Piece[]): PlanarCurve {
  const start = firstPoint(pieces[0]), last = lastPoint(pieces[pieces.length - 1]);
  const locate = (t: number) => {
    const index = t === 1 ? pieces.length - 1 : Math.floor(t * pieces.length);
    const piece = pieces[index], local = t === 1 ? 1 : t * pieces.length - index;
    return { ...piece, t: piece.reversed ? 1 - local : local };
  };
  const curve = new PlanarCurve({ start, end: equal(start, last) ? start : last,
    at: t => { const piece = locate(t); return piece.curve.at(piece.t); },
    tangent: t => {
      const piece = locate(t), direction = tangent(piece, piece.t), sign = piece.reversed ? -1 : 1;
      return [sign * direction[0], sign * direction[1]];
    },
  });
  curve.sample = (options = {}) => pieces.flatMap((piece, index) => {
    const samples = piece.straight ? [{ t: 0, point: piece.curve.start }, { t: 1, point: piece.curve.end }]
      : piece.curve.sampleWithParameters(options);
    const oriented = piece.reversed ? samples.reverse() : samples;
    return oriented.flatMap(({ t, point }, i) => {
      if (index > 0 && i === 0) return [];
      const parameter = (index + (piece.reversed ? 1 - t : t)) / pieces.length;
      const vertex = parameter === 0 ? curve.start : parameter === 1 ? curve.end : point;
      return [rememberSample(curve, vertex, parameter)];
    });
  });
  return curve;
}

/** Join smooth runs within an oriented closed profile; existing loops remain independent. */
export function joinPlanarCurves(boundaries: ProfileBoundary[]): ProfileBoundary[] {
  if (boundaries.length < 2) return boundaries;
  const joins = boundaries.map((boundary, i) => smooth(boundary, boundaries[(i + 1) % boundaries.length]));
  if (!joins.some(Boolean)) return boundaries;
  const combine = (run: ProfileBoundary[]): ProfileBoundary[] => run.length === 1 || run.every(piece => piece.straight) ? run
    : [{ curve: joined(run), reversed: false, straight: false }];
  if (joins.every(Boolean)) return combine(boundaries);
  // Start after a sharp join so a smooth run can cross the original profile seam.
  const start = (joins.indexOf(false) + 1) % boundaries.length, runs: ProfileBoundary[][] = [[]];
  for (let offset = 0; offset < boundaries.length; offset++) {
    const index = (start + offset) % boundaries.length;
    if (offset && !joins[(index + boundaries.length - 1) % boundaries.length]) runs.push([]);
    runs[runs.length - 1].push(boundaries[index]);
  }
  if (runs.length === 1) {
    // A curve whose endpoints coincide is automatically a loop. Keep two pieces
    // when the closing join is sharp, rather than hiding that real corner.
    const last = runs[0].pop()!;
    runs.push([last]);
  }
  return runs.some(run => run.length > 1 && run.some(piece => !piece.straight)) ? runs.flatMap(combine) : boundaries;
}
