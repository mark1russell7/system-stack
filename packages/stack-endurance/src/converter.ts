import type { Converter } from "./layer.ts";

// The internal rules of a converter that the endurance query and the joint days share. The root entry does not give them.

/** This function gives the amount of each resource that one run of a converter takes. Two lines of one resource add. */
export function inputsOf(converter: Converter): Map<string, number> {
  const out = new Map<string, number>();
  for (const input of converter.takes) if (input.amount > 0) out.set(input.resource, (out.get(input.resource) ?? 0) + input.amount);
  return out;
}

/** This function tells if a converter can run in a case. Its device works, it takes a resource, and it gives an amount more than 0. */
export function canRun(converter: Converter, stoppedParts: ReadonlySet<string>): boolean {
  return converter.gives.amount > 0 && inputsOf(converter).size > 0 && (converter.device === undefined || !stoppedParts.has(converter.device));
}

/**
 * This function gives the key of the device-days that a converter uses. The converters of one device share one key.
 * A converter with no device has a key of its own.
 */
export function deviceKey(converter: Converter): string {
  return converter.device === undefined ? `converter:${converter.id}` : `device:${converter.device}`;
}
