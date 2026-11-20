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
 * Exact topology/evaluators are retained. Supports planar intersections and
 * existing single-rail curved-surface/plane trims, including supported circular
 * through holes and blind pockets. General curved-surface intersections, curved
 * coincidence and multi-chart cuts throw rather than returning a mesh-only solid.
 * @throws {@link RangeError} for invalid/open inputs, unsupported intersections,
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
