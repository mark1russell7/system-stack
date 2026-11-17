import { dayNumber, type StackAddOn } from "@mark1russell7/system-stack";
import { checkRisk, type RiskOptions } from "./check.ts";
import { RISK_SCHEMA, type RiskLayer } from "./layer.ts";
import { parseRisk } from "./schema.ts";

// The risk add-on in the form of the layer contract. A host gives it to `checkStackLayers` of the core.
// This entry has the schema library, so the root entry does not import it.

/**
 * This function gives the risk add-on for a check on one date.
 *
 * - `schema` is `risk/1`, the key of the layer in `Stack.layers`.
 * - `parse` is `parseRisk`.
 * - `check` is the gate `checkRisk` with the options. It throws a RangeError when `maxSets` or `maxSteps` is not valid.
 *
 * @param options - The options of the gate. The gate has no clock: the caller gives the date.
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function riskAddOn(options: RiskOptions): StackAddOn<RiskLayer> {
  if (dayNumber(options.today) === undefined) throw new RangeError(`The date "${options.today}" is not a date of the form YYYY-MM-DD.`);
  return { schema: RISK_SCHEMA, parse: parseRisk, check: (layer, stack) => checkRisk(layer, stack, options) };
}
