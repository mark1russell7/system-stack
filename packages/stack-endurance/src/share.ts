import { type Objective, solveLexicographic } from "@mark1russell7/linear";
import { div, neg, ONE, type Rational, sign, toNumber, ZERO } from "@mark1russell7/rational";
import type { Converter, DirectUse, Draw } from "./layer.ts";
import { deviceUse, drawBlock, fewestRow, partsOf, Program, valueAt } from "./program.ts";
import { addTo, dense, exact, type Row } from "./rows.ts";

// The best share of one draw: a linear program over the totals of its days, with exact rationals (@mark1russell7/linear).
// The endurance query uses it for a draw whose converters share the days of a device. The root entry does not give it.
// The columns and rows come from program.ts, as for the joint days and the best endurance.

/** The input of the best share of one draw. */
export interface ShareInput {
  /** The draw. */
  readonly draw: Draw;
  /** The stock of each resource that the draw can take, by the code of the resource. */
  readonly stock: ReadonlyMap<string, number>;
  /** The device-days of each day that the draw can use, by the key of the device (`deviceKey`). */
  readonly room: ReadonlyMap<string, number>;
  /** The direct uses that give the need of the draw. */
  readonly direct: readonly DirectUse[];
  /** The converters that give the need of the draw. */
  readonly converters: readonly Converter[];
  /** The makers that the draw can use: the makers of its inputs, through each chain. */
  readonly makers: readonly Converter[];
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
 * @param input - The draw, the stocks, the device-days of each day, the ways of the draw and its demand
 * @returns The days, the takes of the stocks and the device-days of each device
 */
export function bestShare(input: ShareInput): Share | undefined {
  const parts = partsOf(input.stock, input.direct, input.converters, input.makers);
  const program = new Program();
  const days = program.next();
  const block = drawBlock(program, parts, input.draw);
  // The need: the gifts are not less than the demand times the days.
  const need: Row = new Map(block.gifts);
  addTo(need, days, neg(exact(input.demand)));
  program.push(need, ">=", ZERO);
  // The take of each stock is not more than the stock.
  for (const [resource, index] of block.shares) program.push(new Map([[index, ONE]]), "<=", exact(input.stock.get(resource) ?? 0));
  // The limit of each device: the runs use `room` times `T` device-days or less. The converters of one device share one limit.
  const { limits, stopped } = deviceUse(block.runs);
  for (const index of stopped) program.push(new Map([[index, ONE]]), "<=", ZERO);
  for (const [key, limit] of limits) {
    const row: Row = new Map(limit.row);
    addTo(row, days, neg(exact(input.room.get(key) ?? 0)));
    program.push(row, "<=", ZERO);
  }

  const least: Row = new Map();
  for (const [resource, index] of block.shares) addTo(least, index, div(ONE, exact(input.stock.get(resource) ?? 1)));
  const objectives: Objective[] = [
    { sense: "max", coefficients: dense(new Map([[days, ONE]]), program.count) },
    { sense: "min", coefficients: dense(least, program.count) },
    { sense: "min", coefficients: dense(fewestRow(block.runs), program.count) },
  ];
  const solved = solveLexicographic(program.constraints(), objectives);
  // The point 0 is feasible, and the later objectives are not less than 0. Thus only an unbounded first stage has no optimum.
  if (solved.status !== "optimal") return undefined;

  const at = (index: number): Rational => solved.x[index] ?? ZERO;
  const taken = new Map<string, number>();
  for (const [resource, index] of block.shares) if (sign(at(index)) > 0) taken.set(resource, toNumber(at(index)));
  const used = new Map<string, number>();
  for (const [key, limit] of limits) {
    const sum = valueAt(limit.row, solved.x);
    if (sign(sum) > 0) used.set(key, toNumber(sum));
  }
  return { days: toNumber(at(days)), taken, used };
}
