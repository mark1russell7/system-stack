import type { Fault, FaultLevel } from "@mark1russell7/system-stack";
import type { SpendLayer } from "./layer.ts";
import type { UseOptions, UseRead } from "./reads.ts";
import { usePlan } from "./use-plan.ts";
import { useStates } from "./use.ts";

// The gate of the used amounts. It tells when a limit did not hold, and it gives a warning at each level of a limit.

/** These are the codes of the faults of the used amounts of a layer. */
export const USE_CODES: readonly ["read-part", "read-amount", "read-date", "use-billing", "use-over", "use-level", "use-count", "use-none", "use-old"] = [
  "read-part",
  "read-amount",
  "read-date",
  "use-billing",
  "use-over",
  "use-level",
  "use-count",
  "use-none",
  "use-old",
];

/** A code of a fault of the used amounts of a layer. */
export type UseCode = (typeof USE_CODES)[number];

/** A fault of the used amounts of a layer. Its field `at` is the `id` of the part. */
export interface UseFault extends Fault {
  readonly code: UseCode;
}

/** This function gives a share as a text in percent, for example `80` for 0.8. */
function percent(share: number): string {
  return String(Number((share * 100).toFixed(6)));
}

/**
 * This function gives each fault of the used amounts of a layer. A list with no error tells that the gate passes.
 *
 * The reads, as errors:
 * - `read-part`: a read names a part with no cost record.
 * - `read-amount`: the amount of a read is less than 0 or not finite.
 * - `read-date`: the date of a read is not a date, or it is after `today`.
 *
 * The services, as errors:
 * - `use-billing`: a read shows a cost of the use of a `free` or `fixed` service. The cost record is not correct.
 * - `use-over`: the used amount of a `metered` service is more than its hard limit. The limit did not hold.
 *
 * The services, as warnings:
 * - `use-level`: the used amount of a `metered` service reached a level of its hard limit.
 * - `use-count`: the provider shows more than the stack counted. The count does not have all the use.
 * - `use-none`: a `metered` service has no read of the month, so its used amount is not known.
 * - `use-old`: the newest read of a `metered` service is older than `readDays`.
 *
 * A read with a fault does not count. The faults are in the sequence of the reads, then of the services. The function is pure.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`, or `levels` or `readDays` is not valid
 */
export function checkUse(layer: SpendLayer, reads: readonly UseRead[], options: UseOptions): UseFault[] {
  const plan = usePlan(layer, reads, options);
  const faults: UseFault[] = [];
  const add = (level: FaultLevel, code: UseCode, at: string, message: string): void => {
    faults.push({ level, code, at, message });
  };
  const money = (amount: number): string => `${String(amount)} ${layer.currency}`;
  reads.forEach((read, index) => {
    const code = plan.codes[index];
    if (code === "read-part") add("error", code, read.part, `A read names "${read.part}", which has no cost record.`);
    if (code === "read-amount") add("error", code, read.part, `The amount ${String(read.amount)} of a read of "${read.part}" is less than 0 or not finite.`);
    if (code === "read-date") add("error", code, read.part, `The date "${read.date}" of a read of "${read.part}" is not a date of the form YYYY-MM-DD, or it is after the date of the check, ${options.today}.`);
  });
  for (const state of useStates(layer, reads, options)) {
    const at = state.part;
    if (state.billing !== "metered") {
      if (state.used !== undefined && state.used > 0) {
        add("error", "use-billing", at, `The service "${at}" has the billing "${state.billing}", and a read shows a cost of ${money(state.used)} for its use in the month ${plan.month}.`);
      }
      continue;
    }
    if (state.used === undefined) {
      add("warning", "use-none", at, `No read gives the used amount of "${at}" in the month ${plan.month}.`);
      continue;
    }
    if (state.over === true && state.limit !== undefined) {
      add("error", "use-over", at, `The used amount of "${at}" in the month ${plan.month} is ${money(state.used)}. Its hard limit is ${money(state.limit)}, so the limit did not hold.`);
    } else if (state.level !== undefined && state.limit !== undefined) {
      add("warning", "use-level", at, `The used amount of "${at}" in the month ${plan.month} is ${money(state.used)}: ${percent(state.level)} percent of its hard limit of ${money(state.limit)}, or more.`);
    }
    if (state.count !== undefined && state.provider !== undefined && state.provider > state.count) {
      add("warning", "use-count", at, `The provider shows ${money(state.provider)} for "${at}" in the month ${plan.month}, and the stack counted ${money(state.count)}. The count does not have all the use.`);
    }
    if (plan.readDays !== undefined && state.age !== undefined && state.age > plan.readDays) {
      add("warning", "use-old", at, `The age of the newest read of "${at}" is ${String(state.age)}, in days. The largest age is ${String(plan.readDays)}.`);
    }
  }
  return faults;
}
