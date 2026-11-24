import { app, axes, each, let_, lit, parent, ref, space, v, type Axis, type Expr, type Space } from "@mark1russell7/vex";
import type { Billing, SpendLayer } from "./layer.ts";
import type { UseOptions, UseRead, UseSource } from "./reads.ts";
import { evaluateService, firstServices, LAYER_KEY, serviceKey, serviceStates } from "./states.ts";
import { monthOf, usePlan } from "./use-plan.ts";
import { booleanOf, numberOf } from "./values.ts";

// The used amount of each service in a month, from the reads. The rule: the used amount is the larger of the count of
// the stack and the amount of the provider. Each formula is a Vex program on the tree that `useSpace` makes.

/** This test tells if a read node is of the month of the layer node. The program evaluates at a read. */
const IN_MONTH: Expr = app("eq", ref("month"), ref("month", [parent, parent]));

/** The reads of a service in the month of the check. */
export const MONTH_READS: Axis = axes.where(axes.children, IN_MONTH);

/** This function gives the amount of each read of one source, for a service in the month of the check. */
function amountsOf(source: UseSource): Expr {
  return each(axes.where(MONTH_READS, app("eq", ref("source"), lit(source))), ref("amount"));
}

/** The largest amount that a part of the stack counted for a service in the month. With no such read, it gives `#N/A`. */
export const COUNT_USED: Expr = app("max", amountsOf("count"));

/** The largest amount that the provider showed for a service in the month. With no such read, it gives `#N/A`. */
export const PROVIDER_USED: Expr = app("max", amountsOf("provider"));

/**
 * The used amount of a service in the month: the larger of the count of the stack and the amount of the provider.
 * It is the largest amount of the reads of the month, because the cost of a month does not go down.
 * With no read of the month, it gives `#N/A`.
 */
export const USED: Expr = app("max", each(MONTH_READS, ref("amount")));

/** The used share of the hard limit of a service: the used amount divided by the limit. With no read or no limit, it gives an error value. */
export const USE_SHARE: Expr = app("divide", USED, ref("limit"));

/** This test tells if the used amount of a service is more than its hard limit. Such a limit did not hold. */
export const USE_OVER: Expr = app("gt", USED, ref("limit"));

/**
 * The tolerance of the comparison of a share with a level. A share reaches a level when it is the level less this
 * tolerance, or more. Thus the rounding of a division does not hide a level: 2.4 of 3 reaches the level 0.8.
 */
export const LEVEL_TOLERANCE = 1e-9;

/**
 * The largest level that the used share of a service reached. A share below each level gives 0.
 * With no read or no limit, it gives `#N/A`. The levels are in the field `levels` of the layer node.
 */
export const USE_LEVEL: Expr = let_(
  { share: app("add", USE_SHARE, lit(LEVEL_TOLERANCE)) },
  app("max", each(axes.list(ref("levels", [parent])), app("if", app("lte", v("level"), v("share")), v("level"), lit(0)), undefined, ["level"])),
);

/** The age of the newest read of a service in the month, in days. With no read of the month, it gives `#N/A`. */
export const READ_AGE: Expr = app("min", each(MONTH_READS, ref("age")));

/**
 * This function gives the tree of the reads of a layer, as a space of Vex.
 *
 * - The layer is the root, with the key `LAYER_KEY`. Its fields are `month` (the month of the check), `levels`, `days` and `rateDays`.
 *   The field `days` is the count of days of the month.
 * - A service is a child of the layer. Its fields are `billing`, `allowance` and `limit`: its hard limit, from `serviceStates`.
 *   A service with no allowance has the allowance 0.
 * - A read is a child of its service. Its fields are `source`, `amount`, `month`, `age` and `day`.
 *   The field `age` is the count of days from its date to the check. The field `day` is its day of the month of the check.
 *   A read with a gross amount has the field `gross` too.
 *
 * A read with a fault is not in the tree, and `checkUse` tells the fault. The first record of a part is used.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`, or `levels`, `readDays` or `rateDays` is not valid
 */
export function useSpace(layer: SpendLayer, reads: readonly UseRead[], options: UseOptions): Space {
  const plan = usePlan(layer, reads, options);
  const limits = new Map(serviceStates(layer).map((state) => [state.part, state.hardLimit] as const));
  const records: Record<string, Readonly<Record<string, unknown>>> = { [LAYER_KEY]: { kind: "layer", month: plan.month, levels: [...plan.levels], days: plan.monthDays, rateDays: plan.rateDays } };
  const parents: Record<string, string | null> = { [LAYER_KEY]: null };
  for (const service of firstServices(layer)) {
    const key = serviceKey(service.part);
    const limit = limits.get(service.part);
    records[key] = { kind: "service", billing: service.billing, allowance: service.allowance ?? 0, ...(limit === undefined ? {} : { limit }) };
    parents[key] = LAYER_KEY;
  }
  reads.forEach((read, index) => {
    if (plan.codes[index] !== undefined) return;
    const key = `read:${String(index)}`;
    records[key] = { kind: "read", source: read.source, amount: read.amount, month: monthOf(read.date), age: plan.ages[index], day: plan.days[index], ...(read.gross === undefined ? {} : { gross: read.gross }) };
    parents[key] = serviceKey(read.part);
  });
  return space.tree(records, parents);
}

/** The state of the used amount of one service in the month of the check. A field with no known value is absent. */
export interface UseState {
  /** The `id` of the part of the service. */
  readonly part: string;
  readonly billing: Billing;
  /** The largest amount that a part of the stack counted in the month. */
  readonly count?: number | undefined;
  /** The largest amount that the provider showed in the month. */
  readonly provider?: number | undefined;
  /** The used amount of the month: the larger of `count` and `provider`. A service with no read of the month has none. */
  readonly used?: number | undefined;
  /** The hard limit of the service for a month. */
  readonly limit?: number | undefined;
  /** The used share of the hard limit: `used` divided by `limit`. */
  readonly share?: number | undefined;
  /** The largest level that the share reached. A share below each level has none. */
  readonly level?: number | undefined;
  /** This field tells if the used amount is more than the hard limit. */
  readonly over?: boolean | undefined;
  /** The age of the newest read of the month, in days. */
  readonly age?: number | undefined;
}

/** This function gives a record without the fields that have no value. */
function known<Fields extends Record<string, unknown>>(fields: Fields): Partial<Fields> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<Fields>;
}

/**
 * This function gives the state of the used amount of each service of a layer, in the sequence of the services.
 * The month is the month of `today`: a read of a different month does not count.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`, or `levels` or `readDays` is not valid
 */
export function useStates(layer: SpendLayer, reads: readonly UseRead[], options: UseOptions): UseState[] {
  const tree = useSpace(layer, reads, options);
  return firstServices(layer).map((service) => {
    const number = (program: Expr): number | undefined => numberOf(evaluateService(program, tree, service.part));
    const level = number(USE_LEVEL);
    return {
      part: service.part,
      billing: service.billing,
      ...known({
        count: number(COUNT_USED),
        provider: number(PROVIDER_USED),
        used: number(USED),
        limit: number(ref("limit")),
        share: number(USE_SHARE),
        level: level === 0 ? undefined : level,
        over: booleanOf(evaluateService(USE_OVER, tree, service.part)),
        age: number(READ_AGE),
      }),
    };
  });
}
