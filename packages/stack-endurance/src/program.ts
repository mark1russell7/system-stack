import type { Constraint } from "@mark1russell7/linear";
import { add, div, mul, neg, ONE, type Rational, ZERO } from "@mark1russell7/rational";
import { canRun, deviceKey, inputsOf } from "./converter.ts";
import { giftNeed, giftResource } from "./endurance.ts";
import type { Converter, DirectUse, Draw, EnduranceLayer } from "./layer.ts";
import { addTo, dense, exact, type Row } from "./rows.ts";

// The internal parts of the linear programs over the totals of a span: the parts of a case, the columns and rows of each draw,
// and the device-days of the converters. The joint days and the best endurance use them. The root entry does not give them.

/** One constraint row of a program, in its sparse form. */
export interface RowSpec {
  readonly row: Row;
  readonly relation: Constraint["relation"];
  readonly rhs: Rational;
}

/** A program in construction: the count of its variables and its rows. */
export class Program {
  count = 0;
  readonly rows: RowSpec[] = [];

  /** This method adds a variable and gives its index. */
  next(): number {
    return this.count++;
  }

  /** This method adds a row and gives its index. */
  push(row: Row, relation: Constraint["relation"], rhs: Rational): number {
    this.rows.push({ row, relation, rhs });
    return this.rows.length - 1;
  }

  /** This method gives the dense rows for `solveLexicographic`. */
  constraints(): Constraint[] {
    return this.rows.map(({ row, relation, rhs }) => ({ coefficients: dense(row, this.count), relation, rhs }));
  }
}

/** The parts of a case that the programs use. */
export interface CaseParts {
  /** The stock of each resource at the date of the query (`storeAmounts`). */
  readonly stock: ReadonlyMap<string, number>;
  /** The direct uses of the needs of the program, with an amount more than 0. */
  readonly direct: readonly DirectUse[];
  /** The converters that can run and give a need of the program. */
  readonly cooks: readonly Converter[];
  /** The converters that can run and give a resource. */
  readonly makers: readonly Converter[];
  /** Each resource that a direct use or a converter takes, and each resource that a maker gives. */
  readonly resources: ReadonlySet<string>;
  /** The resources of `resources` with a stock more than 0, in the order of their codes. */
  readonly stocked: readonly string[];
}

/** This function gives the parts of a case for the draws of `needs`. */
export function caseParts(layer: EnduranceLayer, stoppedParts: ReadonlySet<string>, stock: ReadonlyMap<string, number>, needs: ReadonlySet<string>): CaseParts {
  const direct = (layer.direct ?? []).filter((use) => needs.has(use.need) && use.amount > 0);
  const live = (layer.converters ?? []).filter((converter) => canRun(converter, stoppedParts));
  const cooks = live.filter((converter) => needs.has(giftNeed(converter) ?? ""));
  const makers = live.filter((converter) => giftResource(converter) !== undefined);
  return partsOf(stock, direct, cooks, makers);
}

/** This function gives the parts of a case from its stock, its direct uses, its cooks and its makers. */
export function partsOf(stock: ReadonlyMap<string, number>, direct: readonly DirectUse[], cooks: readonly Converter[], makers: readonly Converter[]): CaseParts {
  const resources = new Set<string>([...direct.map((use) => use.resource), ...[...cooks, ...makers].flatMap((converter) => [...inputsOf(converter).keys()])]);
  for (const maker of makers) resources.add(giftResource(maker) ?? "");
  const stocked = [...resources].filter((resource) => (stock.get(resource) ?? 0) > 0).sort();
  return { stock, direct, cooks, makers, resources, stocked };
}

/** The columns of one draw in a program. */
export interface DrawBlock {
  readonly draw: Draw;
  /** The gifts of the need of the draw from the columns of its direct uses and of its cooks. The caller adds the term of the days. */
  readonly gifts: Row;
  /** The column of the share of each stock, by the code of the resource. It is empty for a draw with no stock. */
  readonly shares: ReadonlyMap<string, number>;
  /** The column of the runs of each converter for the draw: each cook of its need, and each maker. */
  readonly runs: ReadonlyMap<Converter, number>;
}

/**
 * This function adds the columns of one draw to a program, and the balance row of each of its resources.
 * In a balance row, the takes of the draw are not more than its share of the stock plus the gifts of its makers.
 * The caller adds the row of the need, with the term of the days.
 *
 * @param stocked - False for a draw that takes no stock. Its shares are not columns.
 */
