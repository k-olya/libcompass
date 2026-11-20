import { mat4 } from 'gl-matrix';
import { TransformMat4 } from './TransformMat4.js';
import { degtorad } from './util/angles.js';

/**
 * A memoized transform node controlled by XYZ position, Euler rotation, and scale.
 *
 * @remarks
 * Each uncached triangulation rebuilds the inherited matrix as
 * `T * Rx * Ry * Rz * S`, then transforms combined child geometry. Rotation
 * uses degrees and fixed intrinsic XYZ Euler order. Call refresh after editing
 * properties; direct edits to the derived matrix are replaced on recomputation.
 *
 * @example
 * ```ts
 * const transform = new Transform();
 * transform.position.x = 10;
 * transform.rotation.z = 90;
 * transform.scale = { x: 2, y: 2, z: 1 };
 * transform.add(child);
 * const positions = transform.triangulate();
 * ```
 */
export class Transform extends TransformMat4 {
  /** Local XYZ translation in model units, initially zero on every axis. */
  position = { x: 0, y: 0, z: 0 };
  /** Intrinsic XYZ Euler angles in degrees, initially zero on every axis. */
  rotation = { x: 0, y: 0, z: 0 };
  /** Local XYZ scale factors, initially one on every axis; zero and negatives are allowed. */
  scale = { x: 1, y: 1, z: 1 };

  /** Create an identity transform with independent XYZ property objects and no children. */
  constructor() {
    super({ matrix: mat4.create() });
  }

  /**
   * Compose the current properties into a matrix and transform the child geometry.
   *
   * @returns Fresh combined child positions after scaling, rotation, and translation.
   * @throws {@link RangeError} if the combined positions do not form whole XYZ triplets.
   */
  protected override triangulateUncached(): Float32Array {
    const { position, rotation: rotationDEG, scale } = this;
    const matrix = mat4.fromTranslation(mat4.create(), [position.x, position.y, position.z]);
    mat4.rotateX(matrix, matrix, degtorad(rotationDEG.x));
    mat4.rotateY(matrix, matrix, degtorad(rotationDEG.y));
    mat4.rotateZ(matrix, matrix, degtorad(rotationDEG.z));
    mat4.scale(matrix, matrix, [scale.x, scale.y, scale.z]);
    this.matrix = matrix;
    return super.triangulateUncached();
  }
}

/**
 * Create an identity transform with independent XYZ property objects and no children.
 *
 * Constructor shorthand for `new Transform()`; returns a new {@link Transform} instance.
 */
export function transform(): Transform { return new Transform(); }
