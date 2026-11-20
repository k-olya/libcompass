import type { Solid } from '../Solid.js';
import { booleanSolid } from '../internal/booleanSolid.js';

/**
 * Return the volume shared by two solids, without modifying either input.
 * @param options.solid - First operand. Only its own surfaces participate.
 * @param options.tool - Second operand. Its child nodes do not participate.
 * @returns A new solid; an empty intersection has no surfaces. Original solid's
 * child nodes are retained by identity in a fresh child array.
 * @remarks
 * Retains exact faces, curves and surface evaluators; meshes are temporary
 * intersection/classification checks. Supports planar intersections and the
 * existing single-rail curved-surface/plane trims. General curved-surface
 * intersections and trims requiring several charts throw explicitly.
 * @throws {@link RangeError} for open, nonmanifold or invalid input, unsupported
 * intersections, or a result that cannot be verified as a closed oriented solid.
 * @example
 * ```ts
 * const common = intersect({ solid: part, tool: cutter });
 * scene.add(common);
 * ```
 */
export function intersect({ solid, tool }: {
  /** First solid; never mutated. */
  solid: Solid;
  /** Second solid; never mutated. */
  tool: Solid;
}): Solid { return booleanSolid(solid, tool, 'intersect'); }
