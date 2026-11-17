import type { Result } from "@mark1russell7/vex";

// The read of the result of a program. This module is internal: no entry exports it.

/** This function gives the number of a result, or `undefined` for an error value. */
export function numberOf(result: Result<unknown>): number | undefined {
  return result.ok && typeof result.value === "number" ? result.value : undefined;
}

/** This function gives the boolean of a result, or `undefined` for an error value. */
export function booleanOf(result: Result<unknown>): boolean | undefined {
  return result.ok && typeof result.value === "boolean" ? result.value : undefined;
}
