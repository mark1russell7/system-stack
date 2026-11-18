import type { Stack } from "@mark1russell7/system-stack";

// The format of a placement layer: the slots of a stack, the candidates of each slot, the shared fragments and the limits.

/** The name of the format of a placement layer. It is the key of the layer in `Stack.layers`. */
export const PLACEMENT_SCHEMA = "placement/1";

/**
 * One candidate of a slot: a stack fragment that gives the part of the slot, and its cost.
 *
 * - The fragment has the part with the `id` of the slot, and each part that only this candidate has.
 * - The layers of the fragment give the records of its parts, for example the chances of `risk/1` and the costs of `spend/1`.
 * - A part of two or more candidates, for example a provider or a region, is in a shared fragment. The candidate names it in `uses`.
 */
export interface Candidate {
  /** The key of the candidate. Each candidate of a slot has a different key. A choice names the candidate with it. */
  readonly key: string;
  /** The stack fragment of the candidate. */
  readonly stack: Stack;
  /** The expected cost of the candidate in a month, in the currency of the layer. */
  readonly cost: number;
  /** The `id` of each shared fragment that the candidate needs. */
  readonly uses?: readonly string[] | undefined;
  /** The source of the candidate for a reader, for example the `id` of an offer. */
  readonly source?: string | undefined;
}

/** One slot of a stack: a part that the stack needs, and the candidates that can give it. */
export interface Slot {
  /** The `id` of the part of the slot. A part of the base stack names it in a need. */
  readonly id: string;
  /** The candidates of the slot. */
  readonly candidates: readonly Candidate[];
  /** With `true`, a choice can leave the slot empty. Then the stack has no part of the slot, and a need of that part does not hold. */
  readonly optional?: boolean | undefined;
}

/** A shared fragment: the parts that two or more candidates need, for example a provider, a region or an account. */
export interface Shared {
  /** The `id` of the fragment. A candidate names it in `uses`. */
  readonly id: string;
  /** The stack fragment with the shared parts and their layers. */
  readonly stack: Stack;
  /** The expected cost of the fragment in a month. A placed stack counts it one time. The default is 0. */
  readonly cost?: number | undefined;
}

/** The limits of a placement. A choice that breaks a limit is not on the front. */
export interface PlacementLimits {
  /** The largest expected cost of a month. */
  readonly cost?: number | undefined;
  /** The largest cost of a month from the spend layer of the placed stack. A service with no bound breaks this limit. */
  readonly bound?: number | undefined;
  /** The smallest chance that the part of the layer works, from 0 to 1. */
  readonly chance?: number | undefined;
}

/**
 * A placement layer: the slots of a stack, the candidates of each slot, and the limits.
 * A choice of one candidate for each slot gives one placed stack. `planPlacement` finds the best choices.
 */
export interface PlacementLayer {
  readonly schema: typeof PLACEMENT_SCHEMA;
  /** The `id` of the part to keep in work, for example a function of the system. It is a part of the base stack. */
  readonly part: string;
  /** The currency of each cost, for example `USD`. */
  readonly currency: string;
  /** The slots, in the order of the stages of the search. */
  readonly slots: readonly Slot[];
  /** The shared fragments. */
  readonly shared?: readonly Shared[] | undefined;
  /** The limits. */
  readonly limits?: PlacementLimits | undefined;
}

/**
 * A choice: the key of the candidate of each slot, by the `id` of the slot.
 * The value `null` leaves an optional slot empty. A slot that the choice does not name is also empty.
 */
export type Choice = Readonly<Record<string, string | null>>;
