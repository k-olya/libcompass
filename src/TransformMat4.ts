import { mat4, type ReadonlyMat4 } from 'gl-matrix';
import { Memo } from './Memo.js';
import { transformMat4 } from './util/transformMat4.js';

/**
 * A memoized node applying a 4-by-4 matrix to combined child geometry.
 *
 * @remarks
 * Child arrays are preserved. Modify or replace the matrix and call refresh
 * to apply changes on the next triangulation; cached ancestors also need refresh.
 */
export class TransformMat4 extends Memo {
  /** Transformation matrix; refresh this node after changing it. */
  matrix: ReadonlyMat4;
  /**
   * Create a transform node with no children.
   *
   * @param options - gl-matrix column-major transformation matrix, retained by reference.
   */
  constructor({ matrix }: { matrix: ReadonlyMat4 }) {
    super();
    this.matrix = matrix;
  }

  /**
   * Transform the completed, uncached child triangulation before it is cached.
   *
   * @returns The combined child positions transformed in place in their fresh array.
   * Orientation-reversing matrices also reverse triangle winding to retain outward normals.
   * @throws {@link RangeError} if the combined positions do not form whole XYZ triplets.
   */
  protected override triangulateUncached(): Float32Array {
    const positions = transformMat4(super.triangulateUncached(), this.matrix);
    if (mat4.determinant(this.matrix) < 0) {
      for (let i = 0; i < positions.length; i += 9) for (let axis = 0; axis < 3; axis++) {
        [positions[i + 3 + axis], positions[i + 6 + axis]] = [positions[i + 6 + axis], positions[i + 3 + axis]];
      }
    }
    return positions;
  }
}

/**
 * Create a transform node with no children.
 *
 * Constructor shorthand for `new TransformMat4(options)`; returns a new {@link TransformMat4} instance.
 *
 * @param options - gl-matrix column-major transformation matrix, retained by reference.
 */
export function transformMat4Node(options: {
  /** Transformation matrix; refresh this node after changing it. */
  matrix: ReadonlyMat4;
}): TransformMat4 { return new TransformMat4(options); }
