import { app, axes, each, lit, ref, type Axis, type Expr } from "@mark1russell7/vex";

// The cost math, as Vex programs. A program is data: `explain` of Vex shows each step, and a host can keep it as JSON.
// The programs evaluate on the tree that `spendSpace` makes from a layer.

/**
 * These are the kinds of the nodes of the spend tree.
 *
 * - `layer`: the root.
 * - `service`: a child of the layer. It gives the cost of a service, or the cost before the end of its plan.
 * - `limit`: a child of a service or of a `next` node.
 * - `next`: a child of a service. It gives the cost after the end of the plan.
 */
export const NODE_KINDS: readonly ["layer", "service", "limit", "next"] = ["layer", "service", "limit", "next"];

/** A kind of node of the spend tree. */
export type NodeKind = (typeof NODE_KINDS)[number];

/** This function gives the test of the kind of a node. */
function isKind(kind: NodeKind): Expr {
  return app("eq", ref("kind"), lit(kind));
}

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

/** The limits of a plan: the limit nodes among the children of a service node or of a `next` node. */
const LIMITS: Axis = axes.where(axes.children, isKind("limit"));

/** The hard limits of a plan: its limit nodes that pass `IS_HARD`. */
export const HARD_LIMITS: Axis = axes.where(LIMITS, IS_HARD);

/** The amount of each hard limit of a plan. */
const HARD_AMOUNTS: Expr = each(HARD_LIMITS, ref("amount"));

/** The count of the hard limits of a plan. */
export const HARD_COUNT: Expr = app("count", HARD_AMOUNTS);

/**
 * The hard limit of a plan for a month: the smallest amount of its hard limits.
 * A plan with no hard limit gives `#N/A`. The program evaluates at a service node or at a `next` node.
 */
export const HARD_LIMIT: Expr = app("min", HARD_AMOUNTS);

/** This function gives the test of the billing of a plan. */
function isBilling(billing: string): Expr {
  return app("eq", ref("billing"), lit(billing));
}

/**
 * The largest cost of one plan in a month. The program evaluates at a service node or at a `next` node.
 *
 * - `free`: 0.
 * - `fixed`: the price. A plan with no price gives `#N/A`.
 * - `metered`: the price, or 0, plus the hard limit. A plan with no hard limit gives `#N/A`: its cost has no bound.
 */
export const PLAN_MAX: Expr = app("if", isBilling("free"), lit(0), app("if", isBilling("fixed"), ref("price"), app("add", app("ifError", ref("price"), lit(0)), HARD_LIMIT)));

/** The plan of a service after the end of its plan: the `next` node among the children of the service. A service has one at most. */
export const NEXT_PLANS: Axis = axes.where(axes.children, isKind("next"));

/** The count of the `next` nodes of a service: 0 or 1. The items are the literal 1, so a plan with no bound has a count too. */
const NEXT_COUNT: Expr = app("count", each(NEXT_PLANS, lit(1)));

/** The largest cost of a month after the end of the plan. A cost with no bound gives `#N/A`. */
const NEXT_MAX: Expr = app("nth", each(NEXT_PLANS, PLAN_MAX), lit(0));

/**
 * The largest cost of a service in a month, before the end of its plan or after it.
 *
 * - A service with no plan after an end gives `PLAN_MAX`.
 * - A service with a plan after an end gives the larger of the two costs. When one of the two has no bound, the result is `#N/A`.
 */
export const MONTH_MAX: Expr = app("if", app("eq", NEXT_COUNT, lit(0)), PLAN_MAX, app("max", PLAN_MAX, NEXT_MAX));

/** This test tells if the cost of a service in a month has a bound. */
const HAS_MAX: Expr = app("ifError", app("eq", MONTH_MAX, MONTH_MAX), lit(false));

/** The largest cost of each service of the layer in a month. The program evaluates at the layer node. */
const MONTH_MAXES: Expr = each(axes.children, MONTH_MAX);

/** The sum of the largest costs of the services that have a bound. The program evaluates at the layer node. */
export const BOUNDED_TOTAL: Expr = app("sum", MONTH_MAXES);

/** The keys of the services whose cost in a month has no bound. The program evaluates at the layer node. */
export const OPEN_SERVICES: Expr = app("keys", each(axes.where(axes.children, app("not", HAS_MAX)), ref("kind")));
