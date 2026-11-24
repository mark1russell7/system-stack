import { type Constraint, type Objective, solveLexicographic } from "@mark1russell7/linear";
import { add, div, mul, neg, ONE, type Rational, sign, toNumber, ZERO } from "@mark1russell7/rational";
import { deviceKey, inputsOf } from "./converter.ts";
import type { Converter, DirectUse } from "./layer.ts";
import { addTo, dense, exact, type Row } from "./rows.ts";

// The best share of one draw: a linear program over the totals of its days, with exact rationals (@mark1russell7/linear).
// The endurance query uses it for a draw whose converters share the days of a device. The root entry does not give it.

/** The input of the best share of one draw. */
export interface ShareInput {
  /** The stock of each resource that the draw can take, by the code of the resource. */
  readonly stock: ReadonlyMap<string, number>;
  /** The device-days of each day that the draw can use, by the key of the device (`deviceKey`). */
  readonly room: ReadonlyMap<string, number>;
  /** The direct uses that give the need of the draw. */
  readonly direct: readonly DirectUse[];
  /** The converters that give the need of the draw. */
  readonly converters: readonly Converter[];
  /** The converters that make each resource, by the code of the resource. */
  readonly makers: ReadonlyMap<string, readonly Converter[]>;
  /** The amount of the need for each day. It is more than 0. */
  readonly demand: number;
}

/** The best share of one draw: its days, the take of each stock and the device-days of each device. */
export interface Share {
  /** The largest count of days at which the draw gets its demand. */
  readonly days: number;
  /** The amount of each resource that the draw takes from the stock. A resource with no take is not in the map. */
  readonly taken: ReadonlyMap<string, number>;
  /** The device-days that the runs use in `days`, by the key of the device. A device with no use is not in the map. */
  readonly used: ReadonlyMap<string, number>;
}

/** This function gives the makers that a draw can use: the makers of its inputs, through each chain. */
function reachedMakers(input: ShareInput): Converter[] {
  const out = new Set<Converter>();
  const seen = new Set<string>();
  const queue = [...input.direct.map((use) => use.resource), ...input.converters.flatMap((converter) => [...inputsOf(converter).keys()])];
  for (let resource = queue.shift(); resource !== undefined; resource = queue.shift()) {
    if (seen.has(resource)) continue;
    seen.add(resource);
    for (const maker of input.makers.get(resource) ?? []) {
      out.add(maker);
      queue.push(...inputsOf(maker).keys());
    }
  }
  return [...out];
}

/**
 * This function gives the best share of the stocks and of the device-days for one draw.
 * It gives `undefined` when the program has no optimum.
 *
 * - The variables are the days `T`, the take of each direct use, the runs of each converter and maker, and the take of each stock.
 * - The gifts of the direct uses and of the converters are not less than `T` times the demand.
 * - The takes of each resource are not more than the take of its stock plus the gifts of its makers. The take of a stock is not more than the stock.
 * - The runs of the converters of one device use `room` times `T` device-days or less. One run uses `1 / perDay` of a device-day. A limit of 0 stops the converter.
 * - The first objective takes the largest `T`. The second takes the smallest sum of the takes of the stocks, each over its stock. The third takes the fewest device-days.
 *
 * The gifts at `T` days are a concave function of `T`, and they are 0 at 0. Thus each count of days up to the largest `T` also fits.
 *
 * @param input - The stocks, the device-days of each day, the ways of the draw and its demand
 * @returns The days, the takes of the stocks and the device-days of each device
 */
