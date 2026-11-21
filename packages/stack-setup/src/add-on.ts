import type { StackJoiner } from "@mark1russell7/system-stack";
import { checkSetup } from "./check.ts";
import { joinSetup } from "./join.ts";
import { SETUP_SCHEMA, type SetupLayer } from "./layer.ts";
import { parseSetup } from "./schema.ts";

// The setup add-on in the form of the layer contract. A host gives it to `checkStackLayers` and to `joinStacks` of the core.
// This entry has the schema library, so the root entry does not import it.

/**
 * This function gives the setup add-on.
 *
 * - `schema` is `setup/1`, the key of the layer in `Stack.layers`.
 * - `parse` is `parseSetup`.
 * - `check` is the gate `checkSetup`.
 * - `join` is `joinSetup`. It joins the setup layers of the fragments of a stack.
 */
export function setupAddOn(): StackJoiner<SetupLayer> {
  return { schema: SETUP_SCHEMA, parse: parseSetup, check: checkSetup, join: joinSetup };
}
