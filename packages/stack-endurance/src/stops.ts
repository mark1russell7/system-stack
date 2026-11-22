import { DEFAULT_MAX_SETS, stopSets, type Stack } from "@mark1russell7/system-stack";

// The minimal stop sets of a supply from the structure of the needs. The index does not give this entry: `stopCurves` uses it.

/**
 * This function gives the minimal sets of cuts that stop a supply, from the paths of the needs of the stack (`stopSets` of the core).
 * A set is a list of indexes of `parts`, from the smallest set. Two sets of one size are in the order of `minimalStops`.
 *
 * - `parts` has the part of each cut that counts. Two cuts of one part are two cuts: each one stops what the part stops.
 * - A cut of the supply stops it alone. The other sets come from `stopSets` with the cut parts as `among`, so no other part can fail.
 * - The parts of `down` are down for the full event. The caller makes sure that they do not stop the supply with no cut.
 * - The result is `undefined` when the search passes its budget, or when the sets of cuts are more than `DEFAULT_MAX_SETS`.
 *
 * @param stack - The base stack
 * @param supply - The part of the supply of a draw
 * @param parts - The part of each cut that counts
 * @param down - The parts that are down for the full event
 */
export function stackStops(stack: Stack, supply: string, parts: readonly string[], down: readonly string[] = []): number[][] | undefined {
  const cutsOf = new Map<string, number[]>();
  for (const [index, part] of parts.entries()) cutsOf.set(part, [...(cutsOf.get(part) ?? []), index]);
  const own = (cutsOf.get(supply) ?? []).map((index) => [index]);
  const among = [...cutsOf.keys()].filter((part) => part !== supply);
  const found = stopSets(stack, supply, { down, among, size: among.length });
  if (found.kind === "budget") return undefined;
  // The empty set: the supply does not work in the base stack, or it is not in it. Then only a cut of the supply stops it.
  if (found.sets.some((set) => set.length === 0)) return own;
  const out = [...own];
  for (const set of found.sets) {
    // Each choice of one cut for each part of the set is a minimal set of cuts.
    let choices: number[][] = [[]];
    for (const part of set) {
      const cuts = cutsOf.get(part) ?? [];
      if (choices.length * cuts.length + out.length > DEFAULT_MAX_SETS) return undefined;
      choices = choices.flatMap((choice) => cuts.map((cut) => [...choice, cut]));
    }
    out.push(...choices.map((choice) => choice.sort((x, y) => x - y)));
  }
  return out.sort(byMask);
}

/** The order of `minimalStops`: the smaller set first, then the set whose largest different index is smaller. */
function byMask(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let index = a.length - 1; index >= 0; index -= 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
