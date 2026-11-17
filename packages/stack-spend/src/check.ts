import { dayNumber, partsById, type Fault, type FaultLevel, type Stack } from "@mark1russell7/system-stack";
import { END_DAYS, type Limit, type SpendLayer } from "./layer.ts";
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
  "end-date",
  "end-past",
  "end-soon",
  "end-open",
  "proof-none",
  "proof-date",
  "proof-old",
] = [
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
  "end-date",
  "end-past",
  "end-soon",
  "end-open",
  "proof-none",
  "proof-date",
  "proof-old",
];

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

/** This function gives the words for a count of days from the date of the check. */
function inDays(days: number): string {
  if (days === 0) return "on the date of the check";
  return days === 1 ? "in 1 day" : `in ${String(days)} days`;
}

/**
 * This function gives each fault of a spend layer for a stack. A list with no error tells that the gate passes.
 *
 * The records:
 * - `service-part`: a record names no part of the stack.
 * - `service-duplicate`: two records name one part.
 * - `part-no-service`: a part of a kind of `kinds` has no record.
 * - `price`: a price is less than 0 or not finite, or a `fixed` plan has no price.
 * - `amount`: the amount of a limit is less than 0 or not finite.
 *
 * The limits:
 * - `limit-none`: the cost of a `metered` service has no limit.
 * - `limit-alert`: the only limits of a `metered` service are alerts. An alert stops nothing.
 * - `limit-recharge`: a prepaid balance gets money automatically, so it is no limit.
 * - `limit-stop`: a stop by code does not name the part of the stack that stops the use.
 * - `limit-wanted`: a wanted limit is not in force.
 *
 * The end of a plan:
 * - `end-date`: the date of an end is not a date.
 * - `end-past`: the plan ended before `today`. The record gives the cost before the end, so it is not correct.
 * - `end-soon`: the plan ends in `endDays` days, or fewer. This fault is a warning: it does not stop the gate.
 * - `end-open`: the cost after the end grows with the use, and it has no hard limit.
 *
 * The proofs:
 * - `proof-none`: a record has no proof.
 * - `proof-date`: the date of a proof is not a date, or it is after `today`.
 * - `proof-old`: a proof is older than `proofDays`.
 *
 * The faults `price`, `amount` and `limit-stop` examine the plan after an end too.
 * The faults are in the sequence of the records, then of the parts with no record. The function is pure.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function checkSpend(layer: SpendLayer, stack: Stack, options: SpendOptions): SpendFault[] {
  const today = dayNumber(options.today);
  if (today === undefined) throw new RangeError(`The date "${options.today}" is not a date of the form YYYY-MM-DD.`);
  const faults: SpendFault[] = [];
  const push = (level: FaultLevel, code: SpendCode, at: string, message: string, other?: string): void => {
    faults.push({ level, code, at, message, ...(other === undefined ? {} : { other }) });
  };
  const add = (code: SpendCode, at: string, message: string, other?: string): void => {
    push("error", code, at, message, other);
  };
  const parts = partsById(stack);
  // The faults of one limit. `when` is empty, or it tells that the limit is of the plan after an end.
  const examine = (limit: Limit, at: string, when: string): void => {
    if (!isZeroOrMore(limit.amount)) add("amount", at, `The amount ${String(limit.amount)} of a limit of "${at}"${when} is less than 0 or not finite.`);
    if (limit.kind !== "code") return;
    if (limit.stop === undefined) add("limit-stop", at, `A stop by code of "${at}"${when} does not name the part that stops the use.`);
    else if (!parts.has(limit.stop)) add("limit-stop", at, `A stop by code of "${at}"${when} names "${limit.stop}", which is no part of the stack.`, limit.stop);
  };
  const states = new Map(serviceStates(layer).map((state) => [state.part, state]));
  const endDays = layer.endDays ?? END_DAYS;
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
    for (const limit of [...limits, ...(service.wanted === undefined ? [] : [service.wanted])]) examine(limit, at, "");
    const recharges = limits.some((limit) => limit.kind === "prepaid" && limit.recharge === true);
    if (recharges) add("limit-recharge", at, `The prepaid balance of "${at}" gets money automatically, so it does not limit the cost.`);
    if (service.wanted !== undefined) {
      add("limit-wanted", at, `The wanted limit of "${at}" (${service.wanted.kind}, ${String(service.wanted.amount)} ${layer.currency} for a month) is not in force.`);
    } else if (service.billing === "metered" && states.get(at)?.hardLimit === undefined && !recharges) {
      if (limits.some((limit) => limit.kind === "alert")) add("limit-alert", at, `The cost of "${at}" grows with the use, and its only limit is an alert. An alert stops nothing.`);
      else add("limit-none", at, `The cost of "${at}" grows with the use, and it has no limit.`);
    }
    if (service.ends !== undefined) {
      const { date, next } = service.ends;
      const end = dayNumber(date);
      if (end === undefined) add("end-date", at, `The date "${date}" of the end of the plan of "${at}" is not a date of the form YYYY-MM-DD.`);
      else if (end < today) add("end-past", at, `The plan of "${at}" ended on ${date}. The record gives the cost before the end.`);
      else if (end - today <= endDays) {
        const then = next === undefined ? "Then the provider stops the service." : "Then the cost changes.";
        push("warning", "end-soon", at, `The plan of "${at}" ends on ${date}, ${inDays(end - today)}. ${then}`);
      }
      if (next !== undefined) {
        const when = " after the end of its plan";
        if (next.price !== undefined && !isZeroOrMore(next.price)) add("price", at, `The price ${String(next.price)} of "${at}"${when} is less than 0 or not finite.`);
        if (next.billing === "fixed" && next.price === undefined) add("price", at, `The service "${at}" has a fixed price${when}, and its record gives no price.`);
        for (const limit of next.limits ?? []) examine(limit, at, when);
        if (next.billing === "metered" && states.get(at)?.nextLimit === undefined) {
          add("end-open", at, `The plan of "${at}" ends on ${date}. After the end, the cost grows with the use, and it has no hard limit.`);
        }
      }
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
