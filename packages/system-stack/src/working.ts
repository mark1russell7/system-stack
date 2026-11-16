import { anyCount, isAllOf, partNeeds, type Need, type Stack } from "./stack.ts";

// The question "which parts work?" as a calculation. It is the base of each query of risk: a query takes parts
// down and reads what still works.

/** This function tells if a need holds with a set of the parts that work. */
export function needHolds(need: Need, up: ReadonlySet<string>): boolean {
  if (typeof need === "string") return up.has(need);
  if (isAllOf(need)) return need.all.every((item) => needHolds(item, up));
  let count = 0;
  for (const item of need.any) if (needHolds(item, up)) count += 1;
  return count >= anyCount(need);
}

/**
 * This function gives the `id` of each part that works when the parts of `down` do not work.
 *
 * - A part works when it is not down and each of its needs holds.
 * - The start is a stack where no part works. A part with no needs works first, and each step adds the parts that it permits.
 * - Thus two parts that need each other do not work: none of the two can start.
 * - A need that names no part of the stack does not hold.
 *
 * The cost is linear in the size of the needs for each part that a need names.
 * The function is pure. It does not change its arguments.
 *
 * @param stack - The stack. The result is correct for a stack with no fault of `checkStack`.
 * @param down - The `id` of each part that does not work.
 * @returns The `id` of each part that works, in the order in which the parts start.
 */
export function working(stack: Stack, down: Iterable<string> = []): Set<string> {
  const off = new Set(down);
  const up = new Set<string>();
  // The parts that name a part in their needs: when that part starts, each of them gets a new examination.
  const dependents = new Map<string, number[]>();
  stack.parts.forEach((part, index) => {
    for (const id of partNeeds(part)) {
      const list = dependents.get(id);
      if (list === undefined) dependents.set(id, [index]);
      else list.push(index);
    }
  });
  const queued = new Set<number>();
  const queue: number[] = [];
  const examine = (index: number): void => {
    const part = stack.parts[index];
    if (part === undefined || queued.has(index) || off.has(part.id) || up.has(part.id)) return;
    if (!(part.needs ?? []).every((need) => needHolds(need, up))) return;
    queued.add(index);
    queue.push(index);
  };
  stack.parts.forEach((_, index) => examine(index));
  for (let next = 0; next < queue.length; next += 1) {
    const part = stack.parts[queue[next] ?? -1];
    if (part === undefined || up.has(part.id)) continue;
    up.add(part.id);
    for (const index of dependents.get(part.id) ?? []) examine(index);
  }
  return up;
}

/** This function tells if a part works when the parts of `down` do not work. Refer to `working`. */
export function works(stack: Stack, part: string, down: Iterable<string> = []): boolean {
  return working(stack, down).has(part);
}