export function bestShare(input: ShareInput): Share | undefined {
  const makers = reachedMakers(input);
  const resources = new Set<string>([...input.direct.map((use) => use.resource), ...[...input.converters, ...makers].flatMap((converter) => [...inputsOf(converter).keys()])]);
  for (const maker of makers) if ("resource" in maker.gives && maker.gives.resource !== undefined) resources.add(maker.gives.resource);
  const stocked = [...resources].filter((resource) => (input.stock.get(resource) ?? 0) > 0).sort();

  let count = 0;
  const next = (): number => count++;
  const days = next();
  const useCol = input.direct.map(next);
  const runs = new Map<Converter, number>([...input.converters, ...makers].map((converter) => [converter, next()] as const));
  const shareCol = new Map(stocked.map((resource) => [resource, next()] as const));

  const rows: { readonly row: Row; readonly relation: Constraint["relation"]; readonly rhs: Rational }[] = [];
  // The need: the gifts are not less than the demand times the days.
  const need: Row = new Map([[days, neg(exact(input.demand))]]);
  input.direct.forEach((use, k) => addTo(need, useCol[k] as number, exact(use.amount)));
  for (const converter of input.converters) addTo(need, runs.get(converter) as number, exact(converter.gives.amount));
  rows.push({ row: need, relation: ">=", rhs: ZERO });
  // The balance of each resource: its takes are not more than the take of its stock plus the gifts of its makers.
  const balance = new Map<string, Row>([...resources].map((resource) => [resource, new Map()]));
  const consume = (resource: string, index: number, amount: Rational): void => addTo(balance.get(resource) as Row, index, amount);
  input.direct.forEach((use, k) => consume(use.resource, useCol[k] as number, ONE));
  for (const [converter, index] of runs) {
    for (const [resource, each] of inputsOf(converter)) consume(resource, index, exact(each));
    if ("resource" in converter.gives && converter.gives.resource !== undefined) consume(converter.gives.resource, index, neg(exact(converter.gives.amount)));
  }
  for (const [resource, index] of shareCol) consume(resource, index, neg(ONE));
  for (const row of balance.values()) if (row.size > 0) rows.push({ row, relation: "<=", rhs: ZERO });
  // The take of each stock is not more than the stock.
  for (const [resource, index] of shareCol) rows.push({ row: new Map([[index, ONE]]), relation: "<=", rhs: exact(input.stock.get(resource) ?? 0) });
  // The limit of each device: the runs use `room` times `T` device-days or less. The converters of one device share one limit.
  const limits = new Map<string, Row>();
  for (const [converter, index] of runs) {
    if (converter.perDay === undefined) continue;
    if (!(converter.perDay > 0)) {
      rows.push({ row: new Map([[index, ONE]]), relation: "<=", rhs: ZERO });
      continue;
    }
    const key = deviceKey(converter);
    const limit = limits.get(key) ?? new Map([[days, neg(exact(input.room.get(key) ?? 0))]]);
    limits.set(key, limit);
    addTo(limit, index, div(ONE, exact(converter.perDay)));
  }
  for (const row of limits.values()) rows.push({ row, relation: "<=", rhs: ZERO });

  const most: Row = new Map([[days, ONE]]);
  const least: Row = new Map();
  for (const [resource, index] of shareCol) addTo(least, index, div(ONE, exact(input.stock.get(resource) ?? 1)));
  const fewest: Row = new Map();
  for (const [converter, index] of runs) addTo(fewest, index, converter.perDay !== undefined && converter.perDay > 0 ? div(ONE, exact(converter.perDay)) : ONE);
  const objectives: Objective[] = [
    { sense: "max", coefficients: dense(most, count) },
    { sense: "min", coefficients: dense(least, count) },
    { sense: "min", coefficients: dense(fewest, count) },
  ];
  const constraints: Constraint[] = rows.map(({ row, relation, rhs }) => ({ coefficients: dense(row, count), relation, rhs }));
  const solved = solveLexicographic(constraints, objectives);
  // The point 0 is feasible, and the later objectives are not less than 0. Thus only an unbounded first stage has no optimum.
  if (solved.status !== "optimal") return undefined;

  const at = (index: number): Rational => solved.x[index] ?? ZERO;
  const taken = new Map<string, number>();
  for (const [resource, index] of shareCol) if (sign(at(index)) > 0) taken.set(resource, toNumber(at(index)));
  const used = new Map<string, number>();
  for (const [key, row] of limits) {
    let sum: Rational = ZERO;
    for (const [index, value] of row) if (index !== days) sum = add(sum, mul(value, at(index)));
    if (sign(sum) > 0) used.set(key, toNumber(sum));
  }
  return { days: toNumber(at(days)), taken, used };
}
