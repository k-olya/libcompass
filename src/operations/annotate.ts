import { AnnotatedNode } from '../AnnotatedNode.js';
import { Solid } from '../Solid.js';
import type { AnnotationColor } from '../defaults/colors.js';

/**
 * Wrap a solid in a new named, colored, memoized scene group.
 * Accepts a solid directly for default annotations, or an options object for display settings.
 *
 * @param options.solid - Existing solid to retain as a child, without changing it.
 * @param options.name - Preview mesh name; omitted names become mesh1, mesh2, ... via a hidden counter.
 * @param options.color - Palette name or #RGB/#RRGGBB string; defaults to 'default'.
 * @param options.alpha - Opacity from 0 (invisible) to 1 (opaque); defaults to 1.
 * @returns A new AnnotatedNode containing the original solid. Annotations do not
 * change geometry; nested annotations control their own preview meshes.
 * @throws {@link TypeError} if solid is not a Solid or annotations have invalid types.
 * @throws {@link RangeError} if color or alpha is invalid.
 * @example
 * ```ts
 * scene.add(annotate({ solid: part, name: 'Housing', color: '#5599dd', alpha: 0.6 }));
 * ```
 */
export function annotate(options: Solid | {
  /** Solid to wrap; the original solid is not modified. */
  solid: Solid;
  /** Preview mesh name; omitted names use the hidden mesh1, mesh2, ... counter. */
  name?: string;
  /** Palette name or #RGB/#RRGGBB string; defaults to 'default'. */
  color?: AnnotationColor;
  /** Opacity in [0, 1]; defaults to 1. */
  alpha?: number;
}): AnnotatedNode {
  const { solid, name, color, alpha } = options instanceof Solid ? { solid: options } : options;
  if (!(solid instanceof Solid)) throw new TypeError('Annotate requires a Solid');
  return new AnnotatedNode({ name, color, alpha }).add(solid);
}
