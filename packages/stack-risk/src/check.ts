import { dayNumber, partsById, stopSets, works, type Fault, type Stack } from "@mark1russell7/system-stack";
import { worksChance } from "./chance.ts";
import { delayFault, firstGoals, isChance, type Accepted, type RiskLayer } from "./layer.ts";

// The gate of the risk layer. A gate that passes tells that each goal holds: no set of parts stops a part with fewer
// failures than its goal permits, unless a record accepts the set, and each chance is not less than its goal.

/** These are the codes of the faults of a risk layer. */
export const RISK_CODES: readonly [
  "goal-part",
  "goal-duplicate",
  "goal-survives",
  "goal-chance",
  "goal-within",
  "chance-part",
  "chance-duplicate",
  "chance-range",
  "chance-delay",
  "accept-part",
  "accept-stop",
  "accept-date",
  "stopped",
  "stop-set",
  "accept-old",
  "accept-unused",
  "chance-none",
  "chance-low",
  "no-read",
] = [
  "goal-part",
  "goal-duplicate",
  "goal-survives",
  "goal-chance",
  "goal-within",
  "chance-part",
  "chance-duplicate",
  "chance-range",
  "chance-delay",
  "accept-part",
  "accept-stop",
  "accept-date",
  "stopped",
  "stop-set",
  "accept-old",
  "accept-unused",
  "chance-none",
  "chance-low",
  "no-read",
];

/** A code of a fault of a risk layer. */
export type RiskCode = (typeof RISK_CODES)[number];

/** A fault of a risk layer. Its field `at` is the `id` of the part of the record. */
export interface RiskFault extends Fault {
  readonly code: RiskCode;
  /** The parts of the fault: the stop set, or the parts with no chance record. */
  readonly parts?: readonly string[] | undefined;
}

/** The options of the gate. */
export interface RiskOptions {
  /** The date of the check, as `YYYY-MM-DD`. The gate has no clock: the caller gives the date. */
  readonly today: string;
  /** The largest count of sets in one step of a search. The default is the default of the core, 4096. */
  readonly maxSets?: number | undefined;
  /** The largest count of steps of the calculation of a chance. The default is 1000000. */
  readonly maxSteps?: number | undefined;
}

/** This function gives the text of a set of parts for a message, for example `["card", "push"]`. */
function setText(parts: readonly string[]): string {
  return `[${parts.map((id) => `"${id}"`).join(", ")}]`;
}

/** This function gives one key for each set of parts. The sequence of the parts does not change the key. */
function setKey(parts: readonly string[]): string {
  return JSON.stringify([...new Set(parts)].sort());
}

/**
 * This function gives each fault of a risk layer for a stack. An empty list tells that the gate passes.
 * The gate examines the design: each part of the stack is in operation. `goalStates` gives the state with parts that are down.
 *
 * The records:
 * - `goal-part`: a goal names no part of the stack.
 * - `goal-duplicate`: two goals name one part.
 * - `goal-survives`: the count of a goal is not a whole number from 0.
 * - `goal-chance`: the chance of a goal is not from 0 to 1.
 * - `goal-within`: the limit of time of a goal is not a time of 0 or more, or the goal has no chance.
 * - `chance-part`: a chance record names no part of the stack.
 * - `chance-duplicate`: two chance records name one part.
 * - `chance-range`: the chance of a part is not from 0 to 1.
 * - `chance-delay`: the wait of a part is not a time of 0 or more, or its delay points are not in order.
 * - `accept-part`: an accepted risk names a part with no goal.
 * - `accept-stop`: an accepted risk names no part, or a part that is not in the stack.
 * - `accept-date`: the last date of an accepted risk is not a date.
 *
 * The goals:
 * - `stopped`: the part of a goal does not work, with each part of the stack in operation.
 * - `stop-set`: the failure of a set of parts stops a part, and the goal is to survive a set of that size. No record accepts the set.
 * - `accept-old`: the acceptance of a stop set ended before `today`.
 * - `accept-unused`: an accepted risk names a set that is no stop set of its goal. Remove the record.
 * - `chance-none`: a goal has a chance, and a part of its paths has no chance record.
 * - `chance-low`: the chance that a part works is less than the chance of its goal. With a limit of time, the part
 *   must also end its work in time.
 * - `no-read`: a search passed its limit. The gate has no result for the goal, so it does not pass.
 *
 * The faults are in the sequence of the chance records, the accepted risks and the goals. The function is pure.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`, or `maxSets` or `maxSteps` is not valid
 */
