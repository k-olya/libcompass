import { Node } from './Node.js';

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
