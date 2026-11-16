// The records of a system stack. A stack is one JSON document: a list of parts, and the layers of the add-ons.
// The core names no topic. A cost, a chance of failure and a cloud resource are records of an add-on layer.

/** The name of the format of a stack document. */
export const STACK_SCHEMA = "stack/1";

/** A need that holds when each need of its list holds. An empty list holds. */
export interface AllOf {
  readonly all: readonly Need[];
}

/**
 * A need that holds when `count` needs of its list hold, or more.
 * Thus 2 of 3 copies is `{ any: ["a", "b", "c"], count: 2 }`.
 */
export interface AnyOf {
  readonly any: readonly Need[];
  /** The smallest count of the needs of the list that hold. The default is 1. */
  readonly count?: number | undefined;
}

/**
 * A need of a part. A text is the `id` of a part: the need holds when that part works.
 * A need can also be a list with `all`, or a list with `any` and a count.
 */
export type Need = string | AllOf | AnyOf;

/**
 * A part of a system: anything that a function of the system needs.
 *
 * - A service, a host, a network, a power feed, a person and a secret are parts.
 * - A shared cause of failure is also a part: a provider, a region, an account, a payment card or a building.
 * - A function of the system is a part too, for example "an alert gets to its reader".
 */
export interface Part {
  readonly id: string;
  /** The kind of the part, as one word. The core keeps no list of kinds: an add-on or a query selects parts by kind. */
  readonly kind: string;
  /** The name of the part for a person. */
  readonly name?: string | undefined;
  /** The needs of the part. The part works when each one holds. A part with no needs works. */
  readonly needs?: readonly Need[] | undefined;
  /** The `id` of the part that owns this part, for example a person or a team. */
  readonly owner?: string | undefined;
}

/** A stack document: the parts of a system, and the layers of the add-ons. */
export interface Stack {
  readonly schema: typeof STACK_SCHEMA;
  readonly parts: readonly Part[];
  /** The layers of the add-ons. The key of a layer is the name of its format, for example `spend/1`. */
  readonly layers?: Readonly<Record<string, unknown>> | undefined;
}

/** This function tells if a need is a list with `all`. */
export function isAllOf(need: Need): need is AllOf {
  return typeof need !== "string" && "all" in need;
}

/** This function gives the smallest count of an `any` need that holds: its field `count`, or 1. */
export function anyCount(need: AnyOf): number {
  return need.count ?? 1;
}

/** This function gives the `id` of each part that a need names, in the order of the need. An `id` can come two times. */
export function needParts(need: Need): string[] {
  if (typeof need === "string") return [need];
  return (isAllOf(need) ? need.all : need.any).flatMap(needParts);
}

/** This function gives the `id` of each part that the needs of a part name. Each `id` comes one time. */
export function partNeeds(part: Part): string[] {
  return [...new Set((part.needs ?? []).flatMap(needParts))];
}

/** This function gives the parts of a stack by their `id`. For an `id` that two parts have, it keeps the first part. */
export function partsById(stack: Stack): Map<string, Part> {
  const parts = new Map<string, Part>();
  for (const part of stack.parts) if (!parts.has(part.id)) parts.set(part.id, part);
  return parts;
}
