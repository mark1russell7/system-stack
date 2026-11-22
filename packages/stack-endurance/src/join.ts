import { canonicalJson } from "@mark1russell7/rigor-generators";
import { joinRecords, joinSetting, type LayerParse, type LayerPiece } from "@mark1russell7/system-stack";
import { ENDURANCE_SCHEMA, type EnduranceLayer, type Resource } from "./layer.ts";

// The join of the endurance layers of the fragments of a stack, for example one file of stores for each owner.

/**
 * This function joins the endurance layers of the fragments of a stack into one layer.
 *
 * - The levels are one setting: each fragment that has levels gives the same list, else the join has a fault.
 * - The records of each list are in the order of the fragments.
 * - Two resources with one code in two fragments join into one resource when their records are equal. A different field is a fault.
 * - One key of each other list in two or more fragments is a fault, also when the records are equal.
 * - The key of a direct use is its resource and its need.
 *
 * The function is pure, and it changes no layer. The gate `checkEndurance` examines the joined layer afterward.
 *
 * @param pieces - The layers, with the name of the fragment of each one, in the order of the fragments.
 * @returns The joined layer, or the faults of the join.
 */
export function joinEndurance(pieces: readonly LayerPiece<EnduranceLayer>[]): LayerParse<EnduranceLayer> {
  const levels = joinSetting(pieces, (layer) => (layer.levels.length > 0 ? layer.levels.join("\n") : undefined), "levels");
  const resources = joinResources(pieces);
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

/**
 * This function joins the resources of the fragments. Two fragments can declare one resource, for example `water.stored` in `L`.
 *
 * - The first record of a code in a later fragment joins the record of the first fragment, when the two records are equal.
 * - The comparison uses canonical JSON (RFC 8785). Thus the order of the keys has no effect.
 * - A record with a different field is a fault. The message names the two fragments and the two records.
 * - A code that one fragment has two times stays in the joined layer. The gate `checkEndurance` finds it.
 */
function joinResources(pieces: readonly LayerPiece<EnduranceLayer>[]): { readonly items: readonly Resource[]; readonly errors: readonly string[] } {
  const join = joinRecords(pieces, (layer) => layer.resources, (item) => item.code, "resource");
  if (join.twice.length === 0) return join;
  const twice = new Set(join.twice.map((item) => item.key));
  const first = new Map<string, { readonly from: string; readonly position: number; readonly form: string }>();
  const items: Resource[] = [];
  const errors: string[] = [];
  pieces.forEach((piece, position) => {
    // The codes of this fragment that joined a record of an earlier fragment.
    const joined = new Set<string>();
    for (const item of piece.layer.resources) {
      const owner = first.get(item.code);
      if (!twice.has(item.code) || owner === undefined || owner.position === position || joined.has(item.code)) {
        if (twice.has(item.code) && owner === undefined) first.set(item.code, { from: piece.from, position, form: canonicalJson(item) });
        items.push(item);
        continue;
      }
      joined.add(item.code);
      const form = canonicalJson(item);
      if (form !== owner.form) errors.push(`The fragment "${owner.from}" has the resource ${owner.form}, and the fragment "${piece.from}" has ${form}.`);
    }
  });
  return { items, errors };
}
