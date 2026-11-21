import { Memo } from './Memo.js';
import { colors, type AnnotationColor } from './defaults/colors.js';

let meshNumber = 0;

/**
 * A memoized scene group with a display name, color, and opacity.
 *
 * @remarks
 * Annotations do not change geometry or STL coordinates. The app renders this
 * group's geometry as a separate mesh; nested AnnotatedNodes get their own meshes
 * and annotations. Geometry remains cached until refresh(), just as with Memo.
 * Editing annotations alone does not require refreshing geometry caches.
 */
export class AnnotatedNode extends Memo {
  /** Display name; omitted names become mesh1, mesh2, ... using a hidden counter. */
  name: string;
  private colorValue: `#${string}` = colors.default;
  /** Resolved hex RGB color; accepts palette names or #RGB/#RRGGBB when assigned. */
  get color(): `#${string}` { return this.colorValue; }
  /** Select a theme color or a custom hex RGB color; other CSS formats and numbers throw. */
  set color(color: AnnotationColor) {
    if (typeof color !== 'string') throw new TypeError('Annotation color must be a palette name or #RGB/#RRGGBB string');
    if (Object.hasOwn(colors, color)) this.colorValue = colors[color as keyof typeof colors];
    else if (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color)) this.colorValue = color as `#${string}`;
    else throw new RangeError('Annotation color must be a palette name or #RGB/#RRGGBB string');
  }
  /** Opacity from 0 (invisible) to 1 (opaque); defaults to 1. */
  alpha: number;

  /**
   * Create a memoized annotated group with no children.
   * @param options - Optional display name, color, and opacity.
   * @throws {@link TypeError} if name or color has an invalid type.
   * @throws {@link RangeError} if alpha is outside [0, 1] or color is not a palette name or hex RGB string.
   */
  constructor({ name, color = 'default', alpha = 1 }: {
    name?: string;
    color?: AnnotationColor;
    alpha?: number;
  } = {}) {
    super();
    if (name !== undefined && typeof name !== 'string') throw new TypeError('Annotation name must be a string');
    if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RangeError('Annotation alpha must be between 0 and 1');
    this.color = color;
    this.alpha = alpha;
    this.name = name ?? `mesh${++meshNumber}`;
  }
}

/**
 * Create a memoized annotated group with no children.
 *
 * Constructor shorthand for `new AnnotatedNode(options)`; returns a new {@link AnnotatedNode} instance.
 *
 * @param options - Optional display name, color, and opacity.
 * @throws {@link TypeError} if name or color has an invalid type.
 * @throws {@link RangeError} if alpha is outside [0, 1] or color is not a palette name or hex RGB string.
 */
export function annotatedNode(options: {
  /** Display name; omitted names use the hidden mesh1, mesh2, ... counter. */
  name?: string;
  /** Palette name or #RGB/#RRGGBB string; defaults to 'default'. */
  color?: AnnotationColor;
  /** Opacity in [0, 1]; defaults to 1. */
  alpha?: number;
} = {}): AnnotatedNode { return new AnnotatedNode(options); }
