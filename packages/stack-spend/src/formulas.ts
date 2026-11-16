import { app, axes, each, lit, ref, type Axis, type Expr } from "@mark1russell7/vex";

// The cost math, as Vex programs. A program is data: `explain` of Vex shows each step, and a host can keep it as JSON.
// The programs evaluate on the tree that `spendSpace` makes from a layer.

/** These are the kinds of the nodes of the spend tree. */
export const NODE_KINDS: readonly ["layer", "service", "limit"] = ["layer", "service", "limit"];

/** A kind of node of the spend tree. */
export type NodeKind = (typeof NODE_KINDS)[number];

/** This function gives the test of the field `limit` of a limit node: the kind of the limit. */
function isLimit(kind: string): Expr {
  return app("eq", ref("limit"), lit(kind));
}

/** This test tells if the balance of a prepaid limit gets money automatically. A limit without the field gives false. */
const RECHARGES: Expr = app("ifError", ref("recharge"), lit(false));

/**
 * This test tells if a limit node is a hard limit: the service stops at its amount.
 * A hard limit is a limit of the provider, a stop by code, or a prepaid balance with no automatic recharge.
 */
export const IS_HARD: Expr = app("or", app("or", isLimit("provider"), isLimit("code")), app("and", isLimit("prepaid"), app("not", RECHARGES)));

/** The hard limits of a service: its limit nodes that pass `IS_HARD`. */
export const HARD_LIMITS: Axis = axes.where(axes.children, IS_HARD);

/** The amount of each hard limit of a service. */
const HARD_AMOUNTS: Expr = each(HARD_LIMITS, ref("amount"));

/** The count of the hard limits of a service. */
export const HARD_COUNT: Expr = app("count", HARD_AMOUNTS);

/**
 * The hard limit of a service for a month: the smallest amount of its hard limits.
 * A service with no hard limit gives `#N/A`.
 */
export const HARD_LIMIT: Expr = app("min", HARD_AMOUNTS);

/** This function gives the test of the billing of a service. */
function isBilling(billing: string): Expr {
  return app("eq", ref("billing"), lit(billing));
}

/**
 * The largest cost of a service in a month.
 *
 * - `free`: 0.
 * - `fixed`: the price. A service with no price gives `#N/A`.
 * - `metered`: the price, or 0, plus the hard limit. A service with no hard limit gives `#N/A`: its cost has no bound.
 */
export const MONTH_MAX: Expr = app("if", isBilling("free"), lit(0), app("if", isBilling("fixed"), ref("price"), app("add", app("ifError", ref("price"), lit(0)), HARD_LIMIT)));

/** This test tells if the cost of a service in a month has a bound. */
const HAS_MAX: Expr = app("ifError", app("eq", MONTH_MAX, MONTH_MAX), lit(false));

/** The largest cost of each service of the layer in a month. The program evaluates at the layer node. */
const MONTH_MAXES: Expr = each(axes.children, MONTH_MAX);

/** The sum of the largest costs of the services that have a bound. The program evaluates at the layer node. */
export const BOUNDED_TOTAL: Expr = app("sum", MONTH_MAXES);

/** The keys of the services whose cost in a month has no bound. The program evaluates at the layer node. */
export const OPEN_SERVICES: Expr = app("keys", each(axes.where(axes.children, app("not", HAS_MAX)), ref("kind")));
