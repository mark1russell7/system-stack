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
  /**
   * The limit of time of the chance, in seconds from the event. With it, a part works only when it also ends its work
   * within the limit. A goal with a limit of time needs a chance.
   */
  readonly within?: number | undefined;
}

/** A point of the distribution of a time: the chance that the time is `within` seconds or less. */
export interface DelayPoint {
  /** The time in seconds, from 0. */
  readonly within: number;
  /** The chance that the time is `within` seconds or less, from 0 to 1. */
  readonly chance: number;
}

/** The chance that one part works. */
export interface Chance {
  /** The `id` of the part. */
  readonly part: string;
  /** The chance that the part works at a moment, from 0 to 1, when each of its needs holds. */
  readonly works: number;
  /** The source of the number, for example the service agreement of a provider or a measured period. */
  readonly source?: string | undefined;
  /** The wait of the part before it starts, in seconds, for example the wait of the rank of a copy. The default is 0. */
  readonly wait?: number | undefined;
  /**
   * The distribution of the time from the end of the wait to the end of the work of the part, when the part works. The
   * times of the points increase, and their chances do not decrease. No points tell a time of 0.
   */
  readonly delay?: readonly DelayPoint[] | undefined;
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

/**
 * This function gives the chance that a part ends its work within `within` seconds of the event, when the part works.
 *
 * - The part waits for its `wait`, then it ends after its delay.
 * - Between two points of the delay, the chance is the chance of the lower point. Thus the chance is a lower bound.
 * - With no record or no points, the delay is 0. With `Infinity`, the chance is the chance of the last point.
 * - Without a limit of time, the chance is 1: the time has no effect.
 */
export function inTimeChance(chance: Chance | undefined, within: number | undefined): number {
  if (within === undefined) return 1;
  const left = within - (chance?.wait ?? 0);
  if (left < 0) return 0;
  const points = chance?.delay ?? [];
  if (points.length === 0) return 1;
  let found = 0;
  for (const point of points) if (point.within <= left) found = point.chance;
  return found;
}

/** This function gives the first fault of the wait and of the delay points of a chance record, or `undefined`. */
export function delayFault(chance: Chance): string | undefined {
  const { part, wait } = chance;
  if (wait !== undefined && !(wait >= 0 && Number.isFinite(wait))) return `The wait ${String(wait)} of "${part}" is not a time of 0 or more.`;
  let last = -1;
  let lastChance = 0;
  for (const [index, point] of (chance.delay ?? []).entries()) {
    const what = `The delay point ${String(index)} of "${part}"`;
    if (!(point.within >= 0 && Number.isFinite(point.within))) return `${what} has the time ${String(point.within)}, which is not a time of 0 or more.`;
    if (point.within <= last) return `${what} is not after the point before it.`;
    if (!isChance(point.chance)) return `${what} has the chance ${String(point.chance)}, which is not from 0 to 1.`;
    if (point.chance < lastChance) return `${what} has a chance less than the chance of the point before it.`;
    last = point.within;
    lastChance = point.chance;
  }
  return undefined;
}
