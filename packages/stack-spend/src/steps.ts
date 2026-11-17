import { partsById, type Stack } from "@mark1russell7/system-stack";
import { checkSpend, type SpendOptions } from "./check.ts";
import type { Limit, PlanEnd, SpendLayer } from "./layer.ts";

// The work of the owner of the accounts, from the faults of the gate. A program cannot change these settings.

/** These are the codes of the faults that the owner of an account corrects in the account of the service. */
export const OWNER_CODES: readonly ["limit-wanted", "limit-recharge", "end-past", "end-soon", "end-open", "proof-none", "proof-old"] = [
  "limit-wanted",
  "limit-recharge",
  "end-past",
  "end-soon",
  "end-open",
  "proof-none",
  "proof-old",
];

/** A code of a fault that the owner of an account corrects. */
export type OwnerCode = (typeof OWNER_CODES)[number];

/** One piece of work of the owner of an account. */
export interface OwnerStep {
  /** The `id` of the part of the service. */
  readonly part: string;
  /** The name of the part, or its `id`. */
  readonly name: string;
  readonly code: OwnerCode;
  /** The work, in one sentence. */
  readonly text: string;
  /** The steps in the account of the service, from the record. */
  readonly steps: readonly string[];
}

/** This function gives the sentence for a wanted limit that the owner sets in the account. */
function wantedText(limit: Limit, currency: string): string {
  const amount = `${String(limit.amount)} ${currency}`;
  if (limit.kind === "provider") return `Set a hard limit of ${amount} for a month.`;
  if (limit.kind === "prepaid") return `Keep a prepaid balance of ${amount} at most, with no automatic recharge.`;
  return `Set an alert at ${amount} for a month.`;
}

/** This function gives the sentence for a plan that ends soon. */
function endText(ends: PlanEnd): string {
  if (ends.next === undefined) return `Decide before ${ends.date} if the service continues. With no change, the provider stops it after that date.`;
  return `Stop the service before ${ends.date} if the cost after that date is not wanted.`;
}

/**
 * This function gives the work of the owner of the accounts, in the sequence of the records.
 *
 * - `limit-wanted`: set the wanted limit in the account. A wanted stop by code is the work of a programmer, so it gives no step.
 * - `limit-recharge`: stop the automatic recharge of the balance.
 * - `end-soon`: decide before the date. A service with no plan after the end stops, and the cost of each other service changes.
 * - `end-open`: set a hard limit for the cost after the end, or stop the service before the date. Then `end-soon` gives no second step.
 * - `end-past`, `proof-none` and `proof-old`: read the plan and the limits in the account, and give them with the date.
 *
 * Each other fault of the gate is a fault of the records, which their writer corrects.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function ownerSteps(layer: SpendLayer, stack: Stack, options: SpendOptions): OwnerStep[] {
  const parts = partsById(stack);
  const services = new Map(layer.services.map((service) => [service.part, service] as const).reverse());
  const steps: OwnerStep[] = [];
  const faults = checkSpend(layer, stack, options);
  const open = new Set(faults.filter((fault) => fault.code === "end-open").map((fault) => fault.at));
  for (const fault of faults) {
    const code = OWNER_CODES.find((item) => item === fault.code);
    const service = services.get(fault.at);
    if (code === undefined || service === undefined) continue;
    if (code === "limit-wanted" && service.wanted?.kind === "code") continue;
    if (code === "end-soon" && open.has(fault.at)) continue;
    let text = "Read the plan and the limits in the account, and give them with the date of the read.";
    if (code === "limit-recharge") text = "Stop the automatic recharge of the prepaid balance.";
    if (code === "limit-wanted" && service.wanted !== undefined) text = wantedText(service.wanted, layer.currency);
    if (code === "end-soon" && service.ends !== undefined) text = endText(service.ends);
    if (code === "end-open" && service.ends !== undefined) text = `Set a hard limit for the cost after ${service.ends.date}, or stop the service before that date.`;
    steps.push({ part: fault.at, name: parts.get(fault.at)?.name ?? fault.at, code, text, steps: service.steps ?? [] });
  }
  return steps;
}
