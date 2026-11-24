import { joinLayers, joinRecords, type LayerFinding, type LayerJoiner, type LayerPiece } from "@mark1russell7/coeval/layers";
import type { StackAddOn } from "./layers.ts";
import { STACK_SCHEMA, type Stack } from "./stack.ts";

// The join of the stack documents of some owners into one stack.
// The core joins its own records, the parts. Each add-on joins its own layer, through the layer contract.

export { joinRecords, joinSetting, type LayerJoiner, type LayerPiece, type RecordsJoin, type RecordsJoinOptions, type RecordTwice, type SettingJoin } from "@mark1russell7/coeval/layers";

/** A fragment of a stack: the stack document of one file or of one owner. */
export interface StackFragment {
  /** The name of the fragment, for example the path of its file. A finding names its fragments with it. */
  readonly name: string;
  /** The stack document of the fragment. A fragment can name a part of a different fragment. */
  readonly stack: Stack;
}

/**
 * An add-on of a stack that can also join its layer. Each add-on package gives one in its entry `/add-on`.
 * Thus a host gives one list to `joinStacks` and to `checkStackLayers`.
 */
export type StackJoiner<Layer> = StackAddOn<Layer> & LayerJoiner<Layer>;

/**
 * These are the codes of the core in a join. The codes of the layers are `JOIN_CODES` of the layer contract.
 *
 * - `fragment-name`: two fragments have one name.
 * - `part-twice`: two or more fragments have a part with one `id`, also when the parts are equal.
 */
export const STACK_JOIN_CODES: readonly ["fragment-name", "part-twice"] = ["fragment-name", "part-twice"];

/** A code of `STACK_JOIN_CODES`. */
export type StackJoinCode = (typeof STACK_JOIN_CODES)[number];

/** A finding of `joinStacks`: a record or a layer that the fragments cannot become one stack. Each one is an error. */
export interface StackJoinFinding extends LayerFinding {
  /** The names of the fragments of the finding, in the order of the fragments. */
  readonly from: readonly string[];
}

/** The result of `joinStacks`: the one stack, or the findings. A join with a finding gives no stack. */
export type StackJoin = { readonly ok: true; readonly stack: Stack } | { readonly ok: false; readonly findings: readonly StackJoinFinding[] };

/**
 * This function joins the stack documents of some owners into one stack.
 *
 * - The parts of the stack are the parts of each fragment, in the order of the fragments. Each part has one fragment.
 * - A part `id` that two or more fragments have is the error `part-twice`, also when the parts are equal.
 * - A name that two fragments have is the error `fragment-name`.
 * - A layer of one fragment stays as it is. A layer of two or more fragments goes to `join` of its add-on.
 * - Such a layer with no add-on in the list is the error `layer-twice`. No file removes the records of a different owner.
 *
 * The join does not examine the meaning of the stack. Thus a fragment can need a part of a different fragment, and
 * `checkStackLayers` examines the joined stack afterward. A finding of the core has the layer `stack/1`.
 * The findings are in this order: the names of the fragments, the parts, then the layers in the order of their names.
 * The function is pure, and it does not change a fragment.
 *
 * @param fragments - The fragments, in the order of the parts of the joined stack.
 * @param joiners - The add-ons that can join their layer. The first add-on of a name joins the layer.
 * @returns The joined stack, or the findings. The stack has the field `layers` when a fragment has it.
 */
export function joinStacks(fragments: readonly StackFragment[], joiners: readonly LayerJoiner<unknown>[]): StackJoin {
  const findings: StackJoinFinding[] = [];
  const names = new Map<string, number>();
  for (const fragment of fragments) names.set(fragment.name, (names.get(fragment.name) ?? 0) + 1);
  for (const [name, count] of names) {
    if (count > 1) findings.push({ level: "error", code: "fragment-name", layer: STACK_SCHEMA, at: name, from: [name], message: `${String(count)} fragments have the name "${name}".` });
  }
  const pieces: LayerPiece<Stack>[] = fragments.map((fragment) => ({ from: fragment.name, layer: fragment.stack }));
  const parts = joinRecords(
    pieces,
    (stack) => stack.parts,
    (part) => part.id,
    "part",
  );
  for (const twice of parts.twice) findings.push({ level: "error", code: "part-twice", layer: STACK_SCHEMA, at: twice.key, from: twice.from, message: twice.message });
  const layers = joinLayers(
    fragments.map((fragment) => ({ name: fragment.name, doc: fragment.stack })),
    joiners,
  );
  if (!layers.ok) findings.push(...layers.findings);
  if (!layers.ok || findings.length > 0) return { ok: false, findings };
  const layered = fragments.some((fragment) => fragment.stack.layers !== undefined);
  return { ok: true, stack: { schema: STACK_SCHEMA, parts: [...parts.items], ...(layered ? { layers: layers.layers } : {}) } };
}
