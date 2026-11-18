import { joinStacks, type LayerJoiner, type Stack, type StackFragment, type StackJoinFinding } from "@mark1russell7/system-stack";
import { PLACEMENT_SCHEMA, type Candidate, type Choice, type PlacementLayer, type Shared } from "./layer.ts";

// The placed stack of one choice: the base stack, the chosen candidates and their shared fragments, as one stack.

/**
 * These are the codes of the faults of a choice. Each one is an error.
 *
 * - `slot-unknown`: the choice names a slot that the layer does not have.
 * - `slot-empty`: the choice leaves a slot empty, and the slot is not optional.
 * - `candidate-unknown`: the choice names a key that the slot does not have.
 * - `shared-unknown`: a chosen candidate uses a shared fragment that the layer does not have.
 */
export const CHOICE_CODES: readonly ["slot-unknown", "slot-empty", "candidate-unknown", "shared-unknown"] = ["slot-unknown", "slot-empty", "candidate-unknown", "shared-unknown"];

/** A code of `CHOICE_CODES`. */
export type ChoiceCode = (typeof CHOICE_CODES)[number];

/** The name of the fragment of the base stack in a join. */
export const BASE_FRAGMENT = "base";

/** This function gives the name of the fragment of the chosen candidate of a slot in a join. */
export function slotFragment(slot: string): string {
  return `slot:${slot}`;
}

/** This function gives the name of a shared fragment in a join. */
export function sharedFragment(id: string): string {
  return `shared:${id}`;
}

/**
 * The result of `placedStack`.
 *
 * - `ok: true`: `stack` is the placed stack. `cost` is the expected cost of a month. `shared` has the `id` of each shared fragment of the stack.
 * - `ok: false`: `findings` has the faults of the choice, or the findings of the join of the fragments.
 */
export type Placed =
  | { readonly ok: true; readonly stack: Stack; readonly cost: number; readonly shared: readonly string[] }
  | { readonly ok: false; readonly findings: readonly StackJoinFinding[] };

/** One chosen candidate and its slot. */
interface Chosen {
  readonly slot: string;
  readonly candidate: Candidate;
}

/** This function gives a fault of a choice. */
function choiceFault(code: ChoiceCode, at: string, message: string): StackJoinFinding {
  return { level: "error", code, layer: PLACEMENT_SCHEMA, at, from: [], message };
}

/** This function gives a stack with no placement layer. The other layers stay as they are. */
function withoutPlacement(stack: Stack): Stack {
  if (stack.layers === undefined || !Object.hasOwn(stack.layers, PLACEMENT_SCHEMA)) return stack;
  const layers = Object.fromEntries(Object.entries(stack.layers).filter(([name]) => name !== PLACEMENT_SCHEMA));
  return { ...stack, layers };
}

/**
 * This function gives the placed stack of one choice.
 *
 * - The fragments are the base stack with no placement layer, the chosen candidate of each slot, then each shared fragment that a chosen candidate uses.
 * - A shared fragment is one fragment, also when two or more chosen candidates use it. Thus the stack counts a shared cause of failure one time.
 * - `joinStacks` of the core joins the fragments. Each add-on of `joiners` joins its layer, for example the chances of `risk/1`.
 * - The expected cost is the sum of the costs of the chosen candidates and of their shared fragments.
 *
 * A fault of the choice gives no join. The function is pure, and it does not change the layer or the stack.
 *
 * @param layer - The placement layer
 * @param stack - The base stack. A placement layer of the stack is not part of the placed stack.
 * @param choice - The key of the candidate of each slot
 * @param joiners - The add-ons that join the layers of the fragments, for example the risk add-on and the spend add-on
 * @returns The placed stack and its cost, or the findings
 */
export function placedStack(layer: PlacementLayer, stack: Stack, choice: Choice, joiners: readonly LayerJoiner<unknown>[]): Placed {
  const findings: StackJoinFinding[] = [];
  const slots = new Set(layer.slots.map((slot) => slot.id));
  for (const id of Object.keys(choice).sort()) {
    if (!slots.has(id)) findings.push(choiceFault("slot-unknown", id, `The choice names the slot "${id}". The layer has no slot "${id}".`));
  }
  const chosen: Chosen[] = [];
  for (const slot of layer.slots) {
    const key = Object.hasOwn(choice, slot.id) ? choice[slot.id] : null;
    if (key === null || key === undefined) {
      if (slot.optional !== true) findings.push(choiceFault("slot-empty", slot.id, `The choice leaves the slot "${slot.id}" empty, and the slot is not optional.`));
      continue;
    }
    const candidate = slot.candidates.find((item) => item.key === key);
    if (candidate === undefined) findings.push(choiceFault("candidate-unknown", slot.id, `The slot "${slot.id}" has no candidate "${key}".`));
    else chosen.push({ slot: slot.id, candidate });
  }
  const shared: readonly Shared[] = layer.shared ?? [];
  const known = new Set(shared.map((item) => item.id));
  const uses = new Set(chosen.flatMap((item) => item.candidate.uses ?? []));
  for (const id of uses) {
    if (!known.has(id)) findings.push(choiceFault("shared-unknown", id, `A chosen candidate uses the shared fragment "${id}". The layer has no shared fragment "${id}".`));
  }
  if (findings.length > 0) return { ok: false, findings };
  const used = shared.filter((item) => uses.has(item.id));
  const fragments: StackFragment[] = [
    { name: BASE_FRAGMENT, stack: withoutPlacement(stack) },
    ...chosen.map((item) => ({ name: slotFragment(item.slot), stack: item.candidate.stack })),
    ...used.map((item) => ({ name: sharedFragment(item.id), stack: item.stack })),
  ];
  const joined = joinStacks(fragments, joiners);
  if (!joined.ok) return { ok: false, findings: joined.findings };
  let cost = 0;
  for (const item of chosen) cost += item.candidate.cost;
  for (const item of used) cost += item.cost ?? 0;
  return { ok: true, stack: joined.stack, cost, shared: used.map((item) => item.id) };
}
