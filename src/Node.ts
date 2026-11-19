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
   * Append child nodes in the supplied order.
   *
   * @remarks
   * Repeated references are allowed. Changes do not invalidate caches;
   * explicitly refresh affected memoized nodes and their cached ancestors.
   *
   * @param children - Child nodes to append.
   * @returns This node for chaining.
   */
  add(...children: Node[]): this {
    this.children.push(...children);
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
