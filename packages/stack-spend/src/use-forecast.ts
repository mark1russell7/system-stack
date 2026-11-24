import { app, axes, each, let_, lit, parent, rec, ref, v, type Axis, type Expr } from "@mark1russell7/vex";
import type { SpendLayer } from "./layer.ts";
import type { UseOptions, UseRead } from "./reads.ts";
import { evaluateService, firstServices } from "./states.ts";
import { usePlan } from "./use-plan.ts";
import { LEVEL_TOLERANCE, MONTH_READS, useSpace } from "./use.ts";

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
 * This test tells if a read is old: `rateDays` before the newest read, or more. The program evaluates at a read,
 * and the name `last` holds the day of the newest read of its service.
 */
const OLD: Expr = app("lte", ref("day"), app("subtract", v("last"), ref("rateDays", [parent, parent])));

/**
 * This function gives a program that can read the names of a forecast: `gross`, `last`, `baseDay`, `baseGross`,
 * `rate` and `limitDay`. An evaluation calculates each name one time. Thus a program that reads a name in many
 * places does the work one time. A name with no known value holds an error value.
 */
function named(body: Expr): Expr {
  const newest = { gross: app("max", each(RATE_READS, READ_GROSS)), last: app("max", each(RATE_READS, ref("day"))) };
  const base = {
    baseDay: app("max", each(RATE_READS, app("if", OLD, ref("day"), lit(0)))),
    baseGross: app("max", each(RATE_READS, app("if", OLD, READ_GROSS, lit(0)))),
  };
  const rate = { rate: app("divide", app("subtract", v("gross"), v("baseGross")), app("subtract", v("last"), v("baseDay"))) };
  const toLimit = app("divide", app("subtract", app("add", ref("limit"), ref("allowance")), v("gross")), v("rate"));
  const limitDay = { limitDay: app("ceil", app("subtract", app("add", v("last"), toLimit), lit(LEVEL_TOLERANCE))) };
  return let_(newest, let_(base, let_(rate, let_(limitDay, body))));
}

/**
 * The gross amount of the use of a service in the month: the largest gross amount of its reads.
 * With no read with a known gross amount, it gives `#N/A`.
 */
export const GROSS_USED: Expr = named(v("gross"));

/** The day of the newest read of a service with a known gross amount, as a day of the month. With no such read, it gives `#N/A`. */
export const LAST_DAY: Expr = named(v("last"));

/**
 * The day from which the rate counts: the day of the newest old read of a service.
 * A service with no old read gives 0: the start of the month, when the use was 0.
 */
export const BASE_DAY: Expr = named(v("baseDay"));

/** The gross amount of the use of a service on `BASE_DAY`: the largest gross amount of its old reads. With no old read, it gives 0. */
export const BASE_GROSS: Expr = named(v("baseGross"));

/**
 * The rate of the use of a service: the gross cost of the use of one day, from `BASE_DAY` to `LAST_DAY`.
 * With no read with a known gross amount, it gives an error value.
 */
export const USE_RATE: Expr = named(v("rate"));

/** The cost at the end of the month. The program reads the names of `named`. */
const END: Expr = app(
  "max",
  lit(0),
  app("subtract", app("add", v("gross"), app("multiply", v("rate"), app("subtract", ref("days", [parent]), v("last")))), ref("allowance")),
);

/**
 * The cost of the use of a service at the end of the month, when the use continues at `USE_RATE`.
 * It is the gross amount at the end of the month less the allowance, and 0 at the least.
 */
export const MONTH_END: Expr = named(END);

/**
 * The day of the month on which the cost of the use of a service reaches its hard limit, when the use continues at `USE_RATE`.
 * The day can be after the end of the month. A rate of 0 or a service with no hard limit gives an error value.
 */
export const LIMIT_DAY: Expr = named(v("limitDay"));

/** This test tells if the cost reaches the hard limit in the month, after the newest read. The program reads the names of `named`. */
const IN_MONTH: Expr = app("and", app("gt", v("limitDay"), v("last")), app("lte", v("limitDay"), ref("days", [parent])));

/**
 * This test tells if the cost of a service reaches its hard limit in the month, after its newest read.
 * A cost that is at the limit at the newest read gives `false`: a level tells that fact.
 */
export const LIMIT_IN_MONTH: Expr = named(IN_MONTH);

/** This function gives a program with the value of `value`, or `false` for an error value. A record of Vex cannot hold an error value. */
function known(value: Expr): Expr {
  return app("ifError", value, lit(false));
}

/**
 * The forecast of a service as one record, from one evaluation. A field with no known value is `false`.
 * The field `limitDay` is a day only when the cost reaches the hard limit in the month.
 */
const FORECAST: Expr = named(
  rec({
    gross: known(v("gross")),
    from: known(v("baseDay")),
    to: known(v("last")),
    rate: known(v("rate")),
    end: known(END),
    limitDay: known(app("if", IN_MONTH, v("limitDay"), lit(false))),
  }),
);

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
    const result = evaluateService(FORECAST, tree, service.part);
    const number = (field: string): number | undefined => {
      const value: unknown = result.ok && typeof result.value === "object" && result.value !== null ? Reflect.get(result.value, field) : undefined;
      return typeof value === "number" ? value : undefined;
    };
    const day = number("limitDay");
    const fields = {
      gross: number("gross"),
      from: number("from"),
      to: number("to"),
      rate: number("rate"),
      end: number("end"),
      limitDate: day === undefined ? undefined : `${plan.month}-${String(day).padStart(2, "0")}`,
    };
    return { part: service.part, ...Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) };
  });
}
