import { type Objective, solveLexicographic } from "@mark1russell7/linear";
import { add, div, equals, mul, neg, ONE, type Rational, sign, toNumber, ZERO } from "@mark1russell7/rational";
import { type CaseOptions, caseDraws, caseStopped, drawDemand, storeAmounts } from "./endurance.ts";
import type { CaseCuts, Converter, EnduranceLayer, IsoDate } from "./layer.ts";
import { caseParts, deviceUse, drawBlock, fewestRow, Program, reachOf, valueAt } from "./program.ts";
import { addTo, dense, exact, type Row } from "./rows.ts";

// The joint days: the largest count of days that a set of draws holds together, with the best share of the stores.
// The query is a linear program over the totals of the span, with exact rationals (@mark1russell7/linear).

/** The joint days of a set of draws in a case, with the share of the stores at the optimum. */
export interface JointDays {
  readonly case: string;
  readonly at: IsoDate;
  /**
   * The largest count of days that each draw of `plan` holds at the same time. It is `Infinity` when `plan` is empty,
   * or when the stores give each draw of `plan` without end.
   */
  readonly days: number;
  /** The needs of the set that take from the stores: the case stops their supply, and their demand is more than 0. The order is the order of `caseDraws`. */
  readonly plan: readonly string[];
  /** The needs of the set that take nothing from the stores, in the order of their codes. The case does not stop their supply, or their demand is 0. */
  readonly holds: readonly string[];
  /**
   * The amount of each resource that each draw of `plan` takes from the stores in `days`. The keys are the code of the need, then the code of the resource.
   * A take through a converter that makes a resource counts the inputs of the converter. A resource with no take is not in the record.
   * The record is empty when `days` is `Infinity`.
   */
  readonly takes: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /**
   * The resources that limit `days`, in the order of their codes. Each one has a store in the layer, is an input of `plan` through each chain,
   * and has no stock left at the optimum. The list is empty when `days` is `Infinity`.
   */
  readonly binding: readonly string[];
  /** The count of runs of each converter at the optimum, by the `id` of the converter. A converter with no run is not in the record. */
  readonly runs: Readonly<Record<string, number>>;
  /**
   * The converters of the plan whose limit `perDay` stops more runs at the optimum, in the order of their `id`. A converter of the plan
   * gives a need of the plan, or makes an input of the plan through each chain.
   * The list is empty when `days` is `Infinity` or 0. Else it has each converter of the plan with a limit of 0.
   */
  readonly capped: readonly string[];
}

/**
 * This function gives the joint days of a set of draws. These are the largest count of days `d` at which each draw holds `d` days.
 * The draws hold at the same time, with the best share of the stores and of the runs of the converters.
 *
 * - The function solves a linear program over the totals of the span. Its variables are `d`, the take of each direct use,
 *   the runs of each converter, and the share of each stock.
 * - Each draw of the plan gets `d` times its demand (`drawDemand`) from its direct uses and from the converters that give its need.
 * - The takes of each resource are not more than its stock (`storeAmounts` at `at`) plus the gifts of the converters that make it.
 * - A converter whose device stops gives nothing, and a store whose part stops gives nothing, as in `enduranceOf`.
 * - The runs of a converter with a limit `perDay` are not more than `perDay` times `devices` times `d`. The converters of one device share it, as in `enduranceOf`.
 * - A store counts with all of its amount when its due date is after `at`, as in `enduranceOf`. A due date in the span has no effect.
 * - After the largest `d`, a second objective takes the smallest sum of the shares of the stocks. Thus the takes have no waste.
 * - A third objective takes the fewest device-days of the converters. Thus the runs are not more than the plan uses.
 * - The draws that are not in the set are outside this plan. They take nothing in the program.
 * - A need of the set whose supply works, or whose demand is 0, holds without end. It goes in `holds`, as `enduranceOf` leaves it out.
 *
 * The take order of `enduranceOf` gives the stores to a higher draw first. This function gives one share for the whole set.
 * Thus a draw of the set can get fewer days here than alone, and a lower draw can get more.
 *
 * The program uses exact rationals, so the result has no error of the method. Only the change back to a number rounds.
 *
 * @param layer - The endurance layer
 * @param caseCuts - The case
 * @param options - The date, and the stack or the parts that are also down
 * @param needs - The codes of the needs of the draws of the set
 * @returns The joint days, the takes of each draw, the binding resources and the runs of each converter
 * @throws {RangeError} A code of `needs` is not the need of a draw of the layer, or a date is not `YYYY-MM-DD`.
 */
