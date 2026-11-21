import { evaluate, space, type Expr, type Result, type Space } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { working, type Stack } from "@mark1russell7/system-stack";
import { BOUNDED_TOTAL, HARD_LIMIT, MONTH_MAX, OPEN_SERVICES } from "./formulas.ts";
import type { Billing, Limit, Service, SpendLayer } from "./layer.ts";
import { numberOf } from "./values.ts";

// The state of the cost of each service of a layer. The layer becomes a tree, and the programs of `formulas.ts` evaluate on it.

/** The key of the layer node: the root of the spend tree. */
export const LAYER_KEY = "layer";

const SERVICE_PREFIX = "service:";

/** This function gives the key of the node of a service: the text `service:` and the `id` of its part. */
export function serviceKey(part: string): string {
  return `${SERVICE_PREFIX}${part}`;
}

const NEXT_PREFIX = "next:";

/**
 * This function gives the key of the node of the plan after the end of the plan of a service.
 * The key is the text `next:` and the `id` of the part of the service.
 */
export function nextKey(part: string): string {
  return `${NEXT_PREFIX}${part}`;
}

/** This function gives the record of a limit node. */
function limitRecord(limit: Limit): Readonly<Record<string, unknown>> {
  return {
    kind: "limit",
    limit: limit.kind,
    amount: limit.amount,
    ...(limit.recharge === undefined ? {} : { recharge: limit.recharge }),
    ...(limit.stop === undefined ? {} : { stop: limit.stop }),
  };
}

/**
 * The parts that do not work at this time, for the limits of a layer. A stop by code holds only while its part `stop` works.
 * Thus with these options, a stop by code whose part does not work is not in force.
 */
export interface DownOptions {
  /** This field is the stack of the layer. */
  readonly stack: Stack;
  /** This field has the parts of the stack that do not work, for example from the monitors of the system. */
  readonly down: Iterable<string>;
}

/**
 * This function gives a test that tells if a limit is in force. Without options, each limit is in force.
 * With options, a stop by code is in force only when its part `stop` works. A stop by code with no part `stop` is not in force.
 */
function inForce(options: DownOptions | undefined): (limit: Limit) => boolean {
  if (options === undefined) return () => true;
  const up = working(options.stack, options.down);
  return (limit) => limit.kind !== "code" || (limit.stop !== undefined && up.has(limit.stop));
}

/** This function gives the first record of each part of a layer, in the sequence of the records. */
export function firstServices(layer: SpendLayer): readonly Service[] {
  const seen = new Set<string>();
  return layer.services.filter((service) => {
    if (seen.has(service.part)) return false;
    seen.add(service.part);
    return true;
  });
}

/**
 * This function gives the tree of a layer, as a space of Vex.
 *
 * - The layer is the root, with the key `LAYER_KEY`.
 * - A service is a child of the layer. Its fields are `billing` and `price`.
 * - A limit in force is a child of its service. Its fields are `limit` (its kind), `amount`, `recharge` and `stop`.
 * - The plan after the end of a plan is a child of its service, with the kind `next` and the key of `nextKey`. Its fields are `billing` and `price`.
 * - A limit of the plan after the end is a child of that `next` node.
 *
 * A wanted limit is not in the tree, because it is not in force. The first record of a part is used.
 * With `options`, a stop by code whose part `stop` does not work is not in the tree either. The key of a limit keeps
 * the position of the limit in its record.
 */
export function spendSpace(layer: SpendLayer, options?: DownOptions): Space {
  const held = inForce(options);
  const records: Record<string, Readonly<Record<string, unknown>>> = { [LAYER_KEY]: { kind: "layer" } };
  const parents: Record<string, string | null> = { [LAYER_KEY]: null };
  for (const service of firstServices(layer)) {
    const key = serviceKey(service.part);
    records[key] = { kind: "service", billing: service.billing, ...(service.price === undefined ? {} : { price: service.price }) };
    parents[key] = LAYER_KEY;
    (service.limits ?? []).forEach((limit, index) => {
      if (!held(limit)) return;
      const child = `limit:${service.part}:${String(index)}`;
      records[child] = limitRecord(limit);
      parents[child] = key;
    });
    const next = service.ends?.next;
    if (next === undefined) continue;
    const after = nextKey(service.part);
    records[after] = { kind: "next", billing: next.billing, ...(next.price === undefined ? {} : { price: next.price }) };
    parents[after] = key;
    (next.limits ?? []).forEach((limit, index) => {
      if (!held(limit)) return;
      const child = `next-limit:${service.part}:${String(index)}`;
      records[child] = limitRecord(limit);
      parents[child] = after;
    });
  }
  return space.tree(records, parents);
}

