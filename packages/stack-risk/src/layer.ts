// The records of the risk add-on. They are one layer of a stack, with the key `risk/1` in `Stack.layers`.
// A goal tells how many failures a part must survive. The answers are queries over the stack: the layer keeps no list of risks.

/** The name of the format of a risk layer. It is the key of the layer in `Stack.layers`. */
export const RISK_SCHEMA = "risk/1";

/** The goal of one part of the stack, for example of a function of the system. */
export interface Goal {
  /** The `id` of the part with the goal. */
  readonly part: string;
  /**
   * The count of failures of other parts that the part survives. It is a whole number from 0.
   * With 1, no failure of one part stops the part: it has no single point of failure.
   */
  readonly survives: number;
  /** The smallest chance that the part works, from 0 to 1. The gate then needs the chance of each part of its paths. */
  readonly chance?: number | undefined;
}

/** The chance that one part works. */
export interface Chance {
  /** The `id` of the part. */
  readonly part: string;
  /** The chance that the part works at a moment, from 0 to 1, when each of its needs holds. */
  readonly works: number;
  /** The source of the number, for example the service agreement of a provider or a measured period. */
  readonly source?: string | undefined;
}

/** An accepted risk: one set of parts whose failure stops a part, which the owner accepts for a reason. */
export interface Accepted {
  /** The `id` of the part with the goal. */
  readonly part: string;
  /** The parts of the set, in any sequence. Their failure together stops the part. */
  readonly stop: readonly string[];
  /** The reason of the owner. */
  readonly reason: string;
  /** The last date of the acceptance, as `YYYY-MM-DD`. After that date the gate fails for the set. An acceptance without it has no end. */
  readonly until?: string | undefined;
}

/** A risk layer: the goals of the parts of a stack, the chance of each part, and the accepted risks. */
export interface RiskLayer {
  readonly schema: typeof RISK_SCHEMA;
  readonly goals: readonly Goal[];
  readonly chances?: readonly Chance[] | undefined;
  readonly accepted?: readonly Accepted[] | undefined;
}

/** This function gives the first goal of each part of a layer, in the sequence of the records. */
export function firstGoals(layer: RiskLayer): readonly Goal[] {
  const seen = new Set<string>();
  return layer.goals.filter((goal) => {
    if (seen.has(goal.part)) return false;
    seen.add(goal.part);
    return true;
  });
}

/** This function gives the chance record of each part of a layer, by the `id` of the part. The first record of a part is used. */
export function chancesByPart(layer: RiskLayer): Map<string, Chance> {
  const chances = new Map<string, Chance>();
  for (const chance of layer.chances ?? []) if (!chances.has(chance.part)) chances.set(chance.part, chance);
  return chances;
}

/** This function tells if a value is a chance: a number from 0 to 1. */
export function isChance(value: number): boolean {
  return value >= 0 && value <= 1;
}
