import type { Solid } from '../Solid.js';
import { booleanSolid } from '../internal/booleanSolid.js';

/**
 * Return the first solid with the second solid's volume removed.
 * @param options.solid - Solid to cut; never mutated. Only its own surfaces participate.
 * @param options.tool - Cutting solid; never mutated. Its child nodes do not participate.
 * @returns A new solid with reversed tool surfaces lining cuts/cavities. An
 * entirely removed solid has no surfaces. Retains the first operand's child
 * nodes by identity in a fresh child array, leaving input caches unchanged.
 * @remarks
 * Exact topology/evaluators are retained. Regular parametric surface intersections
 * are refined against both original equations. {@link SurfaceRegion} retains
 * arbitrary loops, holes and periodic charts, including reversed curved tool
 * walls. Tangent/branching and unresolved arrangements throw explicitly.
 * @throws {@link RangeError} for invalid/open inputs, unresolved intersections,
 * or a result that cannot be verified as a closed oriented solid.
 * @example
 * ```ts
 * const cut = difference({ solid: part, tool: cutter });
 * scene.add(cut);
 * ```
 */
export function difference({ solid, tool }: {
  /** Solid from which volume is removed; never mutated. */
  solid: Solid;
  /** Solid whose volume is removed; never mutated. */
  tool: Solid;
}): Solid { return booleanSolid(solid, tool, 'difference'); }
