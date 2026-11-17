import { NUMBER_RING, pathSetReliability } from "@mark1russell7/collections/graph";
import { pathSets, type PathOptions, type Stack } from "@mark1russell7/system-stack";
import { chancesByPart, type RiskLayer } from "./layer.ts";

// The chance that a part works, from the chance of each part of its paths. Each part works or fails alone.

/** The options of `worksChance`. */
export interface ChanceOptions extends PathOptions {
  /** The largest count of steps of the calculation. The default is 1000000. */
  readonly maxSteps?: number | undefined;
}

/** The importance of one part for the chance that a different part works. */
export interface PartImportance {
  /** The `id` of the part. */
  readonly part: string;
  /** The Birnbaum importance: the chance when the part works, minus the chance when the part fails. */
  readonly importance: number;
}

/**
 * The result of `worksChance`.
 *
 * - `exact`: `value` is the chance that the part works. `importance` has the part and each part of its paths, from the
 *   largest importance. Parts with one importance are in the sequence of the stack, after the part itself. `assumed`
 *   has the parts of the paths with no chance record, in the sequence of the stack: the calculation uses the chance 1
 *   for each. The part itself is not in `assumed`. A part that cannot work has the value 0 and two empty lists.
 * - `budget`: the search of the paths or the calculation passed its limit, so the result has no value.
 */
export type WorksChance = { readonly kind: "exact"; readonly value: number; readonly importance: readonly PartImportance[]; readonly assumed: readonly string[] } | { readonly kind: "budget" };

/** This function compares two texts by their code units. The language of the computer does not change the result. */
function compareTexts(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * This function gives the chance that a part of a stack works.
 *
 * - The part works when each part of one of its path sets works, and the part itself works.
 * - Each part works or fails alone, with the chance of its record in the layer. A part with no record has the chance 1.
 * - A shared cause of failure is thus a part of the stack: a provider, an account or a power feed. Do not put it in a number.
 * - The value is exact: `pathSetReliability` of `@mark1russell7/collections/graph` counts a shared part one time.
 * - A part that does not work with the parts of `down` has the chance 0.
 * - The sequence of the parts of the stack does not change the value or an importance, to the last digit.
 *
 * The function is pure.
 *
 * @throws RangeError when a chance of a part of the paths is not from 0 to 1, or an option is not valid
 */
export function worksChance(layer: RiskLayer, stack: Stack, part: string, options: ChanceOptions = {}): WorksChance {
  const paths = pathSets(stack, part, options);
  if (paths.kind === "budget") return paths;
  if (paths.sets.length === 0) return { kind: "exact", value: 0, importance: [], assumed: [] };
  // The part itself is first: it is a part of each path. Then each part of the paths, in the sequence of the stack.
  const used = new Set(paths.sets.flat());
  const ids = [part, ...stack.parts.map((entry) => entry.id).filter((id, at, all) => id !== part && used.has(id) && all.indexOf(id) === at)];
  // The calculation gets the parts in one fixed order, the order of the texts of the ids.
  // Thus the sequence of the records of the stack does not change the last digits of the value.
  // The order of the path sets and of the parts of a set has no effect on the result of `pathSetReliability`.
  const fixed = [...ids].sort(compareTexts);
  const index = new Map(fixed.map((id, at) => [id, at]));
  const records = chancesByPart(layer);
  const chances = fixed.map((id) => records.get(id)?.works ?? 1);
  const sets = paths.sets.map((set) => [part, ...set].map((id) => index.get(id) ?? 0));
  const result = pathSetReliability(sets, chances, NUMBER_RING, options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps });
  if (result.kind === "budget") return { kind: "budget" };
  const importance = ids.map((id) => ({ part: id, importance: result.importance[index.get(id) ?? 0] ?? 0 })).sort((a, b) => b.importance - a.importance);
  return { kind: "exact", value: result.value, importance, assumed: ids.filter((id) => id !== part && !records.has(id)) };
}
