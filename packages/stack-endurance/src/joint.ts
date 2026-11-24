import { type Constraint, type Objective, solveLexicographic } from "@mark1russell7/linear";
import { add, div, equals, fromFloat, neg, ONE, type Rational, sign, toNumber, ZERO } from "@mark1russell7/rational";
import { canRun, inputsOf } from "./converter.ts";
import { type CaseOptions, caseDraws, caseStopped, drawDemand, giftNeed, giftResource, storeAmounts } from "./endurance.ts";
import type { CaseCuts, Converter, EnduranceLayer, IsoDate } from "./layer.ts";

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
}

/** A sparse row: the coefficient of each variable, by its index. */
type Row = Map<number, Rational>;

function addTo(row: Row, index: number, value: Rational): void {
  row.set(index, add(row.get(index) ?? ZERO, value));
}

function dense(row: Row, count: number): Rational[] {
  const out = new Array<Rational>(count).fill(ZERO);
  for (const [index, value] of row) out[index] = value;
  return out;
}

/** This function gives the exact rational of a finite double, with no rounding. A double is a dyadic rational. */
const exact = (value: number): Rational => fromFloat(value);

/**
 * This function gives the joint days of a set of draws. These are the largest count of days `d` at which each draw holds `d` days.
 * The draws hold at the same time, with the best share of the stores and of the runs of the converters.
 *
 * - The function solves a linear program over the totals of the span. Its variables are `d`, the take of each direct use,
 *   the runs of each converter, and the share of each stock.
 * - Each draw of the plan gets `d` times its demand (`drawDemand`) from its direct uses and from the converters that give its need.
 * - The takes of each resource are not more than its stock (`storeAmounts` at `at`) plus the gifts of the converters that make it.
 * - A converter whose device stops gives nothing, and a store whose part stops gives nothing, as in `enduranceOf`.
 * - A store counts with all of its amount when its due date is after `at`, as in `enduranceOf`. A due date in the span has no effect.
 * - After the largest `d`, a second objective takes the smallest sum of the shares of the stocks. Thus the takes have no waste.
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
  const endless: JointDays = { ...base, days: Infinity, takes: {}, binding: [], runs: {} };
  if (plan.length === 0) return endless;

  const direct = (layer.direct ?? []).filter((use) => planned.has(use.need) && use.amount > 0);
  const live = (layer.converters ?? []).filter((converter) => canRun(converter, stoppedParts));
  const cooks = live.filter((converter) => planned.has(giftNeed(converter) ?? ""));
  const makers = live.filter((converter) => giftResource(converter) !== undefined);
  const resources = new Set<string>([...direct.map((use) => use.resource), ...[...cooks, ...makers].flatMap((converter) => [...inputsOf(converter).keys()])]);
  for (const maker of makers) resources.add(giftResource(maker) ?? "");
  const stocked = [...resources].filter((resource) => (stock.get(resource) ?? 0) > 0).sort();

  // The variables: the days, the take of each direct use, the runs of each converter that gives a need of the plan,
  // and for each draw of the plan the runs of each maker and the share of each stock. The shares tell the takes of each draw.
  let count = 0;
  const next = (): number => count++;
  const days = next();
  const useCol = direct.map(next);
  const cookCol = cooks.map(next);
  const makerCol = plan.map(() => makers.map(next));
  const shareCol = plan.map(() => new Map(stocked.map((resource) => [resource, next()] as const)));

  const rows: { readonly row: Row; readonly relation: Constraint["relation"]; readonly rhs: Rational }[] = [];
  plan.forEach((draw, i) => {
    // The need of the draw: its gifts are not less than its demand times the days.
    const need: Row = new Map([[days, neg(exact(drawDemand(draw, caseCuts)))]]);
    direct.forEach((use, k) => {
      if (use.need === draw.need) addTo(need, useCol[k] as number, exact(use.amount));
    });
    cooks.forEach((cook, c) => {
      if (giftNeed(cook) === draw.need) addTo(need, cookCol[c] as number, exact(cook.gives.amount));
    });
    rows.push({ row: need, relation: ">=", rhs: ZERO });
    // The balance of each resource of the draw: its takes are not more than its share of the stock plus the gifts of its makers.
    const balance = new Map<string, Row>([...resources].map((resource) => [resource, new Map()]));
    const consume = (resource: string, index: number, amount: Rational): void => addTo(balance.get(resource) as Row, index, amount);
    direct.forEach((use, k) => {
      if (use.need === draw.need) consume(use.resource, useCol[k] as number, ONE);
    });
    cooks.forEach((cook, c) => {
      if (giftNeed(cook) !== draw.need) return;
      for (const [resource, each] of inputsOf(cook)) consume(resource, cookCol[c] as number, exact(each));
    });
    makers.forEach((maker, m) => {
      const index = makerCol[i]?.[m] as number;
      for (const [resource, each] of inputsOf(maker)) consume(resource, index, exact(each));
      consume(giftResource(maker) as string, index, neg(exact(maker.gives.amount)));
    });
    for (const [resource, index] of shareCol[i] ?? []) consume(resource, index, neg(ONE));
    for (const row of balance.values()) if (row.size > 0) rows.push({ row, relation: "<=", rhs: ZERO });
  });
  // The shares of each stock are not more than the stock.
  for (const resource of stocked) {
    const row: Row = new Map();
    for (const shares of shareCol) addTo(row, shares.get(resource) as number, ONE);
    rows.push({ row, relation: "<=", rhs: exact(stock.get(resource) ?? 0) });
  }

  const constraints: Constraint[] = rows.map(({ row, relation, rhs }) => ({ coefficients: dense(row, count), relation, rhs }));
  const most: Row = new Map([[days, ONE]]);
  const least: Row = new Map();
  for (const shares of shareCol) for (const [resource, index] of shares) addTo(least, index, div(ONE, exact(stock.get(resource) ?? 1)));
  const objectives: Objective[] = [
    { sense: "max", coefficients: dense(most, count) },
    { sense: "min", coefficients: dense(least, count) },
  ];
  const solved = solveLexicographic(constraints, objectives);
  // The point 0 is feasible and the second objective is not less than 0. So only an unbounded first stage has no optimum.
  if (solved.status !== "optimal") return endless;

  const x = solved.x;
  const at = (index: number): Rational => x[index] ?? ZERO;
  const takes: Record<string, Record<string, number>> = {};
  plan.forEach((draw, i) => {
    const record: Record<string, number> = {};
    for (const [resource, index] of shareCol[i] ?? []) if (sign(at(index)) > 0) record[resource] = toNumber(at(index));
    takes[draw.need] = record;
  });
  const runs: Record<string, number> = {};
  // A converter gives a need or a resource, so it is a cook or a maker, not the two.
  const ran = (converter: Converter, value: Rational): void => {
    if (sign(value) > 0) runs[converter.id] = toNumber(value);
  };
  cooks.forEach((cook, c) => ran(cook, at(cookCol[c] as number)));
  makers.forEach((maker, m) => ran(maker, makerCol.reduce((sum, row) => add(sum, at(row[m] as number)), ZERO)));

  const withStore = new Set(layer.stores.map((store) => store.resource));
  const binding = [...inputClosure(direct.map((use) => use.resource), cooks, makers)]
    .filter((resource) => withStore.has(resource))
    .filter((resource) => {
      // A resource with no live stock has no share, so its take is 0 and it is used up.
      const taken = shareCol.reduce((sum, shares) => {
        const index = shares.get(resource);
        return index === undefined ? sum : add(sum, at(index));
      }, ZERO);
      return equals(taken, exact(stock.get(resource) ?? 0));
    })
    .sort();
  return { ...base, days: toNumber(solved.values[0] ?? ZERO), takes, binding, runs };
}

/**
 * This function gives each resource that the plan can use: the direct resources and the inputs of the converters of the plan.
 * It also gives the inputs of their makers, through each chain.
 */
function inputClosure(direct: readonly string[], cooks: readonly Converter[], makers: readonly Converter[]): Set<string> {
  const out = new Set<string>();
  const queue = [...direct, ...cooks.flatMap((cook) => [...inputsOf(cook).keys()])];
  for (let resource = queue.shift(); resource !== undefined; resource = queue.shift()) {
    if (out.has(resource)) continue;
    out.add(resource);
    for (const maker of makers) if (giftResource(maker) === resource) queue.push(...inputsOf(maker).keys());
  }
  return out;
}