export function drawBlock(program: Program, parts: CaseParts, draw: Draw, stocked = true): DrawBlock {
  const gifts: Row = new Map();
  const balance = new Map<string, Row>([...parts.resources].map((resource) => [resource, new Map()]));
  const consume = (resource: string, index: number, amount: Rational): void => addTo(balance.get(resource) as Row, index, amount);
  for (const use of parts.direct) {
    if (use.need !== draw.need) continue;
    const index = program.next();
    addTo(gifts, index, exact(use.amount));
    consume(use.resource, index, ONE);
  }
  const runs = new Map<Converter, number>();
  for (const cook of parts.cooks) {
    if (giftNeed(cook) !== draw.need) continue;
    const index = program.next();
    runs.set(cook, index);
    addTo(gifts, index, exact(cook.gives.amount));
    for (const [resource, each] of inputsOf(cook)) consume(resource, index, exact(each));
  }
  for (const maker of parts.makers) {
    const index = program.next();
    runs.set(maker, index);
    for (const [resource, each] of inputsOf(maker)) consume(resource, index, exact(each));
    consume(giftResource(maker) as string, index, neg(exact(maker.gives.amount)));
  }
  const shares = new Map(stocked ? parts.stocked.map((resource) => [resource, program.next()] as const) : []);
  for (const [resource, index] of shares) consume(resource, index, neg(ONE));
  for (const row of balance.values()) if (row.size > 0) program.push(row, "<=", ZERO);
  return { draw, gifts, shares, runs };
}

/** The device-days of a limit: the runs of its converters over `perDay`, the count of its devices, and its converters. */
export interface DeviceLimit {
  readonly row: Row;
  readonly devices: number;
  readonly converters: Converter[];
}

/**
 * This function gives the device-days of each device of a set of run columns, by the key of the device (`deviceKey`).
 * One run uses `1 / perDay` of a day of one device. The converters of one device share one limit. A converter with no device has a limit of its own.
 * A converter with no limit `perDay` is not in the record. The list `stopped` has the columns of the converters with a limit of 0.
 */
export function deviceUse(runs: Iterable<readonly [Converter, number]>): { readonly limits: Map<string, DeviceLimit>; readonly stopped: number[] } {
  const limits = new Map<string, DeviceLimit>();
  const stopped: number[] = [];
  for (const [converter, index] of runs) {
    if (converter.perDay === undefined) continue;
    if (!(converter.perDay > 0)) {
      stopped.push(index);
      continue;
    }
    const key = deviceKey(converter);
    const limit: DeviceLimit = limits.get(key) ?? { row: new Map(), devices: converter.devices ?? 1, converters: [] };
    limits.set(key, limit);
    if (!limit.converters.includes(converter)) limit.converters.push(converter);
    addTo(limit.row, index, div(ONE, exact(converter.perDay)));
  }
  return { limits, stopped };
}

/**
 * This function gives the row of the fewest device-days of a set of run columns: the runs over `perDay`, or the runs with no limit.
 * As an objective, it gives no more runs than the plan uses.
 */
export function fewestRow(runs: Iterable<readonly [Converter, number]>): Row {
  const out: Row = new Map();
  for (const [converter, index] of runs) addTo(out, index, converter.perDay !== undefined && converter.perDay > 0 ? div(ONE, exact(converter.perDay)) : ONE);
  return out;
}

/** This function gives the value of a sparse row at the point `x`. */
export function valueAt(row: Row, x: readonly Rational[]): Rational {
  let out = ZERO;
  for (const [index, value] of row) out = add(out, mul(value, x[index] ?? ZERO));
  return out;
}

/**
 * This function gives each resource that a draw can use: the resources of its direct uses and the inputs of its cooks.
 * It also gives the inputs of their makers, through each chain.
 */
export function inputClosure(direct: readonly string[], cooks: readonly Converter[], makers: readonly Converter[]): Set<string> {
  const out = new Set<string>();
  const queue = [...direct, ...cooks.flatMap((cook) => [...inputsOf(cook).keys()])];
  for (let resource = queue.shift(); resource !== undefined; resource = queue.shift()) {
    if (out.has(resource)) continue;
    out.add(resource);
    for (const maker of makers) if (giftResource(maker) === resource) queue.push(...inputsOf(maker).keys());
  }
  return out;
}

/** This function gives the resources that the draws of `needs` can use, and the converters that they can use. */
export function reachOf(parts: CaseParts, needs: ReadonlySet<string>): { readonly closure: Set<string>; readonly reach: Set<Converter> } {
  const cooks = parts.cooks.filter((cook) => needs.has(giftNeed(cook) ?? ""));
  const closure = inputClosure(parts.direct.filter((use) => needs.has(use.need)).map((use) => use.resource), cooks, parts.makers);
  return { closure, reach: new Set([...cooks, ...parts.makers.filter((maker) => closure.has(giftResource(maker) ?? ""))]) };
}
