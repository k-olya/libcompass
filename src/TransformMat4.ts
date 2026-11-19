import type { ReadonlyMat4 } from 'gl-matrix';
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
  /**
   * Create a transform node with no children.
   *
   * @param matrix - gl-matrix column-major transformation, retained by reference.
   */
  constructor(
    /** Transformation matrix; refresh this node after changing it. */
    public matrix: ReadonlyMat4
  ) {
    super();
  }

  /**
   * Transform the completed, uncached child triangulation before it is cached.
   *
   * @returns The combined child positions transformed in place in their fresh array.
   * @throws {@link RangeError} if the combined positions do not form whole XYZ triplets.
   */
  protected override triangulateUncached(): Float32Array {
    return transformMat4(super.triangulateUncached(), this.matrix);
  }
}
