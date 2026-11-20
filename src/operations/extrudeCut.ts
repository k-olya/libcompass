import type { ReadonlyVec3 } from 'gl-matrix';
import type { Sketch } from '../Sketch.js';
import type { Solid } from '../Solid.js';
import { extrude } from './extrude.js';
import { difference } from './difference.js';

/**
 * Extrude a sketch and subtract that new solid from the supplied solid.
 * @param options.solid - Solid to cut, retained without mutation.
 * @param options.sketch - Closed sketch profiles defining the cutting extrusion.
 * @param options.length - Finite, nonzero signed extrusion length; negative reverses travel.
 * @param options.axis - Finite, nonzero direction, normalized internally; defaults
 * to the sketch plane normal.
 * @param options.angle - Draft angle in degrees, default zero; strictly between -90 and 90.
 * @returns Exactly difference({ solid, tool: extrude({ sketch, length, axis, angle }) }).
 * This operation does not automatically extend the cut through the target.
 * @throws {@link RangeError} for extrusion errors or unsupported/invalid boolean cuts.
 * @example
 * ```ts
 * const cut = extrudeCut({ solid: part, sketch: holeSketch, length: 10 });
 * scene.add(cut);
 * ```
 */
export function extrudeCut({ solid, sketch, length, axis, angle: angleDEG }: {
  /** Solid to cut; never mutated. */
  solid: Solid;
  /** Closed cutting profiles on their placement plane. */
  sketch: Sketch;
  /** Signed extrusion length; negative reverses travel. */
  length: number;
  /** Direction normalized internally; defaults to the sketch plane normal. */
  axis?: ReadonlyVec3;
  /** Wall draft angle in degrees; defaults to zero. */
  angle?: number;
}): Solid { return difference({ solid, tool: extrude({ sketch, length, axis, angle: angleDEG }) }); }
