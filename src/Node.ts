import { annotate } from './operations/annotate.js';
import { colors, type AnnotationColor } from './defaults/colors.js';

// Keep base classes together to avoid an inheritance cycle through Node.annotate().

/**
 * Base class for scene graph nodes.
 *
 * @remarks
 * Solids and transform nodes extend Memo and implement its uncached
 * triangulation hook to retain memoization. Sketches, planes, and boundary
 * topology objects are independent math objects.
 */
export class Node {
  /** Mutable child nodes, visited in insertion order during triangulation. */
  children: Node[] = [];

  /**
   * Wrap this node in a new memoized group with preview annotations.
   * @param options.name - Preview mesh name; omitted names use a hidden mesh1, mesh2, ... counter.
   * @param options.color - Palette name or #RGB/#RRGGBB string; defaults to 'default'.
   * @param options.alpha - Opacity in [0, 1]; defaults to 1.
   * @returns An AnnotatedNode retaining this node unchanged as its child.
   * @see {@link annotate}
   */
  annotate(options: {
    /** Preview mesh name; omitted names use the hidden mesh1, mesh2, ... counter. */
    name?: string;
    /** Palette name or #RGB/#RRGGBB string; defaults to 'default'. */
    color?: AnnotationColor;
    /** Opacity in [0, 1]; defaults to 1. */
    alpha?: number;
  } = {}): AnnotatedNode { return annotate({ ...options, node: this }); }

  /**
   * Append child nodes in the supplied order.
   *
   * @remarks
   * Repeated references are allowed. Changes do not invalidate caches;
   * explicitly refresh affected memoized nodes and their cached ancestors.
   *
   * @param children - Child nodes or arrays of child nodes to append; arrays are flattened one level.
   * Readonly arrays and mixtures of individual nodes and arrays are accepted.
   * @returns This node for chaining.
   */
  add(...children: (Node | readonly Node[])[]): this {
    for (const child of children.flat()) this.children.push(child);
    return this;
  }

  /**
   * Remove child nodes by object identity, preserving the remaining order.
   *
   * @remarks
   * Every occurrence of the supplied nodes is removed; absent nodes are ignored.
   * Changes do not invalidate caches; explicitly refresh affected memoized
   * nodes and their cached ancestors.
   *
   * @param children - Child objects to remove, rather than their array positions.
   * @returns This node for chaining.
   */
  remove(...children: Node[]): this {
    this.children = this.children.filter(child => !children.includes(child));
    return this;
  }

  /**
   * Concatenate child triangulations, calling each direct child once.
   *
   * @returns A fresh array of XYZ triangle positions in hierarchy order;
   * a node with no children returns an empty array. Child arrays are not mutated.
   */
  triangulate(): Float32Array {
    const meshes = this.children.map((child) => child.triangulate());
    const length = meshes.reduce((total, mesh) => total + mesh.length, 0);
    const positions = new Float32Array(length);

    let offset = 0;
    for (const mesh of meshes) {
      positions.set(mesh, offset);
      offset += mesh.length;
    }

    return positions;
  }
}

/**
 * Base class for scene graph nodes.
 *
 * Constructor shorthand for `new Node()`; returns a new {@link Node} instance.
 *
 * @remarks
 * Solids and transform nodes extend Memo and implement its uncached
 * triangulation hook to retain memoization. Sketches, planes, and boundary
 * topology objects are independent math objects.
 */
export function node(): Node { return new Node(); }

/**
 * A node that caches triangulation until explicitly refreshed.
 *
 * @remarks
 * Geometry-producing node subclasses override the protected
 * {@link Memo.triangulateUncached} hook instead of the public triangulate method.
 * Changes to children or geometry do not automatically invalidate the cache.
 */
export class Memo extends Node {
  private cache?: Float32Array;

  /**
   * Compute triangulation on the first call after construction or refresh.
   *
   * @returns The same cached array on subsequent calls, including empty arrays.
   * Treat the returned array as read-only. Failed computations are not cached.
   */
  override triangulate(): Float32Array {
    return this.cache ??= this.triangulateUncached();
  }

  /**
   * Invalidate this node's cache without computing geometry immediately.
   *
   * @remarks
   * Ancestors and descendants are not refreshed. After geometry changes,
   * explicitly refresh each affected memoized node, including cached ancestors.
   */
  refresh(): void {
    this.cache = undefined;
  }

  /**
   * Compute geometry on a cache miss; override this hook in geometry-producing nodes.
   *
   * @returns A fresh concatenation of child triangulations by default. A subclass
   * supplies XYZ triangle positions that the public triangulate method will cache.
   */
  protected triangulateUncached(): Float32Array {
    return super.triangulate();
  }
}

/**
 * A node that caches triangulation until explicitly refreshed.
 *
 * Constructor shorthand for `new Memo()`; returns a new {@link Memo} instance.
 *
 * @remarks
 * Geometry-producing node subclasses override the protected
 * {@link Memo.triangulateUncached} hook instead of the public triangulate method.
 * Changes to children or geometry do not automatically invalidate the cache.
 */
export function memo(): Memo { return new Memo(); }

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
