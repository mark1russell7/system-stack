import { joinRecords, joinSetting, type LayerParse, type LayerPiece } from "@mark1russell7/system-stack";
import { PLACEMENT_SCHEMA, type PlacementLayer, type PlacementLimits } from "./layer.ts";

// The join of the placement layers of the fragments of a stack, for example one file of slots for each owner.

/**
 * This function joins the placement layers of the fragments of a stack into one layer.
 *
 * - The layer has one part and one currency. A fragment with a different value is a fault.
 * - Each limit has one value. A fragment with no value takes the value of the others.
 * - The slots and the shared fragments are in the order of the fragments. A slot or a shared fragment of two or more fragments is a fault.
 *
 * The function is pure, and it changes no layer. The gate `checkPlacement` examines the joined layer afterward.
 *
 * @param pieces - The layers, with the name of the fragment of each one, in the order of the fragments.
 * @returns The joined layer, or the faults of the join. An empty list of layers is a fault.
 */
export function joinPlacement(pieces: readonly LayerPiece<PlacementLayer>[]): LayerParse<PlacementLayer> {
  const part = joinSetting(pieces, (layer) => layer.part, "part of the placement");
  const currency = joinSetting(pieces, (layer) => layer.currency, "currency");
  const cost = joinSetting(pieces, (layer) => layer.limits?.cost, "limit of the expected cost");
  const bound = joinSetting(pieces, (layer) => layer.limits?.bound, "limit of the cost from the spend layer");
  const chance = joinSetting(pieces, (layer) => layer.limits?.chance, "limit of the chance");
  const slots = joinRecords(
    pieces,
    (layer) => layer.slots,
    (slot) => slot.id,
    "slot",
  );
  const shared = joinRecords(
    pieces,
    (layer) => layer.shared,
    (item) => item.id,
    "shared fragment",
  );
  if (part.value === undefined || currency.value === undefined) return { ok: false, errors: ["The join of placement layers got no layer."] };
  const errors = [...part.errors, ...currency.errors, ...cost.errors, ...bound.errors, ...chance.errors, ...slots.errors, ...shared.errors];
  if (errors.length > 0) return { ok: false, errors };
  const limits: PlacementLimits = {
    ...(cost.value === undefined ? {} : { cost: cost.value }),
    ...(bound.value === undefined ? {} : { bound: bound.value }),
    ...(chance.value === undefined ? {} : { chance: chance.value }),
  };
  return {
    ok: true,
    layer: {
      schema: PLACEMENT_SCHEMA,
      part: part.value,
      currency: currency.value,
      slots: slots.items,
      ...(pieces.some((piece) => piece.layer.shared !== undefined) ? { shared: shared.items } : {}),
      ...(pieces.some((piece) => piece.layer.limits !== undefined) ? { limits } : {}),
    },
  };
}
