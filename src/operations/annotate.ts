import { AnnotatedNode, Node } from '../Node.js';
import type { AnnotationColor } from '../defaults/colors.js';
import type { AnnotationGeometry } from '../AnnotationGeometry.js';

/**
 * Annotate a node or line-preview geometry in a new named, colored, memoized scene group.
 * Accepts a node directly for default annotations, or an options object for display settings.
 *
 * @param options.node - Existing node to retain as a child, without changing it.
 * @param options.geometry - Plane, sketch, planar geometry, spatial line/curve, or nested arrays to display as lines.
 * @param options.name - Preview mesh name; omitted names become mesh1, mesh2, ... via a hidden counter.
 * @param options.color - Palette name or #RGB/#RRGGBB string; defaults to 'default'.
 * @param options.alpha - Opacity from 0 (invisible) to 1 (opaque); defaults to 1.
 * @param options.exclude - Exclude this whole subtree from the app's overall export; defaults to false.
 * @returns A new AnnotatedNode retaining the original node and/or line-preview geometry.
 * Nested annotations control their own previews; line geometry never adds triangles.
 * @throws {@link TypeError} if neither node nor geometry is provided, node is not a Node, or annotations have invalid types.
 * @throws {@link RangeError} if color or alpha is invalid.
 * @example
 * ```ts
 * scene.add(annotate({ node: parts, name: 'Housing', color: '#5599dd', alpha: 0.6 }));
 * ```
 */
export function annotate(options: Node | {
  /** Node to wrap; the original node is not modified. */
  node?: Node;
  /** Optional geometry to display as lines, without contributing triangles. */
  geometry?: AnnotationGeometry;
  /** Preview mesh name; omitted names use the hidden mesh1, mesh2, ... counter. */
  name?: string;
  /** Palette name or #RGB/#RRGGBB string; defaults to 'default'. */
  color?: AnnotationColor;
  /** Opacity in [0, 1]; defaults to 1. */
  alpha?: number;
  /** Exclude this subtree from the app's overall export; defaults to false. */
  exclude?: boolean;
}): AnnotatedNode {
  if (!options || typeof options !== 'object') throw new TypeError('Annotate requires a Node or geometry');
  const settings = options instanceof Node ? { node: options } : options;
  const target = settings.node;
  if ((target !== undefined && !(target instanceof Node)) || (target === undefined && settings.geometry === undefined)) {
    throw new TypeError('Annotate requires a Node or geometry');
  }
  const { name, color, alpha, exclude, geometry } = settings;
  const annotation = new AnnotatedNode({ name, color, alpha, exclude, geometry });
  return target ? annotation.add(target) : annotation;
}
