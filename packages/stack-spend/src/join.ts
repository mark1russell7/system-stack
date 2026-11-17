import { joinRecords, joinSetting, type LayerParse, type LayerPiece } from "@mark1russell7/system-stack";
import { SPEND_SCHEMA, type SpendLayer } from "./layer.ts";

// The join of the spend layers of the fragments of a stack, for example one file of cost records for each owner.

/**
 * This function joins the spend layers of the fragments of a stack into one layer.
 *
 * - The cost records are in the order of the fragments. The record of a part is in one fragment.
 * - A part with a record in two or more fragments is a fault, also when the records are equal.
 * - The layer has one currency and one largest age of a proof. A fragment with a different value is a fault.
 * - The kinds are the kinds of each fragment, one time each, in the order of the fragments.
 *
 * The kinds of the joined layer hold for each part of the joined stack. Thus a kind of one fragment needs a cost
 * record also for the parts of that kind in the other fragments. The function is pure, and it changes no layer.
 * The gate `checkSpend` examines the joined layer afterward.
 *
 * @param pieces - The layers, with the name of the fragment of each one, in the order of the fragments.
 * @returns The joined layer, or the faults of the join. An empty list of layers is a fault.
 */
export function joinSpend(pieces: readonly LayerPiece<SpendLayer>[]): LayerParse<SpendLayer> {
  const currency = joinSetting(pieces, (layer) => layer.currency, "currency");
  const proofDays = joinSetting(pieces, (layer) => layer.proofDays, "largest age of a proof in days");
  const services = joinRecords(
    pieces,
    (layer) => layer.services,
    (service) => service.part,
    "cost record of the part",
  );
  if (currency.value === undefined || proofDays.value === undefined) return { ok: false, errors: ["The join of spend layers got no layer."] };
  const errors = [...currency.errors, ...proofDays.errors, ...services.errors];
  if (errors.length > 0) return { ok: false, errors };
  const kinds = [...new Set(pieces.flatMap((piece) => piece.layer.kinds))];
  return { ok: true, layer: { schema: SPEND_SCHEMA, currency: currency.value, kinds, proofDays: proofDays.value, services: services.items } };
}
