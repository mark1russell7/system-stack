import { minimumHittingSet } from "@mark1russell7/collections/graph";
import { anyCount, isAllOf, partNeeds, type Need, type Stack } from "./stack.ts";

// The paths of a part: the smallest sets of parts that let it work. Each query of risk reads them.
// A path is a statement about the structure of the stack. It reads no layer of an add-on.

/** The options of `pathSets`, `stopSets` and `smallestStop`. */
export interface PathOptions {
  /** The `id` of each part that does not work. No set has one of these parts. */
  readonly down?: Iterable<string> | undefined;
  /** The largest count of sets in one step of the search. It is a whole number from 1. The default is 4096. */
  readonly maxSets?: number | undefined;
}

/** The options of `stopSets`. */
export interface StopOptions extends PathOptions {
  /** The largest size of a set. It is a whole number from 0. The default is 1. */
  readonly size?: number | undefined;
}

/**
 * The result of `pathSets` and of `stopSets`.
 *
 * - `exact`: `sets` has each set. A set is a list of ids in the order of the parts of the stack.
 * - The sets come from the smallest to the largest. Two sets of one size are in the order of their parts.
 * - `budget`: the search passed `maxSets` before its end. The result has no sets, so it is not an answer.
 */
export type PartSets = { readonly kind: "exact"; readonly sets: readonly (readonly string[])[] } | { readonly kind: "budget" };

/**
 * The result of `smallestStop`.
 *
 * - `exact`: `parts` is a smallest set of parts that stops the part. It is empty when the part does not work.
 * - `none`: no set of other parts stops the part.
 * - `budget`: the search passed its limit before its end, so the result is not an answer.
 */
export type SmallestStop = { readonly kind: "exact"; readonly parts: readonly string[] } | { readonly kind: "none" } | { readonly kind: "budget" };

/** The default of `maxSets`. */
export const DEFAULT_MAX_SETS = 4096;

// A set of parts is a number: the bit `k` is the part at the position `k` of the reach of the root.
// A family is a list of sets, where no set has a different set of the list as a subset.
type Family = readonly bigint[];
const NEVER: Family = [];
const ALWAYS: Family = [0n];

/** The signal that a step of the search passed `maxSets`. */
const BUDGET = Symbol("budget");

