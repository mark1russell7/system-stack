import type { StackAddOn } from "@mark1russell7/system-stack";
import { checkTofu, type TofuOptions } from "./check.ts";
import { TOFU_SCHEMA, type TofuLayer } from "./layer.ts";
import { parseTofu } from "./schema.ts";

// The OpenTofu add-on in the form of the layer contract. A host gives it to `checkStackLayers` of the core.
// This entry has the schema library, so the root entry does not import it.

/**
 * This function gives the OpenTofu add-on for a check with the budgets of the accounts.
 *
 * - `schema` is `tofu/1`, the key of the layer in `Stack.layers`.
 * - `parse` is `parseTofu`.
 * - `check` is the gate `checkTofu` with the options.
 *
 * The add-on does not read the layer of a different add-on. A host reads the limits of the accounts, for example
 * from the states of a spend layer, and gives them as `budgets`.
 *
 * @param options - The options of the gate. With no budgets, an account with resources stops the gate.
 */
export function tofuAddOn(options: TofuOptions = {}): StackAddOn<TofuLayer> {
  return { schema: TOFU_SCHEMA, parse: parseTofu, check: (layer, stack) => checkTofu(layer, stack, options) };
}
