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

/** This function gives the need that a converter gives, or `undefined` when it gives a resource. */
export function giftNeed(converter: Converter): string | undefined {
  return "need" in converter.gives ? converter.gives.need : undefined;
}

/** This function gives the resource that a converter gives, or `undefined` when it gives a need. */
export function giftResource(converter: Converter): string | undefined {
  return "resource" in converter.gives ? converter.gives.resource : undefined;
}

/** This function gives the amount of each resource that one run of a converter takes. Two lines of one resource add. */
function inputsOf(converter: Converter): Map<string, number> {
  const out = new Map<string, number>();
  for (const input of converter.takes) if (input.amount > 0) out.set(input.resource, (out.get(input.resource) ?? 0) + input.amount);
  return out;
}

/** This function tells if a converter can run in a case. Its device works, it takes a resource, and it gives an amount more than 0. */
function canRun(converter: Converter, stoppedParts: ReadonlySet<string>): boolean {
  return converter.gives.amount > 0 && inputsOf(converter).size > 0 && (converter.device === undefined || !stoppedParts.has(converter.device));
}

/** The converters of a case that make each resource, in the order of the layer, by the code of the resource. */
type Makers = ReadonlyMap<string, readonly Converter[]>;

function makersOf(layer: EnduranceLayer, stoppedParts: ReadonlySet<string>): Makers {
  const out = new Map<string, Converter[]>();
  for (const converter of layer.converters ?? []) {
    const resource = giftResource(converter);
    if (resource === undefined || !canRun(converter, stoppedParts)) continue;
    out.set(resource, [...(out.get(resource) ?? []), converter]);
  }
  return out;
}

/** The ways to get one need in a case: its direct uses, then the converters that give it, in the order of the layer. `makers` make the resources. */
interface Ways {
  readonly direct: readonly DirectUse[];
  readonly converters: readonly Converter[];
  readonly makers: Makers;
}

function waysOf(layer: EnduranceLayer, need: string, stoppedParts: ReadonlySet<string>, makers: Makers): Ways {
  return {
    direct: (layer.direct ?? []).filter((use) => use.need === need && use.amount > 0),
    converters: (layer.converters ?? []).filter((converter) => giftNeed(converter) === need && canRun(converter, stoppedParts)),
    makers,
  };
}

// A chain: the resources on the path of a take. A maker does not take a resource of its own path, so a cycle of the layer stops there.
const NO_PATH: ReadonlySet<string> = new Set();

/**
 * This function gives the most of a resource that `left` gives: its stock, and the runs of each maker.
 * It is an upper limit. When two inputs come from one resource, the true amount can be less.
 */
function mostResource(left: ReadonlyMap<string, number>, makers: Makers, resource: string, path: ReadonlySet<string>): number {
  let total = left.get(resource) ?? 0;
  if (path.has(resource)) return total;
  const next = new Set(path).add(resource);
  for (const maker of makers.get(resource) ?? []) total += mostRuns(left, makers, maker, next) * maker.gives.amount;
  return total;
}

/** This function gives the most runs of a converter that `left` gives. It is an upper limit, as for `mostResource`. */
function mostRuns(left: ReadonlyMap<string, number>, makers: Makers, converter: Converter, path: ReadonlySet<string>): number {
  let runs = Infinity;
  for (const [resource, each] of inputsOf(converter)) runs = Math.min(runs, mostResource(left, makers, resource, path) / each);
  return Number.isFinite(runs) ? runs : 0;
}

/**
 * This function takes an amount of a resource from `left`: the stock first, then the makers in the order of the layer.
 * It changes `left`, and it gives the amount that it could not take.
 */
function takeResource(left: Map<string, number>, makers: Makers, resource: string, amount: number, path: ReadonlySet<string>): number {
  const has = left.get(resource) ?? 0;
  const got = Math.min(amount, has);
  left.set(resource, has - got);
  let rest = amount - got;
  if (rest <= 0 || path.has(resource)) return Math.max(0, rest);
  const next = new Set(path).add(resource);
  for (const maker of makers.get(resource) ?? []) {
    if (rest <= 0) break;
    rest -= run(left, makers, maker, rest / maker.gives.amount, next) * maker.gives.amount;
  }
  return Math.max(0, rest);
}

