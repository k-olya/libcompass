/**
 * Turn a method name into an object-first function.
 *
 * @remarks
 * The returned function calls `object[name](...args)`, preserving the receiver's
 * `this`, subclass overrides, and inferred argument and return types. Method
 * lookup occurs on every call; no method implementation is captured or bound.
 *
 * @typeParam K - Property key of the method to invoke.
 * @param name - Method name, numeric key, or symbol to look up on each receiver.
 * @returns A function accepting a receiver with that method, followed by its
 * arguments, and returning the method's result. Method errors propagate unchanged.
 *
 * @example
 * ```ts
 * const triangulate = functionalize('triangulate');
 * const positions = triangulate(solid);
 * ```
 */
export function functionalize<K extends PropertyKey>(name: K) {
  return <Args extends unknown[], Result>(
    object: Record<K, (...args: Args) => Result>,
    ...args: Args
  ): Result => object[name](...args);
}
