import { dayNumber, type StackAddOn } from "@mark1russell7/system-stack";
import { checkSpend, type SpendOptions } from "./check.ts";
import { SPEND_SCHEMA, type SpendLayer } from "./layer.ts";
import { parseSpend } from "./schema.ts";

// The spend add-on in the form of the layer contract. A host gives it to `checkStackLayers` of the core.
// This entry has the schema library, so the root entry does not import it.

/**
 * This function gives the spend add-on for a check on one date.
 *
 * - `schema` is `spend/1`, the key of the layer in `Stack.layers`.
 * - `parse` is `parseSpend`.
 * - `check` is the gate `checkSpend` with the options.
 *
 * @param options - The options of the gate. The gate has no clock: the caller gives the date.
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function spendAddOn(options: SpendOptions): StackAddOn<SpendLayer> {
  if (dayNumber(options.today) === undefined) throw new RangeError(`The date "${options.today}" is not a date of the form YYYY-MM-DD.`);
  return { schema: SPEND_SCHEMA, parse: parseSpend, check: (layer, stack) => checkSpend(layer, stack, options) };
}