/**
 * This function runs a converter up to `wanted` times with the resources of `left`, and it gives the count of runs.
 * It changes `left`. When two inputs come from one resource, a bisection finds the runs that the resources give.
 */
function run(left: Map<string, number>, makers: Makers, converter: Converter, wanted: number, path: ReadonlySet<string>): number {
  const inputs = inputsOf(converter);
  const most = Math.min(wanted, mostRuns(left, makers, converter, path));
  if (!(most > 0)) return 0;
  const attempt = (runs: number): Map<string, number> | undefined => {
    const copy = new Map(left);
    let need = 0;
    let short = 0;
    for (const [resource, each] of inputs) {
      need += runs * each;
      short += takeResource(copy, makers, resource, runs * each, path);
    }
    return short <= TOLERANCE * need ? copy : undefined;
  };
  let runs = most;
  let best = attempt(most);
  if (best === undefined) {
    let low = 0;
    let high = most;
    for (let step = 0; step < 200 && high - low > TOLERANCE * high; step += 1) {
      const mid = (low + high) / 2;
      const tried = attempt(mid);
      if (tried === undefined) high = mid;
      else {
        low = mid;
        best = tried;
      }
    }
    runs = low;
  }
  if (best === undefined) return 0;
  for (const [resource, amount] of best) left.set(resource, amount);
  return runs;
}

/**
 * This function takes an amount of a need from the resources in `left`: the direct uses first, then the converters.
 * A direct use or a converter takes each resource from its stock first, then from its makers.
 * It changes `left`, and it gives the amount that it could not take.
 */
function take(left: Map<string, number>, ways: Ways, amount: number): number {
  let rest = amount;
  for (const use of ways.direct) {
    if (rest <= 0) break;
    const wanted = rest / use.amount;
    rest -= (wanted - takeResource(left, ways.makers, use.resource, wanted, NO_PATH)) * use.amount;
  }
  for (const converter of ways.converters) {
    if (rest <= 0) break;
    rest -= run(left, ways.makers, converter, rest / converter.gives.amount, NO_PATH) * converter.gives.amount;
  }
  return Math.max(0, rest);
}

/** This function gives each resource that a need can use: the inputs of its ways, and the inputs of their makers, through each chain. */
function inputClosure(ways: Ways): Set<string> {
  const out = new Set<string>();
  const queue = [...ways.direct.map((use) => use.resource), ...ways.converters.flatMap((converter) => [...inputsOf(converter).keys()])];
  for (let resource = queue.shift(); resource !== undefined; resource = queue.shift()) {
    if (out.has(resource)) continue;
    out.add(resource);
    for (const maker of ways.makers.get(resource) ?? []) queue.push(...inputsOf(maker).keys());
  }
  return out;
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
 * - A converter can give a resource. A take of a resource uses the stock first, then the converters that make it, through each chain.
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
  const makers = makersOf(layer, stoppedParts);
  const done: { readonly ways: Ways; readonly demand: number; readonly days: number }[] = [];
  const needs: Record<string, { days: number; binding: string[]; takes: Record<string, number> }> = {};
  for (const draw of caseDraws(layer, caseCuts, stoppedParts)) {
    const ways = waysOf(layer, draw.need, stoppedParts, makers);
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
    const binding = [...inputClosure(ways)].filter((resource) => mostResource(left, makers, resource, NO_PATH) <= USED_UP * Math.max(1, start.get(resource) ?? 0)).sort();
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

/**
 * This function gives an upper limit of a need that the stores give with no other draw, through each chain.
 * A converter that takes nothing gives nothing: the gate refuses it.
 */
function capacity(start: ReadonlyMap<string, number>, ways: Ways): number {
  let total = 0;
  for (const use of ways.direct) total += mostResource(start, ways.makers, use.resource, NO_PATH) * use.amount;
  for (const converter of ways.converters) total += mostRuns(start, ways.makers, converter, NO_PATH) * converter.gives.amount;
  return total;
}
