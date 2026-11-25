import { AnnotatedNode, Node } from '../Node.js';
import type { AnnotationColor } from '../defaults/colors.js';

/**
 * Wrap any node in a new named, colored, memoized scene group.
 * Accepts a node directly for default annotations, or an options object for display settings.
 *
 * @param options.node - Existing node to retain as a child, without changing it.
 * @param options.name - Preview mesh name; omitted names become mesh1, mesh2, ... via a hidden counter.
 * @param options.color - Palette name or #RGB/#RRGGBB string; defaults to 'default'.
 * @param options.alpha - Opacity from 0 (invisible) to 1 (opaque); defaults to 1.
 * @returns A new AnnotatedNode containing the original node. Annotations do not
 * change geometry; nested annotations control their own preview meshes.
 * @throws {@link TypeError} if the target is not a Node or annotations have invalid types.
 * @throws {@link RangeError} if color or alpha is invalid.
 * @example
 * ```ts
 * scene.add(annotate({ node: parts, name: 'Housing', color: '#5599dd', alpha: 0.6 }));
 * ```
 */
export function annotate(options: Node | {
  /** Node to wrap; the original node is not modified. */
  node: Node;
  /** Preview mesh name; omitted names use the hidden mesh1, mesh2, ... counter. */
  name?: string;
  /** Palette name or #RGB/#RRGGBB string; defaults to 'default'. */
  color?: AnnotationColor;
  /** Opacity in [0, 1]; defaults to 1. */
  alpha?: number;
}): AnnotatedNode {
  if (!options || typeof options !== 'object') throw new TypeError('Annotate requires a Node');
  const settings = options instanceof Node ? { node: options } : options;
  const target = settings.node;
  if (!(target instanceof Node)) throw new TypeError('Annotate requires a Node');
  const { name, color, alpha } = settings;
  return new AnnotatedNode({ name, color, alpha }).add(target);
}
