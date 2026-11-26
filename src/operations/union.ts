import type { Solid } from '../Solid.js';
import { booleanSolid } from '../internal/booleanSolid.js';

/**
 * Unite the material of two solids without modifying either operand.
 * @param options.solid - First solid; only its own surfaces participate.
 * @param options.tool - Second solid; its child nodes do not participate.
 * @returns A new manifold solid with exact shared intersection rims. Disconnected
 * components are retained as one solid for subsequent modeling operations.
 * The first operand's children are retained by identity in a fresh child array.
 * @remarks Interior faces are removed and compatible exterior boundaries are sewn.
 * Source curves and surface equations remain mathematical; triangulation alone
 * produces facets. Point-only or edge-only contacts that create nonmanifold
 * geometry, and unresolved intersections, throw instead of returning an invalid solid.
 * @throws {@link TypeError} if either operand is not a Solid.
 * @throws {@link RangeError} for open/nonmanifold inputs or unresolved geometry.
 * @example
 * ```ts
 * const assembly = union({ solid: body, tool: extension });
 * scene.add(assembly);
 * ```
 */
export function union({ solid, tool }: {
  /** First solid; never mutated. */
  solid: Solid;
  /** Second solid; never mutated. */
  tool: Solid;
}): Solid { return booleanSolid(solid, tool, 'union'); }
