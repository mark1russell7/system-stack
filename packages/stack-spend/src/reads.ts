// The reads of the used amount of a service. A read is live data: a program makes it, and it is no record of the layer.
// The functions of `use.ts` and of `use-check.ts` take a list of reads.

/**
 * These are the sources of a read.
 *
 * - `count`: a part of the stack counted the use, and it gives the cost of that use.
 * - `provider`: the provider of the service shows the cost of the use, for example on a usage page or in a usage API.
 */
export const USE_SOURCES: readonly ["count", "provider"] = ["count", "provider"];

/** A source of a read. */
export type UseSource = (typeof USE_SOURCES)[number];

/**
 * A read of the cost of the use of one service.
 *
 * The amount is the cost of the use from the start of a month until the read. It is the part of the cost that grows
 * with the use: the fixed price of a plan is not in it.
 */
export interface UseRead {
  /** The `id` of the part of the service. */
  readonly part: string;
  readonly source: UseSource;
  /** The cost of the use from the start of the month until the read, in the currency of the layer. */
  readonly amount: number;
  /** The date of the read, as `YYYY-MM-DD`. The month of this date is the month of the amount. */
  readonly date: string;
}

/** These are the default levels of the used share of a hard limit: 50, 80 and 100 percent. */
export const USE_LEVELS: readonly number[] = [0.5, 0.8, 1];

/** The options of the functions of the used amount. */
export interface UseOptions {
  /** The date of the check, as `YYYY-MM-DD`. Its month is the month of the used amounts. The functions have no clock. */
  readonly today: string;
  /** The levels: shares of the hard limit, each one above 0. The default is `USE_LEVELS`. */
  readonly levels?: readonly number[] | undefined;
  /** The largest age of the newest read of a service, in days. With no value, the gate examines no age. */
  readonly readDays?: number | undefined;
}
