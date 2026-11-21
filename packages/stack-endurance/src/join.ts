import { joinRecords, joinSetting, type LayerParse, type LayerPiece } from "@mark1russell7/system-stack";
import { ENDURANCE_SCHEMA, type EnduranceLayer } from "./layer.ts";

// The join of the endurance layers of the fragments of a stack, for example one file of stores for each owner.

/**
 * This function joins the endurance layers of the fragments of a stack into one layer.
 *
 * - The levels are one setting: each fragment that has levels gives the same list, else the join has a fault.
 * - The records of each list are in the order of the fragments.
 * - One key in two or more fragments is a fault, also when the records are equal. The key of a direct use is its resource and its need.
 *
 * The function is pure, and it changes no layer. The gate `checkEndurance` examines the joined layer afterward.
 *
 * @param pieces - The layers, with the name of the fragment of each one, in the order of the fragments.
 * @returns The joined layer, or the faults of the join.
 */
export function joinEndurance(pieces: readonly LayerPiece<EnduranceLayer>[]): LayerParse<EnduranceLayer> {
  const levels = joinSetting(pieces, (layer) => (layer.levels.length > 0 ? layer.levels.join("\n") : undefined), "levels");
  const resources = joinRecords(pieces, (layer) => layer.resources, (item) => item.code, "resource");
  const stores = joinRecords(pieces, (layer) => layer.stores, (item) => item.id, "store");
  const draws = joinRecords(pieces, (layer) => layer.draws, (item) => item.need, "draw");
  const direct = joinRecords(pieces, (layer) => layer.direct, (item) => `${item.resource}>${item.need}`, "direct use");
  const converters = joinRecords(pieces, (layer) => layer.converters, (item) => item.id, "converter");
  const cases = joinRecords(pieces, (layer) => layer.cases, (item) => item.case, "case");
  const priors = joinRecords(pieces, (layer) => layer.priors, (item) => `${item.case}@${item.place}`, "prior");
  const errors = [levels, resources, stores, draws, direct, converters, cases, priors].flatMap((join) => join.errors);
  if (errors.length > 0) return { ok: false, errors };
  const has = (key: "direct" | "converters" | "cases" | "priors"): boolean => pieces.some((piece) => piece.layer[key] !== undefined);
  return {
    ok: true,
    layer: {
      schema: ENDURANCE_SCHEMA,
      levels: levels.value === undefined ? [] : levels.value.split("\n"),
      resources: resources.items,
      stores: stores.items,
      draws: draws.items,
      ...(has("direct") ? { direct: direct.items } : {}),
      ...(has("converters") ? { converters: converters.items } : {}),
      ...(has("cases") ? { cases: cases.items } : {}),
      ...(has("priors") ? { priors: priors.items } : {}),
    },
  };
}
