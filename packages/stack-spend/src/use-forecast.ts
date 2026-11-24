import { app, axes, each, let_, lit, parent, ref, v, type Axis, type Expr } from "@mark1russell7/vex";
import type { SpendLayer } from "./layer.ts";
import type { UseOptions, UseRead } from "./reads.ts";
import { evaluateService, firstServices } from "./states.ts";
import { usePlan } from "./use-plan.ts";
import { LEVEL_TOLERANCE, MONTH_READS, useSpace } from "./use.ts";
import { booleanOf, numberOf } from "./values.ts";

// The forecast of the cost of the use of a month, from the reads of that month. A level tells the cost until a read.
// The forecast tells the cost at the end of the month, and the day on which the cost reaches the hard limit.
// Each formula is a Vex program on the tree that `useSpace` makes.

/** The allowance of the service of a read. The program evaluates at a read. */
const READ_ALLOWANCE: Expr = ref("allowance", [parent]);

/**
 * The gross amount of a read: the cost of its use before the allowance of the plan. The program evaluates at a read.
 *
 * - A read with the field `gross` gives that field.
 * - A read with an amount above 0 gives the amount plus the allowance, because its use is above the allowance.
 * - A read of a service with no allowance gives its amount.
 * - A different read gives an error value: an amount of 0 below an allowance does not tell the use.
 */
export const READ_GROSS: Expr = app(
  "ifError",
  ref("gross"),
  app("if", app("or", app("gt", ref("amount"), lit(0)), app("eq", READ_ALLOWANCE, lit(0))), app("add", ref("amount"), READ_ALLOWANCE), ref("gross")),
);

/** The reads of a service in the month of the check that have a known gross amount. */
export const RATE_READS: Axis = axes.where(MONTH_READS, app("ifError", app("gte", READ_GROSS, lit(0)), lit(false)));

/**
 * The gross amount of the use of a service in the month: the largest gross amount of its reads.
 * With no read with a known gross amount, it gives `#N/A`.
 */
export const GROSS_USED: Expr = app("max", each(RATE_READS, READ_GROSS));

/** The day of the newest read of a service with a known gross amount, as a day of the month. With no such read, it gives `#N/A`. */
export const LAST_DAY: Expr = app("max", each(RATE_READS, ref("day")));

/**
 * This test tells if a read is old: `rateDays` before the newest read, or more. The program evaluates at a read,
 * and the name `last` holds `LAST_DAY` of its service.
 */
const OLD: Expr = app("lte", ref("day"), app("subtract", v("last"), ref("rateDays", [parent, parent])));

/**
 * The day from which the rate counts: the day of the newest old read of a service.
 * A service with no old read gives 0: the start of the month, when the use was 0.
 */
export const BASE_DAY: Expr = let_({ last: LAST_DAY }, app("max", each(RATE_READS, app("if", OLD, ref("day"), lit(0)))));

/** The gross amount of the use of a service on `BASE_DAY`: the largest gross amount of its old reads. With no old read, it gives 0. */
export const BASE_GROSS: Expr = let_({ last: LAST_DAY }, app("max", each(RATE_READS, app("if", OLD, READ_GROSS, lit(0)))));

/**
 * The rate of the use of a service: the gross cost of the use of one day, from `BASE_DAY` to `LAST_DAY`.
 * With no read with a known gross amount, it gives an error value.
 */
export const USE_RATE: Expr = app("divide", app("subtract", GROSS_USED, BASE_GROSS), app("subtract", LAST_DAY, BASE_DAY));

/**
 * The cost of the use of a service at the end of the month, when the use continues at `USE_RATE`.
 * It is the gross amount at the end of the month less the allowance, and 0 at the least.
 */
export const MONTH_END: Expr = app(
  "max",
  lit(0),
  app("subtract", app("add", GROSS_USED, app("multiply", USE_RATE, app("subtract", ref("days", [parent]), LAST_DAY))), ref("allowance")),
);

/**
 * The day of the month on which the cost of the use of a service reaches its hard limit, when the use continues at `USE_RATE`.
 * The day can be after the end of the month. A rate of 0 or a service with no hard limit gives an error value.
 */
export const LIMIT_DAY: Expr = app(
  "ceil",
  app("subtract", app("add", LAST_DAY, app("divide", app("subtract", app("add", ref("limit"), ref("allowance")), GROSS_USED), USE_RATE)), lit(LEVEL_TOLERANCE)),
);

/**
 * This test tells if the cost of a service reaches its hard limit in the month, after its newest read.
 * A cost that is at the limit at the newest read gives `false`: a level tells that fact.
 */
export const LIMIT_IN_MONTH: Expr = app("and", app("gt", LIMIT_DAY, LAST_DAY), app("lte", LIMIT_DAY, ref("days", [parent])));

/** The forecast of the cost of the use of one service in the month of the check. A field with no known value is absent. */
export interface UseForecast {
  /** The `id` of the part of the service. */
  readonly part: string;
  /** The gross amount of the use of the month: the cost before the allowance of the plan. */
  readonly gross?: number | undefined;
  /** The day from which the rate counts, as a day of the month. The day 0 is the start of the month. */
  readonly from?: number | undefined;
  /** The day of the newest read with a known gross amount, as a day of the month. The rate counts until this day. */
  readonly to?: number | undefined;
  /** The rate of the use: the gross cost of the use of one day, from `from` to `to`. */
  readonly rate?: number | undefined;
  /** The cost of the use at the end of the month, when the use continues at `rate`. The allowance is not in it. */
  readonly end?: number | undefined;
  /** The date on which the cost reaches the hard limit at `rate`, as `YYYY-MM-DD`. A cost that stays below the limit in the month has none. */
  readonly limitDate?: string | undefined;
}

/**
 * This function gives the forecast of the cost of the use of each service of a layer, in the sequence of the services.
 * The month is the month of `today`: a read of a different month does not count.
 *
 * The rate is the growth of the gross amount between two reads: the newest read, and the newest read that is
 * `rateDays` older, or more. A month with no read that old gives the rate from the start of the month.
 * The forecast is a calculation from the reads, not a read: the use of the next days can be different.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`, or `levels`, `readDays` or `rateDays` is not valid
 */
export function useForecasts(layer: SpendLayer, reads: readonly UseRead[], options: UseOptions): UseForecast[] {
  const plan = usePlan(layer, reads, options);
  const tree = useSpace(layer, reads, options);
  return firstServices(layer).map((service) => {
    const number = (program: Expr): number | undefined => numberOf(evaluateService(program, tree, service.part));
    const day = booleanOf(evaluateService(LIMIT_IN_MONTH, tree, service.part)) === true ? number(LIMIT_DAY) : undefined;
    const fields = {
      gross: number(GROSS_USED),
      from: number(BASE_DAY),
      to: number(LAST_DAY),
      rate: number(USE_RATE),
      end: number(MONTH_END),
      limitDate: day === undefined ? undefined : `${plan.month}-${String(day).padStart(2, "0")}`,
    };
    return { part: service.part, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) };
  });
}
