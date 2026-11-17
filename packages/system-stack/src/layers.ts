import { checkLayers, type AddOn, type LayerFinding } from "@mark1russell7/coeval/layers";
import { checkStack } from "./check.ts";
import { STACK_SCHEMA, type Stack } from "./stack.ts";

// The layers of a stack, through the layer contract of `@mark1russell7/coeval/layers`.
// The core knows only the type `AddOn`. A host gives the list of the add-ons, and the add-ons do not know each other.

export { isLayerName, readLayer, type AddOn, type LayerFault, type LayerFinding, type LayerParse } from "@mark1russell7/coeval/layers";

/**
 * An add-on of a stack: one topic on the core, for example the cost or the risk of each part.
 * Its function `check` gets the stack. Each add-on package gives its add-on in its entry `/add-on`.
 */
export type StackAddOn<Layer> = AddOn<Layer, Stack>;

/**
 * This function gives the findings of a whole stack document: the faults of the core, then the findings of each layer.
 *
 * - A fault of `checkStack` has the layer `stack/1`, the name of the format of the core.
 * - When the core has an error, the function gives only the faults of the core. An add-on reads only a stack with no error.
 * - A layer with a wrong name gets the error `layer-name`.
 * - A layer of no add-on of the list gets the warning `layer-unknown`. The stack keeps the layer.
 * - A layer that its add-on cannot read gets one error `layer-form` for each fault of its form.
 * - Each other layer gets the faults of its meaning from its add-on.
 *
 * The findings of the layers are in the order of the layer names. Thus the order of the add-ons does not change them.
 * The function is pure. An empty list tells that the document has no fault.
 *
 * @param stack - The stack document.
 * @param addOns - The add-ons of the check. The first add-on of a name reads the layer.
 */
export function checkStackLayers(stack: Stack, addOns: readonly StackAddOn<unknown>[]): LayerFinding[] {
  const core: LayerFinding[] = checkStack(stack).map((fault) => ({ ...fault, layer: STACK_SCHEMA }));
  if (core.some((fault) => fault.level === "error")) return core;
  return [...core, ...checkLayers(stack, addOns, stack)];
}
