import { dayNumber, stopped, type Stack } from "@mark1russell7/system-stack";
import type { CaseCuts, Converter, DirectUse, Draw, Endurance, EnduranceLayer, IsoDate } from "./layer.ts";

// The endurance query: the days that each draw holds when a case stops its supply.

/** The options of the queries of a case. */
export interface CaseOptions {
  /** The date of the query. A store whose due date is on this date or before it gives nothing. */
  readonly at: IsoDate;
  /** The base stack. With it, a cut also stops each part that cannot work without a cut part (`stopped` of the core). */
  readonly stack?: Stack | undefined;
  /** The `id` of more parts that are down, with the cuts of the case. */
  readonly down?: readonly string[] | undefined;
}

/**
 * This function gives the `id` of each part that does not work in a case: the cut parts and the parts of `down`.
 * With a stack, it also gives each part that stops.
 */
export function caseStopped(caseCuts: CaseCuts, options: Pick<CaseOptions, "stack" | "down">): Set<string> {
  const down = [...caseCuts.cuts.map((cut) => cut.part), ...(options.down ?? [])];
  const out = new Set(down);
  if (options.stack !== undefined) for (const id of stopped(options.stack, down)) out.add(id);
  return out;
}

/** This function gives the day number of a date, or throws a `RangeError` for a date that is not `YYYY-MM-DD`. */
function dayOf(date: IsoDate): number {
  const day = dayNumber(date);
  if (day === undefined) throw new RangeError(`The date "${date}" is not a date YYYY-MM-DD.`);
  return day;
}

/**
 * This function gives the amount of each resource in the stores at a date, by the code of the resource.
 *
 * - A store gives nothing on its due date and after it.
 * - A store gives nothing when its part is in `stoppedParts`.
 */
export function storeAmounts(layer: EnduranceLayer, at: IsoDate, stoppedParts: ReadonlySet<string> = new Set()): Map<string, number> {
  const today = dayOf(at);
  const out = new Map<string, number>();
  for (const store of layer.stores) {
    if (store.due !== undefined && today >= dayOf(store.due)) continue;
    if (store.part !== undefined && stoppedParts.has(store.part)) continue;
    out.set(store.resource, (out.get(store.resource) ?? 0) + store.amount);
  }
  return out;
}

/** This function gives the amount of a need for each day in a case: the rate of the draw times the factor of the case. */
export function drawDemand(draw: Draw, caseCuts: CaseCuts): number {
  return draw.perDay * (caseCuts.factors?.[draw.need] ?? 1);
}

/**
 * This function gives the draws that take from the stores in a case: each draw whose supply stops, with a demand more than 0.
 * The sequence is by the level (the order of `levels`), then by the code of the need.
 */
export function caseDraws(layer: EnduranceLayer, caseCuts: CaseCuts, stoppedParts: ReadonlySet<string>): Draw[] {
  const rank = (level: string): number => {
    const index = layer.levels.indexOf(level);
    return index < 0 ? layer.levels.length : index;
  };
  return layer.draws
    .filter((draw) => stoppedParts.has(draw.supply) && drawDemand(draw, caseCuts) > 0)
    .sort((a, b) => rank(a.level) - rank(b.level) || (a.need < b.need ? -1 : a.need > b.need ? 1 : 0));
}

/** The ways to get one need: its direct uses, then the converters whose device works, each in the order of the layer. */
interface Ways {
  readonly direct: readonly DirectUse[];
  readonly converters: readonly Converter[];
}

function waysOf(layer: EnduranceLayer, need: string, stoppedParts: ReadonlySet<string>): Ways {
  return {
    direct: (layer.direct ?? []).filter((use) => use.need === need && use.amount > 0),
    converters: (layer.converters ?? []).filter(
      (converter) => converter.gives.need === need && converter.gives.amount > 0 && (converter.device === undefined || !stoppedParts.has(converter.device)),
    ),
  };
}

/** This function gives the amount of each resource that one run of a converter takes. Two lines of one resource add. */
function inputsOf(converter: Converter): Map<string, number> {
  const out = new Map<string, number>();
  for (const input of converter.takes) if (input.amount > 0) out.set(input.resource, (out.get(input.resource) ?? 0) + input.amount);
  return out;
}

/**
 * This function takes an amount of a need from the resources in `left`: the direct uses first, then the converters.
 * It changes `left`, and it gives the amount that it could not take.
 */
