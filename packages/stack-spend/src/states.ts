import { evaluate, space, type Expr, type Result, type Space } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { BOUNDED_TOTAL, HARD_LIMIT, MONTH_MAX, OPEN_SERVICES } from "./formulas.ts";
import type { Billing, Service, SpendLayer } from "./layer.ts";

// The state of the cost of each service of a layer. The layer becomes a tree, and the programs of `formulas.ts` evaluate on it.

/** The key of the layer node: the root of the spend tree. */
export const LAYER_KEY = "layer";

const SERVICE_PREFIX = "service:";

/** This function gives the key of the node of a service: the text `service:` and the `id` of its part. */
export function serviceKey(part: string): string {
  return `${SERVICE_PREFIX}${part}`;
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
 *
 * A wanted limit is not in the tree, because it is not in force. The first record of a part is used.
 */
export function spendSpace(layer: SpendLayer): Space {
  const records: Record<string, Readonly<Record<string, unknown>>> = { [LAYER_KEY]: { kind: "layer" } };
  const parents: Record<string, string | null> = { [LAYER_KEY]: null };
  for (const service of firstServices(layer)) {
    const key = serviceKey(service.part);
    records[key] = { kind: "service", billing: service.billing, ...(service.price === undefined ? {} : { price: service.price }) };
    parents[key] = LAYER_KEY;
    (service.limits ?? []).forEach((limit, index) => {
      const child = `limit:${service.part}:${String(index)}`;
      records[child] = {
        kind: "limit",
        limit: limit.kind,
        amount: limit.amount,
        ...(limit.recharge === undefined ? {} : { recharge: limit.recharge }),
        ...(limit.stop === undefined ? {} : { stop: limit.stop }),
      };
      parents[child] = key;
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

/** This function gives the number of a result, or `undefined` for an error value. */
function numberOf(result: Result<unknown>): number | undefined {
  return result.ok && typeof result.value === "number" ? result.value : undefined;
}

/** The state of the cost of one service of a layer. */
export interface ServiceState {
  /** The `id` of the part of the service. */
  readonly part: string;
  readonly billing: Billing;
  /** The hard limit of the service for a month: the smallest amount of its hard limits. A service with no hard limit has none. */
  readonly hardLimit?: number | undefined;
  /** The largest cost of the service in a month. A service has none when its cost has no bound. */
  readonly monthMax?: number | undefined;
}

/** This function gives the state of the cost of each service of a layer, in the sequence of the services. */
export function serviceStates(layer: SpendLayer): ServiceState[] {
  const tree = spendSpace(layer);
  return firstServices(layer).map((service) => {
    const hardLimit = numberOf(evaluateService(HARD_LIMIT, tree, service.part));
    const monthMax = numberOf(evaluateService(MONTH_MAX, tree, service.part));
    return { part: service.part, billing: service.billing, ...(hardLimit === undefined ? {} : { hardLimit }), ...(monthMax === undefined ? {} : { monthMax }) };
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
 */
export function monthTotal(layer: SpendLayer): MonthTotal {
  const tree = spendSpace(layer);
  const keys = run(OPEN_SERVICES, tree, LAYER_KEY);
  const open = keys.ok && Array.isArray(keys.value) ? keys.value.filter((key): key is string => typeof key === "string").map((key) => key.slice(SERVICE_PREFIX.length)) : [];
  return { bounded: numberOf(run(BOUNDED_TOTAL, tree, LAYER_KEY)) ?? 0, open };
}
