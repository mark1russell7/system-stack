import type { StackJoiner } from "@mark1russell7/system-stack";
import { checkPlacement } from "./check.ts";
import { joinPlacement } from "./join.ts";
import { PLACEMENT_SCHEMA, type PlacementLayer } from "./layer.ts";
import { parsePlacement } from "./schema.ts";

// The placement add-on in the form of the layer contract. A host gives it to `checkStackLayers` and to `joinStacks` of the core.
// This entry has the schema library, so the root entry does not import it.

/**
 * This function gives the placement add-on.
 *
 * - `schema` is `placement/1`, the key of the layer in `Stack.layers`.
 * - `parse` is `parsePlacement`.
 * - `check` is the gate `checkPlacement`.
 * - `join` is `joinPlacement`. It joins the placement layers of the fragments of a stack.
 */
export function placementAddOn(): StackJoiner<PlacementLayer> {
  return { schema: PLACEMENT_SCHEMA, parse: parsePlacement, check: checkPlacement, join: joinPlacement };
}