/** This function keeps the smallest sets of a list: it removes each set that has a different set as a subset. */
function smallest(sets: readonly bigint[]): bigint[] {
  // A subset is not more than its superset, as numbers. Thus each subset of a set comes before it.
  const sorted = [...new Set(sets)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const kept: bigint[] = [];
  for (const set of sorted) if (!kept.some((small) => (small & set) === small)) kept.push(set);
  return kept;
}

/** This function gives the family of "the two families hold": each union of a set of `a` and a set of `b`. */
function both(a: Family, b: Family, maxSets: number): Family {
  if (a.length === 0 || b.length === 0) return NEVER;
  if (a.length === 1 && a[0] === 0n) return b;
  if (b.length === 1 && b[0] === 0n) return a;
  if (a.length * b.length > maxSets) throw BUDGET;
  const unions: bigint[] = [];
  for (const x of a) for (const y of b) unions.push(x | y);
  return smallest(unions);
}

/** This function gives the family of "one of the two families holds, or the two". */
function either(a: Family, b: Family, maxSets: number): Family {
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  if (a.length + b.length > maxSets) throw BUDGET;
  return smallest([...a, ...b]);
}

/** This function tells if two families are equal. The sets of a family are in the order of the numbers. */
function sameFamily(a: Family, b: Family): boolean {
  return a.length === b.length && a.every((set, index) => set === b[index]);
}

/** This function reads `maxSets` of the options. It throws a `RangeError` for a value that is not a whole number from 1. */
function readMaxSets(options: PathOptions): number {
  const maxSets = options.maxSets ?? DEFAULT_MAX_SETS;
  if (!Number.isInteger(maxSets) || maxSets < 1) throw new RangeError(`The option maxSets is ${String(maxSets)}: it is not a whole number from 1.`);
  return maxSets;
}

/** The reach of a root, and the path family of the root over the positions of the reach. */
interface Paths {
  /** The `id` of each part of the reach, in the order of the parts of the stack. The root is not in it. */
  readonly ids: readonly string[];
  readonly family: Family;
}

/**
 * This function gives the path family of a part. It is the smallest fixed point of the needs: the start is "no part
 * has a path", and each round gives each part the paths that its needs permit. Thus it agrees with `working`.
 */
function pathFamily(stack: Stack, root: string, options: PathOptions): Paths {
  const maxSets = readMaxSets(options);
  const off = new Set(options.down);
  const first = new Map<string, number>();
  stack.parts.forEach((part, index) => {
    if (!first.has(part.id)) first.set(part.id, index);
  });
  const rootIndex = first.get(root);
  if (rootIndex === undefined || off.has(root)) return { ids: [], family: NEVER };

  // The reach: each part that the root can need, through parts that are not down. The order has each part after
  // the parts that it needs, where the needs have no cycle. Thus one round is sufficient for a stack with no cycle.
  const order: number[] = [];
  const seen = new Set<number>([rootIndex]);
  const walk: { readonly index: number; readonly needs: readonly number[]; next: number }[] = [];
  const enter = (index: number): void => {
    const needs = partNeeds(stack.parts[index] ?? { id: "", kind: "" }).flatMap((id) => {
      const at = first.get(id);
      return at === undefined || off.has(id) ? [] : [at];
    });
    walk.push({ index, needs, next: 0 });
  };
  enter(rootIndex);
  for (let top = walk.at(-1); top !== undefined; top = walk.at(-1)) {
    const index = top.needs[top.next];
    top.next += 1;
    if (index === undefined) {
      order.push(top.index);
      walk.pop();
    } else if (!seen.has(index)) {
      seen.add(index);
      enter(index);
    }
  }

  const reach = order.filter((index) => index !== rootIndex).sort((a, b) => a - b);
  const bit = new Map<number, bigint>(reach.map((index, position) => [index, 1n << BigInt(position)]));
  const families = new Map<number, Family>();
  const ofPart = (id: string): Family => {
    const index = first.get(id);
    return index === undefined || off.has(id) ? NEVER : (families.get(index) ?? NEVER);
  };
  const ofNeed = (need: Need): Family => {
    if (typeof need === "string") return ofPart(need);
    if (isAllOf(need)) return need.all.reduce<Family>((family, item) => both(family, ofNeed(item), maxSets), ALWAYS);
    // The row `held` is the family of "`held` needs of the list so far hold, or more".
    const count = anyCount(need);
    if (Number.isNaN(count)) return NEVER;
    const wanted = Math.max(0, Math.ceil(count));
    if (wanted > need.any.length) return NEVER;
    let rows: Family[] = [ALWAYS, ...Array.from<Family>({ length: wanted }).fill(NEVER)];
    for (const item of need.any) {
      const family = ofNeed(item);
      rows = rows.map((row, held) => (held === 0 ? ALWAYS : either(row, both(rows[held - 1] ?? NEVER, family, maxSets), maxSets)));
    }
    return rows[wanted] ?? NEVER;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const index of order) {
      const part = stack.parts[index];
      if (part === undefined) continue;
      const needs = (part.needs ?? []).reduce<Family>((family, need) => both(family, ofNeed(need), maxSets), ALWAYS);
      const own = bit.get(index) ?? 0n;
      // A set has the part itself only when the needs go round to the part. Then the sets get a new examination.
      const round = needs.some((set) => (set & own) !== 0n);
      const family = own === 0n ? needs : round ? smallest(needs.map((set) => set | own)) : needs.map((set) => set | own);
      if (sameFamily(family, families.get(index) ?? NEVER)) continue;
      families.set(index, family);
      changed = true;
    }
  }
  return { ids: reach.map((index) => stack.parts[index]?.id ?? ""), family: families.get(rootIndex) ?? NEVER };
}

/** This function gives the positions of the bits of a set, from the lowest. */
function positions(set: bigint, size: number): number[] {
  const found: number[] = [];
  for (let position = 0; position < size; position += 1) if (((set >> BigInt(position)) & 1n) === 1n) found.push(position);
  return found;
}

/** This function gives the sets of a family as lists of ids, from the smallest set to the largest. */
function asLists(family: Family, ids: readonly string[]): string[][] {
  return family
    .map((set) => positions(set, ids.length))
    .sort((a, b) => {
      if (a.length !== b.length) return a.length - b.length;
      const at = a.findIndex((position, index) => position !== b[index]);
      return at < 0 ? 0 : (a[at] ?? 0) - (b[at] ?? 0);
    })
    .map((list) => list.map((position) => ids[position] ?? ""));
}