export function checkRisk(layer: RiskLayer, stack: Stack, options: RiskOptions): RiskFault[] {
  const today = dayNumber(options.today);
  if (today === undefined) throw new RangeError(`The date "${options.today}" is not a date of the form YYYY-MM-DD.`);
  const limits = { ...(options.maxSets === undefined ? {} : { maxSets: options.maxSets }), ...(options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps }) };
  const faults: RiskFault[] = [];
  const add = (code: RiskCode, at: string, message: string, more: { readonly other?: string; readonly parts?: readonly string[] } = {}): void => {
    faults.push({ level: "error", code, at, message, ...more });
  };
  const parts = partsById(stack);

  const chanceParts = new Set<string>();
  let chancesValid = true;
  for (const chance of layer.chances ?? []) {
    const at = chance.part;
    if (chanceParts.has(at)) {
      add("chance-duplicate", at, `Two chance records name the part "${at}".`);
      continue;
    }
    chanceParts.add(at);
    if (!parts.has(at)) add("chance-part", at, `A chance record names "${at}", which is no part of the stack.`);
    if (!isChance(chance.works)) {
      add("chance-range", at, `The chance ${String(chance.works)} of "${at}" is not from 0 to 1.`);
      chancesValid = false;
    }
    const fault = delayFault(chance);
    if (fault !== undefined) {
      add("chance-delay", at, fault);
      chancesValid = false;
    }
  }

  const goals = new Map(firstGoals(layer).map((goal) => [goal.part, goal]));
  // Each accepted risk with a correct form, with the key of its set. `used` tells that the set is a stop set of its goal.
  const accepted: { readonly record: Accepted; readonly key: string; readonly ended: boolean; used: boolean }[] = [];
  for (const record of layer.accepted ?? []) {
    const at = record.part;
    let valid = true;
    if (!goals.has(at)) {
      add("accept-part", at, `An accepted risk names "${at}", which has no goal.`);
      valid = false;
    }
    if (record.stop.length === 0) {
      add("accept-stop", at, `An accepted risk of "${at}" names no part.`);
      valid = false;
    }
    for (const id of record.stop) {
      if (parts.has(id)) continue;
      add("accept-stop", at, `An accepted risk of "${at}" names "${id}", which is no part of the stack.`, { other: id });
      valid = false;
    }
    const last = record.until === undefined ? undefined : dayNumber(record.until);
    if (record.until !== undefined && last === undefined) {
      add("accept-date", at, `The date "${record.until}" of an accepted risk of "${at}" is not a date of the form YYYY-MM-DD.`);
      valid = false;
    }
    if (valid) accepted.push({ record, key: setKey(record.stop), ended: last !== undefined && last < today, used: false });
  }

  // The goals whose stop sets the gate read. An accepted risk of a different goal gets no examination.
  const read = new Set<string>();
  const seen = new Set<string>();
  for (const goal of layer.goals) {
    const at = goal.part;
    if (seen.has(at)) {
      add("goal-duplicate", at, `Two goals name the part "${at}".`);
      continue;
    }
    seen.add(at);
    if (!parts.has(at)) {
      add("goal-part", at, `A goal names "${at}", which is no part of the stack.`);
      continue;
    }
    const counted = Number.isInteger(goal.survives) && goal.survives >= 0;
    if (!counted) add("goal-survives", at, `The count ${String(goal.survives)} of the goal of "${at}" is not a whole number from 0.`);
    if (goal.chance !== undefined && !isChance(goal.chance)) add("goal-chance", at, `The chance ${String(goal.chance)} of the goal of "${at}" is not from 0 to 1.`);
    const { within } = goal;
    const timed = within === undefined || (within >= 0 && goal.chance !== undefined);
    if (within !== undefined && !(within >= 0)) add("goal-within", at, `The limit of time ${String(within)} of the goal of "${at}" is not a time of 0 or more.`);
    else if (within !== undefined && goal.chance === undefined) add("goal-within", at, `The goal of "${at}" has a limit of time and no chance.`);
    if (!works(stack, at)) {
      add("stopped", at, `The part "${at}" does not work, with each part of the stack in operation: one of its needs does not hold.`);
      continue;
    }
    if (counted) {
      const stops = stopSets(stack, at, { ...limits, size: goal.survives });
      if (stops.kind === "budget") add("no-read", at, `The search of the stop sets of "${at}" passed its limit. The gate has no result for this goal.`);
      else {
        read.add(at);
        for (const set of stops.sets) {
          const key = setKey(set);
          const records = accepted.filter((entry) => entry.record.part === at && entry.key === key);
          for (const entry of records) entry.used = true;
          if (records.some((entry) => !entry.ended)) continue;
          const old = records[0];
          if (old === undefined) {
            add("stop-set", at, `The failure of the set ${setText(set)} stops "${at}". The goal of "${at}" is to survive each set of ${String(goal.survives)} or fewer parts.`, { parts: set });
          } else {
            add("accept-old", at, `The acceptance of the stop set ${setText(set)} of "${at}" ended on ${old.record.until ?? ""}. The failure of the set stops "${at}".`, { parts: set });
          }
        }
      }
    }
    if (goal.chance === undefined || !isChance(goal.chance) || !chancesValid || !timed) continue;
    const chance = worksChance(layer, stack, at, within === undefined ? limits : { ...limits, within });
    if (chance.kind === "budget") add("no-read", at, `The calculation of the chance of "${at}" passed its limit. The gate has no result for this goal.`);
    else if (chance.assumed.length > 0) {
      add("chance-none", at, `The goal of "${at}" has a chance, and these parts of its paths have no chance record: ${setText(chance.assumed)}.`, { parts: chance.assumed });
    } else if (chance.value < goal.chance) {
      const what = within === undefined ? "works" : `works and ends within ${String(within)} seconds`;
      add("chance-low", at, `The chance that "${at}" ${what} is ${String(chance.value)}. The goal is ${String(goal.chance)}.`);
    }
  }

  for (const entry of accepted) {
    const at = entry.record.part;
    if (entry.used || !read.has(at)) continue;
    const survives = goals.get(at)?.survives ?? 0;
    add("accept-unused", at, `An accepted risk of "${at}" names the set ${setText(entry.record.stop)}. It is no stop set of "${at}" of ${String(survives)} or fewer parts.`, { parts: entry.record.stop });
  }
  return faults;
}
