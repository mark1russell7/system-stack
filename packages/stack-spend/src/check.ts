import { dayNumber, partsById, type Fault, type Stack } from "@mark1russell7/system-stack";
import type { Limit, SpendLayer } from "./layer.ts";
import { serviceStates } from "./states.ts";

// The gate of the spend layer. A gate that passes tells that the cost of each part has a hard limit, with a fresh proof.

/** These are the codes of the faults of a spend layer. */
export const SPEND_CODES: readonly [
  "service-part",
  "service-duplicate",
  "part-no-service",
  "price",
  "amount",
  "limit-none",
  "limit-alert",
  "limit-recharge",
  "limit-stop",
  "limit-wanted",
  "proof-none",
  "proof-date",
  "proof-old",
] = ["service-part", "service-duplicate", "part-no-service", "price", "amount", "limit-none", "limit-alert", "limit-recharge", "limit-stop", "limit-wanted", "proof-none", "proof-date", "proof-old"];

/** A code of a fault of a spend layer. */
export type SpendCode = (typeof SPEND_CODES)[number];

/** A fault of a spend layer. Its field `at` is the `id` of the part. */
export interface SpendFault extends Fault {
  readonly code: SpendCode;
}

/** The options of the gate. */
export interface SpendOptions {
  /** The date of the check, as `YYYY-MM-DD`. The gate has no clock: the caller gives the date. */
  readonly today: string;
}

// The function `dayNumber` is in the core since 0.1.1. This entry keeps the name.
export { dayNumber } from "@mark1russell7/system-stack";

/** This function tells if a value is a finite number, 0 or more. */
function isZeroOrMore(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/**
 * This function gives each fault of a spend layer for a stack. An empty list tells that the gate passes.
 *
 * The records:
 * - `service-part`: a record names no part of the stack.
 * - `service-duplicate`: two records name one part.
 * - `part-no-service`: a part of a kind of `kinds` has no record.
 * - `price`: a price is less than 0 or not finite, or a `fixed` service has no price.
 * - `amount`: the amount of a limit is less than 0 or not finite.
 *
 * The limits:
 * - `limit-none`: the cost of a `metered` service has no limit.
 * - `limit-alert`: the only limits of a `metered` service are alerts. An alert stops nothing.
 * - `limit-recharge`: a prepaid balance gets money automatically, so it is no limit.
 * - `limit-stop`: a stop by code does not name the part of the stack that stops the use.
 * - `limit-wanted`: a wanted limit is not in force.
 *
 * The proofs:
 * - `proof-none`: a record has no proof.
 * - `proof-date`: the date of a proof is not a date, or it is after `today`.
 * - `proof-old`: a proof is older than `proofDays`.
 *
 * The faults are in the sequence of the records, then of the parts with no record. The function is pure.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function checkSpend(layer: SpendLayer, stack: Stack, options: SpendOptions): SpendFault[] {
  const today = dayNumber(options.today);
  if (today === undefined) throw new RangeError(`The date "${options.today}" is not a date of the form YYYY-MM-DD.`);
  const faults: SpendFault[] = [];
  const add = (code: SpendCode, at: string, message: string, other?: string): void => {
    faults.push({ level: "error", code, at, message, ...(other === undefined ? {} : { other }) });
  };
  const parts = partsById(stack);
  const states = new Map(serviceStates(layer).map((state) => [state.part, state]));
  const seen = new Set<string>();
  for (const service of layer.services) {
    const at = service.part;
    if (seen.has(at)) {
      add("service-duplicate", at, `Two cost records name the part "${at}".`);
      continue;
    }
    seen.add(at);
    if (!parts.has(at)) add("service-part", at, `A cost record names "${at}", which is no part of the stack.`);
    if (service.price !== undefined && !isZeroOrMore(service.price)) add("price", at, `The price ${String(service.price)} of "${at}" is less than 0 or not finite.`);
    if (service.billing === "fixed" && service.price === undefined) add("price", at, `The service "${at}" has a fixed price, and its record gives no price.`);
    const limits: readonly Limit[] = service.limits ?? [];
    for (const limit of [...limits, ...(service.wanted === undefined ? [] : [service.wanted])]) {
      if (!isZeroOrMore(limit.amount)) add("amount", at, `The amount ${String(limit.amount)} of a limit of "${at}" is less than 0 or not finite.`);
      if (limit.kind !== "code") continue;
      if (limit.stop === undefined) add("limit-stop", at, `A stop by code of "${at}" does not name the part that stops the use.`);
      else if (!parts.has(limit.stop)) add("limit-stop", at, `A stop by code of "${at}" names "${limit.stop}", which is no part of the stack.`, limit.stop);
    }
    const recharges = limits.some((limit) => limit.kind === "prepaid" && limit.recharge === true);
    if (recharges) add("limit-recharge", at, `The prepaid balance of "${at}" gets money automatically, so it does not limit the cost.`);
    if (service.wanted !== undefined) {
      add("limit-wanted", at, `The wanted limit of "${at}" (${service.wanted.kind}, ${String(service.wanted.amount)} ${layer.currency} for a month) is not in force.`);
    } else if (service.billing === "metered" && states.get(at)?.hardLimit === undefined && !recharges) {
      if (limits.some((limit) => limit.kind === "alert")) add("limit-alert", at, `The cost of "${at}" grows with the use, and its only limit is an alert. An alert stops nothing.`);
      else add("limit-none", at, `The cost of "${at}" grows with the use, and it has no limit.`);
    }
    if (service.proof === undefined) {
      add("proof-none", at, `The cost record of "${at}" has no proof.`);
      continue;
    }
    const day = dayNumber(service.proof.date);
    if (day === undefined) add("proof-date", at, `The date "${service.proof.date}" of the proof of "${at}" is not a date of the form YYYY-MM-DD.`);
    else if (day > today) add("proof-date", at, `The date ${service.proof.date} of the proof of "${at}" is after the date of the check, ${options.today}.`);
    else if (today - day > layer.proofDays) {
      add("proof-old", at, `The proof of "${at}" is ${String(today - day)} days old. The largest age is ${String(layer.proofDays)} days.`);
    }
  }
  const kinds = new Set(layer.kinds);
  for (const part of stack.parts) {
    if (kinds.has(part.kind) && !seen.has(part.id)) add("part-no-service", part.id, `The part "${part.id}" has the kind "${part.kind}", and it has no cost record.`);
  }
  return faults;
}