/**
 * This function gives the path sets of a part: each smallest set of other parts that lets the part work.
 *
 * - The part works when each part of one path set works, and each other part is down.
 * - No path set has a different path set as a subset. The part itself is in no set.
 * - A part with no needs has one path set, the empty set. A part that cannot work has no path set.
 * - A part that is down, or that is not in the stack, has no path set.
 * - The count of path sets can grow fast: 2 of 3 copies, 5 times in sequence, gives 243 sets.
 *
 * The function is pure. It agrees with `working` for each stack.
 *
 * @throws RangeError when `maxSets` is not a whole number from 1
 */
export function pathSets(stack: Stack, part: string, options: PathOptions = {}): PartSets {
  try {
    const paths = pathFamily(stack, part, options);
    return { kind: "exact", sets: asLists(paths.family, paths.ids) };
  } catch (signal) {
    if (signal === BUDGET) return { kind: "budget" };
    throw signal;
  }
}

/**
 * This function gives the stop sets of a part: each smallest set of other parts whose failure stops the part.
 *
 * - A stop set has one part of each path set, or more. The function gives each stop set of `size` parts or fewer.
 * - A stop set of one part is a single point of failure.
 * - No stop set has a different stop set as a subset. The part itself is in no set.
 * - The one stop set of a part that does not work is the empty set: no failure is necessary.
 * - A part with no needs has no stop set.
 *
 * The parts of `down` are down before the search. Thus the result shows the single points of failure that a
 * failure makes. The function is pure.
 *
 * @throws RangeError when `maxSets` is not a whole number from 1, or `size` is not a whole number from 0
 */
export function stopSets(stack: Stack, part: string, options: StopOptions = {}): PartSets {
  const size = options.size ?? 1;
  if (!Number.isInteger(size) || size < 0) throw new RangeError(`The option size is ${String(size)}: it is not a whole number from 0.`);
  const maxSets = readMaxSets(options);
  let paths: Paths;
  try {
    paths = pathFamily(stack, part, options);
  } catch (signal) {
    if (signal === BUDGET) return { kind: "budget" };
    throw signal;
  }
  // Each round adds one part to each set that does not stop the part: a part of the first path that the set does not hit.
  const found: bigint[] = [];
  let open: bigint[] = [0n];
  for (let round = 0; open.length > 0; round += 1) {
    const next = new Set<bigint>();
    for (const chosen of open) {
      const path = paths.family.find((set) => (set & chosen) === 0n);
      if (path === undefined) found.push(chosen);
      else if (round < size) {
        for (const position of positions(path, paths.ids.length)) {
          const grown = chosen | (1n << BigInt(position));
          if (!found.some((small) => (small & grown) === small)) next.add(grown);
        }
      }
    }
    // A set of this round can have a stop set of the same round as a subset only if they are equal.
    open = [...next].filter((set) => !found.some((small) => (small & set) === small));
    if (open.length > maxSets || found.length > maxSets) return { kind: "budget" };
  }
  return { kind: "exact", sets: asLists(found, paths.ids) };
}

/**
 * This function gives a smallest set of other parts whose failure stops a part. The count of its parts, minus 1, is
 * the count of failures that the part always survives.
 *
 * - The set comes from `minimumHittingSet` of `@mark1russell7/collections/graph`, on the path sets of the part.
 * - Two smallest sets can exist. The same stack gives the same set.
 *
 * The function is pure.
 *
 * @throws RangeError when `maxSets` is not a whole number from 1
 */
export function smallestStop(stack: Stack, part: string, options: PathOptions = {}): SmallestStop {
  const paths = pathSets(stack, part, options);
  if (paths.kind === "budget") return paths;
  const hit = minimumHittingSet<string>(paths.sets);
  // The result `none` tells that a path set is empty: the part works with no other part.
  if (hit.kind === "none") return { kind: "none" };
  if (hit.kind === "budget") return { kind: "budget" };
  const order = new Map<string, number>();
  stack.parts.forEach((entry, index) => {
    if (!order.has(entry.id)) order.set(entry.id, index);
  });
  return { kind: "exact", parts: [...hit.elements].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)) };
}
