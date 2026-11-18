import { SPEND_SCHEMA } from "@mark1russell7/stack-spend";
import { partNeeds, type Fault, type Stack } from "@mark1russell7/system-stack";
import type { PlacementLayer } from "./layer.ts";

// The gate of a placement layer: the meaning of a layer with a correct form, for its base stack.

/**
 * These are the codes of the gate.
 *
 * - `part-unknown` (error): the part of the layer is not a part of the base stack.
 * - `slot-twice` (error): two or more slots have one `id`.
 * - `slot-part` (error): the `id` of a slot is a part of the base stack. A candidate gives that part.
 * - `slot-unneeded` (warning): no part of the base stack names the `id` of a slot in a need.
 * - `slot-no-candidate` (error): a slot has no candidate.
 * - `candidate-twice` (error): two or more candidates of a slot have one key.
 * - `candidate-part` (error): the stack of a candidate has no part with the `id` of its slot.
 * - `cost-range` (error): a cost is not a finite number of 0 or more.
 * - `shared-twice` (error): two or more shared fragments have one `id`.
 * - `shared-unknown` (error): a candidate uses a shared fragment that the layer does not have.
 * - `shared-unused` (warning): no candidate uses a shared fragment.
 * - `limit-range` (error): a limit of cost is not a finite number of 0 or more. Or the limit of chance is not from 0 to 1.
 * - `currency` (error): the spend layer of the base stack has a different currency.
 */
export const PLACEMENT_CODES: readonly [
  "part-unknown",
  "slot-twice",
  "slot-part",
  "slot-unneeded",
  "slot-no-candidate",
  "candidate-twice",
  "candidate-part",
  "cost-range",
  "shared-twice",
  "shared-unknown",
  "shared-unused",
  "limit-range",
  "currency",
] = [
  "part-unknown",
  "slot-twice",
  "slot-part",
  "slot-unneeded",
  "slot-no-candidate",
  "candidate-twice",
  "candidate-part",
  "cost-range",
  "shared-twice",
  "shared-unknown",
  "shared-unused",
  "limit-range",
  "currency",
];

/** A code of `PLACEMENT_CODES`. */
export type PlacementCode = (typeof PLACEMENT_CODES)[number];

/** A fault of the gate of a placement layer. */
export interface PlacementFault extends Fault {
  readonly code: PlacementCode;
}

/** This function tells if a value is a finite number, 0 or more. */
function isZeroOrMore(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** This function gives the value of a field of a record, or `undefined` for a value that is not a record. */
function fieldOf(value: unknown, field: string): unknown {
  return typeof value === "object" && value !== null && Object.hasOwn(value, field) ? (value as Record<string, unknown>)[field] : undefined;
}

/** This function gives each `id` that two or more items of a list have, in the order of their first item. */
function twice(ids: readonly string[]): string[] {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([id]) => id);
}

/**
 * This function gives each fault of a placement layer for its base stack. A list with no error tells that the gate passes.
 *
 * The gate examines the slots, the candidates, the shared fragments, the costs and the limits. It does not examine the
 * layers of a fragment: the gates of their add-ons examine each placed stack. The faults are in the order of the layer.
 * The function is pure.
 *
 * @param layer - The placement layer
 * @param stack - The base stack, with the layer
 * @returns The faults
 */
export function checkPlacement(layer: PlacementLayer, stack: Stack): PlacementFault[] {
  const faults: PlacementFault[] = [];
  const add = (level: PlacementFault["level"], code: PlacementCode, at: string, message: string): void => {
    faults.push({ level, code, at, message });
  };
  const parts = new Set(stack.parts.map((part) => part.id));
  const needed = new Set(stack.parts.flatMap((part) => partNeeds(part)));
  if (!parts.has(layer.part)) add("error", "part-unknown", layer.part, `The part "${layer.part}" of the placement is not a part of the stack.`);
  for (const id of twice(layer.slots.map((slot) => slot.id))) add("error", "slot-twice", id, `Two or more slots have the id "${id}".`);
  const shared = layer.shared ?? [];
  const sharedIds = new Set(shared.map((item) => item.id));
  const used = new Set<string>();
  for (const slot of layer.slots) {
    if (parts.has(slot.id)) add("error", "slot-part", slot.id, `The slot "${slot.id}" is a part of the stack. A candidate of the slot gives that part.`);
    else if (!needed.has(slot.id)) add("warning", "slot-unneeded", slot.id, `No part of the stack names the slot "${slot.id}" in a need.`);
    if (slot.candidates.length === 0) add("error", "slot-no-candidate", slot.id, `The slot "${slot.id}" has no candidate.`);
    for (const key of twice(slot.candidates.map((candidate) => candidate.key))) add("error", "candidate-twice", slot.id, `Two or more candidates of the slot "${slot.id}" have the key "${key}".`);
    for (const candidate of slot.candidates) {
      const at = `${slot.id}/${candidate.key}`;
      if (!candidate.stack.parts.some((part) => part.id === slot.id)) add("error", "candidate-part", at, `The candidate "${candidate.key}" of the slot "${slot.id}" has no part "${slot.id}".`);
      if (!isZeroOrMore(candidate.cost)) add("error", "cost-range", at, `The cost of the candidate "${candidate.key}" of the slot "${slot.id}" is ${String(candidate.cost)}. It must be 0 or more.`);
      for (const id of candidate.uses ?? []) {
        used.add(id);
        if (!sharedIds.has(id)) add("error", "shared-unknown", at, `The candidate "${candidate.key}" of the slot "${slot.id}" uses the shared fragment "${id}". The layer has no shared fragment "${id}".`);
      }
    }
  }
  for (const id of twice(shared.map((item) => item.id))) add("error", "shared-twice", id, `Two or more shared fragments have the id "${id}".`);
  for (const item of shared) {
    if (item.cost !== undefined && !isZeroOrMore(item.cost)) add("error", "cost-range", item.id, `The cost of the shared fragment "${item.id}" is ${String(item.cost)}. It must be 0 or more.`);
    if (!used.has(item.id)) add("warning", "shared-unused", item.id, `No candidate uses the shared fragment "${item.id}".`);
  }
  const limits = layer.limits ?? {};
  for (const name of ["cost", "bound"] as const) {
    const value = limits[name];
    if (value !== undefined && !isZeroOrMore(value)) add("error", "limit-range", name, `The limit "${name}" is ${String(value)}. It must be 0 or more.`);
  }
  if (limits.chance !== undefined && !(limits.chance >= 0 && limits.chance <= 1)) add("error", "limit-range", "chance", `The limit "chance" is ${String(limits.chance)}. It must be from 0 to 1.`);
  const currency = fieldOf(stack.layers?.[SPEND_SCHEMA], "currency");
  if (typeof currency === "string" && currency !== layer.currency) add("error", "currency", layer.part, `The placement has the currency "${layer.currency}", and the spend layer of the stack has "${currency}".`);
  return faults;
}