function take(left: Map<string, number>, ways: Ways, amount: number): number {
  let rest = amount;
  for (const use of ways.direct) {
    if (rest <= 0) break;
    const has = left.get(use.resource) ?? 0;
    const got = Math.min(rest, has * use.amount);
    left.set(use.resource, has - got / use.amount);
    rest -= got;
  }
  for (const converter of ways.converters) {
    if (rest <= 0) break;
    const inputs = inputsOf(converter);
    if (inputs.size === 0) continue;
    let runs = rest / converter.gives.amount;
    for (const [resource, each] of inputs) runs = Math.min(runs, (left.get(resource) ?? 0) / each);
    for (const [resource, each] of inputs) left.set(resource, (left.get(resource) ?? 0) - runs * each);
    rest -= runs * converter.gives.amount;
  }
  return Math.max(0, rest);
}

/** The relative tolerance of a take and of the bisection. */
const TOLERANCE = 1e-13;

/** The relative tolerance of a used-up resource. */
const USED_UP = 1e-9;

/**
 * This function gives the days that each draw holds when a case stops its supply, and the resources that are used up then.
 *
 * - A draw takes from the stores only when the case stops its supply part. Each other draw holds without end, and the result leaves it out.
 * - The demand of a draw for each day is its rate times the factor of the case.
 * - The draws take the resources in the order of their level, then of their codes. A draw takes from its direct uses first, then from its converters.
 * - The days of a draw are the largest `T` at which the stores give `T` days of its demand, after each higher draw.
 * - Each higher draw keeps back its own days times its demand. Thus the takes of all the draws are not more than the stores at any time.
 * - The take order is a rule, not the best share: the direct uses in the order of the list, then the converters. The days are the days of this order.
 * - A converter whose device stops gives nothing. A store whose part stops gives nothing.
 *
 * The function is pure. It throws a `RangeError` for a date that is not `YYYY-MM-DD`. The gate `checkEndurance` examines the layer before.
 *
 * @param layer - The endurance layer
 * @param caseCuts - The case
 * @param options - The date, and the stack or the parts that are also down
 * @returns The endurance of each draw whose supply stops
 */
export function enduranceOf(layer: EnduranceLayer, caseCuts: CaseCuts, options: CaseOptions): Endurance {
  const stoppedParts = caseStopped(caseCuts, options);
  const start = storeAmounts(layer, options.at, stoppedParts);
  const done: { readonly ways: Ways; readonly demand: number; readonly days: number }[] = [];
  const needs: Record<string, { days: number; binding: string[]; takes: Record<string, number> }> = {};
  for (const draw of caseDraws(layer, caseCuts, stoppedParts)) {
    const ways = waysOf(layer, draw.need, stoppedParts);
    const demand = drawDemand(draw, caseCuts);
    const before = new Map(start);
    for (const higher of done) take(before, higher.ways, higher.days * higher.demand);
    const after = (days: number): { left: Map<string, number>; short: number } => {
      const left = new Map(before);
      return { left, short: take(left, ways, days * demand) };
    };
    const fits = (days: number): boolean => after(days).short <= TOLERANCE * days * demand;
    // The upper limit: the days that the draw holds when it takes all the stores itself. A bisection finds the days below it.
    let high = capacity(start, ways) / demand;
    let low = 0;
    if (fits(high)) low = high;
    else
      for (let step = 0; step < 200 && high - low > TOLERANCE * high; step += 1) {
        const mid = (low + high) / 2;
        if (fits(mid)) low = mid;
        else high = mid;
      }
    const { left } = after(low);
    const inputs = new Set([...ways.direct.map((use) => use.resource), ...ways.converters.flatMap((converter) => converter.takes.map((input) => input.resource))]);
    const binding = [...inputs].filter((resource) => (left.get(resource) ?? 0) <= USED_UP * Math.max(1, start.get(resource) ?? 0)).sort();
    const takes: Record<string, number> = {};
    for (const [resource, amount] of before) {
      const taken = amount - (left.get(resource) ?? 0);
      if (taken > 0) takes[resource] = taken;
    }
    needs[draw.need] = { days: low, binding, takes };
    done.push({ ways, demand, days: low });
  }
  return { case: caseCuts.case, at: options.at, needs };
}

/** This function gives the most of a need that the stores give with no other draw. A converter that takes nothing gives nothing: the gate refuses it. */
function capacity(start: ReadonlyMap<string, number>, ways: Ways): number {
  let total = 0;
  for (const use of ways.direct) total += (start.get(use.resource) ?? 0) * use.amount;
  for (const converter of ways.converters) {
    let runs = Infinity;
    for (const [resource, each] of inputsOf(converter)) runs = Math.min(runs, (start.get(resource) ?? 0) / each);
    if (Number.isFinite(runs)) total += runs * converter.gives.amount;
  }
  return total;
}
