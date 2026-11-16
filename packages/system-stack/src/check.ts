import { stronglyConnectedComponents } from "@mark1russell7/collections/graph";
import { anyCount, isAllOf, partNeeds, partsById, type Need, type Part, type Stack } from "./stack.ts";
import { working } from "./working.ts";

// The checks of the meaning of a stack. The schema of the entry `/schema` examines the form.

/** These are the levels of a fault. An error stops a gate. A warning does not. */
export const FAULT_LEVELS: readonly ["error", "warning"] = ["error", "warning"];

/** A level of a fault. */
export type FaultLevel = (typeof FAULT_LEVELS)[number];

/** A fault of a record. The checks of the core and of each add-on give faults of this form. */
export interface Fault {
  readonly level: FaultLevel;
  /** The code of the fault. The core and each add-on have their own codes. */
  readonly code: string;
  /** The `id` of the record with the fault. */
  readonly at: string;
  /** The fault in plain words, with the values. */
  readonly message: string;
  /** The `id` of the second record of the fault. A fault of one record has none. */
  readonly other?: string | undefined;
}

/** These are the codes of the faults of a stack. */
export const STACK_CODES: readonly ["id-duplicate", "need-part", "need-count", "need-cycle", "owner-part"] = ["id-duplicate", "need-part", "need-count", "need-cycle", "owner-part"];

/** A code of a fault of a stack. */
export type StackCode = (typeof STACK_CODES)[number];

/** A fault of a stack. */
export interface StackFault extends Fault {
  readonly code: StackCode;
}

/** This function gives each `any` need of a need, at each depth. */
function anyNeeds(need: Need): Extract<Need, { any: readonly Need[] }>[] {
  if (typeof need === "string") return [];
  if (isAllOf(need)) return need.all.flatMap(anyNeeds);
  return [need, ...need.any.flatMap(anyNeeds)];
}

/**
 * This function gives each fault of the meaning of a stack, in the order of the parts.
 *
 * - `id-duplicate`: two parts have one `id`.
 * - `need-part`: a need names no part of the stack.
 * - `need-count`: the count of an `any` need is not a whole number from 1 to the size of its list.
 * - `need-cycle`: parts need each other, and none of them can start. One fault names each part of the cycle.
 * - `owner-part`: the owner of a part is no part of the stack.
 *
 * A cycle through an `any` need is not a fault when a different need of the list lets the part start.
 * The function is pure. An empty list tells that the stack has no fault.
 */
export function checkStack(stack: Stack): StackFault[] {
  const faults: StackFault[] = [];
  const add = (code: StackCode, at: string, message: string, other?: string): void => {
    faults.push({ level: "error", code, at, message, ...(other === undefined ? {} : { other }) });
  };
  const parts = partsById(stack);
  const seen = new Set<string>();
  for (const part of stack.parts) {
    if (seen.has(part.id)) add("id-duplicate", part.id, `Two parts have the id "${part.id}".`);
    seen.add(part.id);
    for (const id of partNeeds(part)) {
      if (!parts.has(id)) add("need-part", part.id, `The part "${part.id}" needs "${id}", which is no part of the stack.`, id);
    }
    for (const need of (part.needs ?? []).flatMap(anyNeeds)) {
      const count = anyCount(need);
      if (!Number.isInteger(count) || count < 1 || count > need.any.length) {
        add("need-count", part.id, `The part "${part.id}" has a need of ${String(count)} of ${String(need.any.length)}: the count is not from 1 to ${String(need.any.length)}.`);
      }
    }
    if (part.owner !== undefined && !parts.has(part.owner)) {
      add("owner-part", part.id, `The owner "${part.owner}" of the part "${part.id}" is no part of the stack.`, part.owner);
    }
  }
  for (const cycle of cycles(stack, parts)) {
    const [first = "", second] = cycle;
    const names = cycle.map((id) => `"${id}"`).join(", ");
    const message = cycle.length === 1 ? `The part ${names} needs itself, so it cannot start.` : `The parts ${names} need each other, so none of them can start.`;
    add("need-cycle", first, message, second);
  }
  const order = new Map<string, number>();
  stack.parts.forEach((part, index) => {
    if (!order.has(part.id)) order.set(part.id, index);
  });
  return faults
    .map((fault, index) => ({ fault, index }))
    .sort((a, b) => (order.get(a.fault.at) ?? 0) - (order.get(b.fault.at) ?? 0) || a.index - b.index)
    .map((entry) => entry.fault);
}

/**
 * This function gives the cycles of parts that cannot start. Each cycle is a list of ids in the order of the parts.
 * It examines only the parts that do not work when no part is down.
 */
function cycles(stack: Stack, parts: ReadonlyMap<string, Part>): string[][] {
  const up = working(stack);
  // A part that waits for an unknown part has the fault `need-part`. It is not a member of a cycle for that reason alone.
  const stuck = stack.parts.filter((part) => !up.has(part.id)).map((part) => part.id);
  const isStuck = new Set(stuck);
  const waits = (id: string): string[] => {
    const part = parts.get(id);
    return part === undefined ? [] : partNeeds(part).filter((need) => isStuck.has(need));
  };
  return stronglyConnectedComponents(new Set(stuck), waits).filter((component) => {
    const [only = ""] = component;
    return component.length > 1 || waits(only).includes(only);
  });
}