export function jointDays(layer: EnduranceLayer, caseCuts: CaseCuts, options: CaseOptions, needs: readonly string[]): JointDays {
  const known = new Set(layer.draws.map((draw) => draw.need));
  const unknown = needs.filter((need) => !known.has(need));
  if (unknown.length > 0) throw new RangeError(`The needs ${unknown.map((need) => `"${need}"`).join(", ")} are not the needs of draws of the layer.`);
  const stoppedParts = caseStopped(caseCuts, options);
  const stock = storeAmounts(layer, options.at, stoppedParts);
  const wanted = new Set(needs);
  const plan = caseDraws(layer, caseCuts, stoppedParts).filter((draw) => wanted.has(draw.need));
  const planned = new Set(plan.map((draw) => draw.need));
  const base = { case: caseCuts.case, at: options.at, plan: plan.map((draw) => draw.need), holds: [...wanted].filter((need) => !planned.has(need)).sort() };
  const endless: JointDays = { ...base, days: Infinity, takes: {}, binding: [], runs: {}, capped: [] };
  if (plan.length === 0) return endless;

  const parts = caseParts(layer, stoppedParts, stock, planned);
  const program = new Program();
  const days = program.next();
  const blocks = plan.map((draw) => {
    const block = drawBlock(program, parts, draw);
    // The need of the draw: its gifts are not less than its demand times the days.
    const need: Row = new Map(block.gifts);
    addTo(need, days, neg(exact(drawDemand(draw, caseCuts))));
    program.push(need, ">=", ZERO);
    return block;
  });
  // The limit of each device: the runs use `devices` times `d` device-days or less. A limit of 0 stops the converter.
  const runCols = blocks.flatMap((block) => [...block.runs]);
  const { limits, stopped } = deviceUse(runCols);
  for (const index of stopped) program.push(new Map([[index, ONE]]), "<=", ZERO);
  for (const limit of limits.values()) {
    const row: Row = new Map(limit.row);
    addTo(row, days, neg(exact(limit.devices)));
    program.push(row, "<=", ZERO);
  }
  // The shares of each stock are not more than the stock.
  for (const resource of parts.stocked) {
    const row: Row = new Map();
    for (const block of blocks) addTo(row, block.shares.get(resource) as number, ONE);
    program.push(row, "<=", exact(stock.get(resource) ?? 0));
  }

  const most: Row = new Map([[days, ONE]]);
  const least: Row = new Map();
  for (const block of blocks) for (const [resource, index] of block.shares) addTo(least, index, div(ONE, exact(stock.get(resource) ?? 1)));
  // The third objective takes the fewest device-days. Thus a converter whose inputs cost no stock does not give more runs than the plan uses,
  // and `runs` and `capped` have one value.
  const objectives: Objective[] = [
    { sense: "max", coefficients: dense(most, program.count) },
    { sense: "min", coefficients: dense(least, program.count) },
    { sense: "min", coefficients: dense(fewestRow(runCols), program.count) },
  ];
  const solved = solveLexicographic(program.constraints(), objectives);
  // The point 0 is feasible and the later objectives are not less than 0. So only an unbounded first stage has no optimum.
  if (solved.status !== "optimal") return endless;

  const x = solved.x;
  const takes: Record<string, Record<string, number>> = {};
  for (const block of blocks) {
    const record: Record<string, number> = {};
    for (const [resource, index] of block.shares) if (sign(x[index] ?? ZERO) > 0) record[resource] = toNumber(x[index] ?? ZERO);
    takes[block.draw.need] = record;
  }
  // A converter gives a need or a resource, so it is a cook or a maker, not the two.
  const total = new Map<Converter, Rational>();
  for (const [converter, index] of runCols) total.set(converter, add(total.get(converter) ?? ZERO, x[index] ?? ZERO));
  const runs: Record<string, number> = {};
  for (const [converter, value] of total) if (sign(value) > 0) runs[converter.id] = toNumber(value);

  const withStore = new Set(layer.stores.map((store) => store.resource));
  // The converters that the plan can use: the converters that give a need of the plan, and the makers of the resources of the closure.
  const { closure, reach } = reachOf(parts, planned);
  const binding = [...closure]
    .filter((resource) => withStore.has(resource))
    .filter((resource) => {
      // A resource with no live stock has no share, so its take is 0 and it is used up.
      const taken = blocks.reduce((sum, block) => {
        const index = block.shares.get(resource);
        return index === undefined ? sum : add(sum, x[index] ?? ZERO);
      }, ZERO);
      return equals(taken, exact(stock.get(resource) ?? 0));
    })
    .sort();
  const best = solved.values[0] ?? ZERO;
  const capped = sign(best) > 0
    ? [
        ...[...total.keys()].filter((converter) => converter.perDay !== undefined && !(converter.perDay > 0)),
        ...[...limits.values()].filter((limit) => equals(valueAt(limit.row, x), mul(exact(limit.devices), best))).flatMap((limit) => limit.converters),
      ]
        .filter((converter) => reach.has(converter))
        .map((converter) => converter.id)
        .sort()
    : [];
  return { ...base, days: toNumber(best), takes, binding, runs, capped };
}
