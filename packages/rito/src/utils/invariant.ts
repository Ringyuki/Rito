/**
 * Assert that a condition is true, throwing an error if not.
 * Used to enforce internal invariants that should never be violated.
 */
export function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}
