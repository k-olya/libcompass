import { PlanarCurve } from '../PlanarCurve.js';
import { validatePoint, type Point } from '../Point.js';

/**
 * Create planar curves from SVG path data using the browser's native geometry APIs.
 * @param options.d - SVG path data, including open or closed subpaths.
 * @param options.position - Translation in local XY coordinates; defaults to { x: 0, y: 0 }.
 * @param options.scale - Per-axis scale about local (0, 0); defaults to { x: 1, y: 1 }.
 * Negative values mirror an axis. Scaling precedes translation.
 * @returns One PlanarCurve, or an array when gaps separate its subpaths. Connected
 * subpaths share one curve. at(t) follows normalized native path length before
 * scaling, returning position + scale * point. Matching endpoints define a loop.
 * @remarks
 * Requires browser SVG path geometry support. Private path elements remain
 * detached from the document. The browser parses every command and computes
 * length and points; only moveto boundaries are separated to detect gaps.
 * SVG Y coordinates are unchanged. Stroke, caps, joins, transforms and other
 * SVG elements are ignored. Sampling uses the ordinary curve methods.
 * Geometric precision is limited by the browser's path implementation.
 * @throws {@link TypeError} if d is not a string or browser SVG geometry is unavailable.
 * @throws {@link RangeError} for empty data, nonfinite position/scale, or no positive-length geometry.
 * Native SVG errors propagate; malformed syntax follows the browser's parser behavior.
 * @example
 * ```ts
 * const outline = svgPath({
 *   d: 'M 0 0 C 0 10 10 10 10 0 Z',
 *   position: { x: -5, y: 0 },
 *   scale: { x: 1, y: -1 },
 * });
 * scene.add(sketch().add(outline).extrude({ length: 3 }));
 * ```
 */
export function svgPath({ d, position = { x: 0, y: 0 }, scale = { x: 1, y: 1 } }: {
  /** SVG d attribute, in model units; disconnected subpaths return separate curves. */
  d: string;
  /** Local XY translation, applied after scaling; defaults to zero. */
  position?: Point;
  /** Local XY scale, including negative values for mirroring; defaults to one. */
  scale?: Point;
}): PlanarCurve | PlanarCurve[] {
  if (typeof d !== 'string') throw new TypeError('SVG path d must be a string');
  if (!d.trim()) throw new RangeError('SVG path d must not be empty');
  validatePoint(position); validatePoint(scale);
  const { x: offsetX, y: offsetY } = position, { x: scaleX, y: scaleY } = scale;
  if (typeof document === 'undefined') throw new TypeError('svgPath requires browser SVG path geometry APIs');
  const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (typeof probe.getTotalLength !== 'function' || typeof probe.getPointAtLength !== 'function') {
    throw new TypeError('svgPath requires browser SVG path geometry APIs');
  }
  const groups: { d: string; start: Point; end: Point }[] = [];
  let current: Point = { x: 0, y: 0 };
  // Split only at moveto commands; the browser interprets all coordinates and commands.
  for (const data of d.trim().split(/(?=[Mm])/)) {
    probe.setAttribute('d', data);
    let start: Point = probe.getPointAtLength(0), nativeData = data;
    if (data[0] === 'm') {
      // Resolve the relative move with native coordinate precision, retaining mixed
      // absolute/relative commands afterward. An initial empty move adds no length.
      probe.setAttribute('d', `M ${current.x + start.x} ${current.y + start.y}`);
      start = probe.getPointAtLength(0);
      nativeData = `M ${current.x} ${current.y} ${data}`;
      probe.setAttribute('d', nativeData);
    }
    const length = probe.getTotalLength();
    if (!Number.isFinite(length)) throw new RangeError('SVG path length must be finite');
    const end: Point = length > 0 ? probe.getPointAtLength(length) : start;
    current = end;
    if (length === 0) continue;
    const previous = groups.at(-1);
    if (previous && previous.end.x === start.x && previous.end.y === start.y) {
      previous.d += ` ${nativeData}`;
      previous.end = end;
    } else groups.push({ d: nativeData, start, end });
  }
  if (!groups.length) throw new RangeError('SVG path must have positive finite length');
  const transform = (point: Point): Point => ({ x: offsetX + scaleX * point.x, y: offsetY + scaleY * point.y });
  const curves = groups.map(group => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', group.d);
    const length = path.getTotalLength(), start = transform(group.start), end = transform(group.end);
    return new PlanarCurve({
      // Native getPointAtLength(0) returns a leading moveto even when a later
      // relative moveto starts the actual geometry; use the resolved start.
      at: t => t === 0 ? start : transform(path.getPointAtLength(t * length)),
      start, end: start.x === end.x && start.y === end.y ? start : end,
    });
  });
  return curves.length === 1 ? curves[0] : curves;
}