/** This function evaluates a program of `formulas.ts` at a node of a tree. It gives the value, or the error value. */
function run(program: Expr, tree: Space, origin: string): Result<unknown> {
  return evaluate(program, { space: tree, origin, domains: [NumDomain, BoolDomain, TextDomain] });
}

/**
 * This function evaluates a program of `formulas.ts` at a service of a tree. It gives the value, or the error value.
 * `tree` is the result of `spendSpace`, and `part` is the `id` of the part of the service.
 */
export function evaluateService(program: Expr, tree: Space, part: string): Result<unknown> {
  return run(program, tree, serviceKey(part));
}

/**
 * This function evaluates a program of `formulas.ts` at the plan of a service after the end of its plan.
 * A service with no plan after an end gives an error value. `tree` is the result of `spendSpace`.
 */
export function evaluateNext(program: Expr, tree: Space, part: string): Result<unknown> {
  return run(program, tree, nextKey(part));
}

/** The state of the cost of one service of a layer. */
export interface ServiceState {
  /** The `id` of the part of the service. */
  readonly part: string;
  readonly billing: Billing;
  /** The hard limit of the service for a month: the smallest amount of its hard limits. A service with no hard limit has none. */
  readonly hardLimit?: number | undefined;
  /** The hard limit for a month after the end of the plan. A service has none with no plan after an end, or with no hard limit in that plan. */
  readonly nextLimit?: number | undefined;
  /**
   * The largest cost of the service in a month, before the end of its plan or after it.
   * A service has none when one of these costs has no bound.
   */
  readonly monthMax?: number | undefined;
}

/**
 * This function gives the state of the cost of each service of a layer, in the sequence of the services.
 * With `options`, a stop by code whose part `stop` does not work is not in force.
 */
export function serviceStates(layer: SpendLayer, options?: DownOptions): ServiceState[] {
  const tree = spendSpace(layer, options);
  return firstServices(layer).map((service) => {
    const hardLimit = numberOf(evaluateService(HARD_LIMIT, tree, service.part));
    const nextLimit = service.ends?.next === undefined ? undefined : numberOf(evaluateNext(HARD_LIMIT, tree, service.part));
    const monthMax = numberOf(evaluateService(MONTH_MAX, tree, service.part));
    return {
      part: service.part,
      billing: service.billing,
      ...(hardLimit === undefined ? {} : { hardLimit }),
      ...(nextLimit === undefined ? {} : { nextLimit }),
      ...(monthMax === undefined ? {} : { monthMax }),
    };
  });
}

/** The largest cost of a layer in a month. */
export interface MonthTotal {
  /** The sum of the largest costs of the services that have a bound, in the currency of the layer. */
  readonly bounded: number;
  /** The `id` of the part of each service whose cost has no bound. With one or more, the cost of the layer has no bound. */
  readonly open: readonly string[];
}

/**
 * This function gives the largest cost of a layer in a month.
 * The cost of the layer has a bound only when `open` is empty. Then `bounded` is that bound.
 * With `options`, a stop by code whose part `stop` does not work is not in force.
 */
export function monthTotal(layer: SpendLayer, options?: DownOptions): MonthTotal {
  const tree = spendSpace(layer, options);
  const keys = run(OPEN_SERVICES, tree, LAYER_KEY);
  const open = keys.ok && Array.isArray(keys.value) ? keys.value.filter((key): key is string => typeof key === "string").map((key) => key.slice(SERVICE_PREFIX.length)) : [];
  return { bounded: numberOf(run(BOUNDED_TOTAL, tree, LAYER_KEY)) ?? 0, open };
}
