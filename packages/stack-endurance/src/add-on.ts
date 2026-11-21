import type { StackJoiner } from "@mark1russell7/system-stack";
import { checkEndurance } from "./check.ts";
import { joinEndurance } from "./join.ts";
import { ENDURANCE_SCHEMA, type EnduranceLayer } from "./layer.ts";
import { parseEndurance } from "./schema.ts";

// The endurance add-on in the form of the layer contract. A host gives it to `checkStackLayers` and to `joinStacks` of the core.
// This entry has the schema library, so the root entry does not import it.

/**
 * This function gives the endurance add-on.
 *
 * - `schema` is `endurance/1`, the key of the layer in `Stack.layers`.
 * - `parse` is `parseEndurance`.
 * - `check` is the gate `checkEndurance`.
 * - `join` is `joinEndurance`. It joins the endurance layers of the fragments of a stack.
 */
export function enduranceAddOn(): StackJoiner<EnduranceLayer> {
  return { schema: ENDURANCE_SCHEMA, parse: parseEndurance, check: checkEndurance, join: joinEndurance };
}
