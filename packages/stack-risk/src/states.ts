import { smallestStop, stopSets, works, type PathOptions, type Stack } from "@mark1russell7/system-stack";
import { firstGoals, type RiskLayer } from "./layer.ts";

// The state of each goal at this time: the live read. The parts that are down come from the monitors of the system.

/**
 * The state of the goal of one part, with the parts that are down at this time.
 *
 * - `read: true`: the query has a result. `works` tells if the part works.
 *   `margin` is the count of more failures that the part always survives. It is `Infinity` when no failure of other parts stops the part.
 *   `stop` is a smallest set of parts whose failure stops the part. `points` has each part whose failure alone stops the part.
 * - `read: false`: the search passed its limit, so the state has no result. Do not show it as a state that is good.
 */
export type GoalState =
  | { readonly part: string; readonly read: true; readonly works: boolean; readonly margin: number; readonly stop: readonly string[]; readonly points: readonly string[] }
  | { readonly part: string; readonly read: false };

/**
 * This function gives the state of each goal of a layer, when the parts of `down` do not work.
 *
 * - A part that does not work has the margin 0, and its lists are empty.
 * - A goal with `survives: 1` and one part of its paths down can have the margin 0: one more failure stops the part.
 * - The states are in the sequence of the goals. The first goal of a part is used.
 *
 * The function is pure.
 *
 * @throws RangeError when `maxSets` is not a whole number from 1
 */
export function goalStates(layer: RiskLayer, stack: Stack, options: PathOptions = {}): GoalState[] {
  // The option `down` can be a sequence that gives its items one time. Each query reads this list.
  const down = [...(options.down ?? [])];
  return firstGoals(layer).map((goal): GoalState => {
    const part = goal.part;
    const least = smallestStop(stack, part, { ...options, down });
    const single = stopSets(stack, part, { ...options, down, size: 1 });
    if (least.kind === "budget" || single.kind === "budget") return { part, read: false };
    const up = works(stack, part, down);
    if (least.kind === "none") return { part, read: true, works: up, margin: Number.POSITIVE_INFINITY, stop: [], points: [] };
    return { part, read: true, works: up, margin: Math.max(0, least.parts.length - 1), stop: least.parts, points: single.sets.flat() };
  });
}
