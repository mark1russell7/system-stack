import { app, axes, each, evaluate, lit, ref, space, type Expr, type Result, type Space } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";
import { isBuiltin, resourceAddress, resourceProvider, type TofuLayer } from "./layer.ts";
import { firstResources } from "./queries.ts";

// The planned cost of the resources, as Vex programs. A program is data: `explain` of Vex shows each step.
// The layer becomes a tree: the layer, then each account, then each resource of the account.

/**
 * The limit of the cost of a part for a month. A state of a service of the spend add-on has this form.
 * Thus a host gives the states of a spend layer as the budgets, and the two add-ons do not know each other.
 */
export interface Budget {
  /** The `id` of the part: an account, a project or a tenant. */
  readonly part: string;
  /** The hard limit of the cost of the part for a month. A part with no hard limit has none. */
  readonly hardLimit?: number | undefined;
}

/** The key of the layer node: the root of the cost tree. */
export const COST_LAYER_KEY = "layer";

/** This function gives the key of the node of an account: the text `account:` and the `id` of its part. */
export function accountKey(part: string): string {
  return `account:${part}`;
}

/** This function gives the key of the node of a resource: the text `resource:` and its address. */
export function resourceKey(address: string): string {
  return `resource:${address}`;
}

/** This function tells if a value is a finite number, 0 or more. */
export function isZeroOrMore(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

/** This function gives the first budget of each part, by the `id` of the part. */
export function budgetsByPart(budgets: readonly Budget[]): Map<string, Budget> {
  const byPart = new Map<string, Budget>();
  for (const budget of budgets) if (!byPart.has(budget.part)) byPart.set(budget.part, budget);
  return byPart;
}

/** The planned cost of each resource of an account. A resource with no known cost gives an error value. */
const COSTS: Expr = each(axes.children, ref("cost"));

/** The planned cost of an account in a month: the sum of the known costs of its resources. The program evaluates at an account node. */
export const PLANNED: Expr = app("sum", COSTS);

/** This test tells if a resource node has a known cost. */
const HAS_COST: Expr = app("ifError", app("eq", ref("cost"), ref("cost")), lit(false));

/** The count of the resources of an account with no known cost. The program evaluates at an account node. */
export const UNKNOWN_COSTS: Expr = app("count", each(axes.where(axes.children, app("not", HAS_COST)), ref("kind")));

/** This test tells if the planned cost of an account is more than its hard limit. An account with no hard limit gives an error value. */
export const PLANNED_OVER: Expr = app("gt", PLANNED, ref("limit"));

/** The room of an account: its hard limit less its planned cost. An account with no hard limit gives an error value. */
export const PLANNED_ROOM: Expr = app("subtract", ref("limit"), PLANNED);

/** The planned cost of the layer in a month: the sum of the planned costs of its accounts. The program evaluates at the layer node. */
export const PLANNED_TOTAL: Expr = app("sum", each(axes.children, PLANNED));

/**
 * This function gives the cost tree of a layer, as a space of Vex.
 *
 * - The layer is the root, with the key `COST_LAYER_KEY`.
 * - An account is a child of the layer: the part of a provider configuration that has one resource or more. Its field `limit` is its hard limit.
 * - A resource is a child of the account of its provider configuration. Its field `cost` is its planned cost.
 *
 * A cost or a limit that is less than 0 or not finite is not in the tree: it is not known.
 * A resource with no provider configuration is not in the tree, because it counts against no account.
 */
export function costSpace(layer: TofuLayer, budgets: readonly Budget[] = []): Space {
  const limits = budgetsByPart(budgets);
  const records: Record<string, Readonly<Record<string, unknown>>> = { [COST_LAYER_KEY]: { kind: "layer" } };
  const parents: Record<string, string | null> = { [COST_LAYER_KEY]: null };
  for (const resource of firstResources(layer)) {
    const provider = isBuiltin(resource) ? undefined : resourceProvider(layer, resource);
    if (provider === undefined) continue;
    const account = accountKey(provider.part);
    if (records[account] === undefined) {
      const limit = limits.get(provider.part)?.hardLimit;
      records[account] = { kind: "account", part: provider.part, ...(limit !== undefined && isZeroOrMore(limit) ? { limit } : {}) };
      parents[account] = COST_LAYER_KEY;
    }
    const key = resourceKey(resourceAddress(resource));
    records[key] = { kind: "resource", ...(resource.cost !== undefined && isZeroOrMore(resource.cost) ? { cost: resource.cost } : {}) };
    parents[key] = account;
  }
  return space.tree(records, parents);
}

/**
 * This function evaluates a program of this module at a node of a cost tree. It gives the value, or the error value.
 * `tree` is the result of `costSpace`, and `key` is the key of a node.
 */
export function evaluateCost(program: Expr, tree: Space, key: string): Result<unknown> {
  return evaluate(program, { space: tree, origin: key, domains: [NumDomain, BoolDomain, TextDomain] });
}

/** This function gives the number of a result, or `undefined` for an error value. */
function numberOf(result: Result<unknown>): number | undefined {
  return result.ok && typeof result.value === "number" ? result.value : undefined;
}

/** The state of the planned cost of one account of a layer. */
export interface AccountState {
  /** The `id` of the part of the account. */
  readonly part: string;
  /** The addresses of the resources that count against the account, sorted. */
  readonly resources: readonly string[];
  /** The planned cost of the account in a month: the sum of the known costs of its resources. */
  readonly planned: number;
  /** The count of the resources with no known cost. With one or more, `planned` is not the whole cost. */
  readonly unknown: number;
  /** The hard limit of the account for a month. An account with no budget, or with a budget with no hard limit, has none. */
  readonly limit?: number | undefined;
  /** `true`: the planned cost is more than the hard limit. An account with no hard limit has no value. */
  readonly over?: boolean | undefined;
  /** The hard limit less the planned cost. An account with no hard limit has no value. */
  readonly room?: number | undefined;
}

/** This function gives the state of the planned cost of each account of a layer, in the sequence of the first resource of each account. */
export function accountStates(layer: TofuLayer, budgets: readonly Budget[] = []): AccountState[] {
  const tree = costSpace(layer, budgets);
  const accounts = new Map<string, string[]>();
  for (const resource of firstResources(layer)) {
    const provider = isBuiltin(resource) ? undefined : resourceProvider(layer, resource);
    if (provider === undefined) continue;
    const addresses = accounts.get(provider.part) ?? [];
    addresses.push(resourceAddress(resource));
    accounts.set(provider.part, addresses);
  }
  return [...accounts].map(([part, addresses]) => {
    const key = accountKey(part);
    const limit = numberOf(evaluateCost(ref("limit"), tree, key));
    const over = evaluateCost(PLANNED_OVER, tree, key);
    const room = numberOf(evaluateCost(PLANNED_ROOM, tree, key));
    return {
      part,
      resources: [...addresses].sort(),
      planned: numberOf(evaluateCost(PLANNED, tree, key)) ?? 0,
      unknown: numberOf(evaluateCost(UNKNOWN_COSTS, tree, key)) ?? 0,
      ...(limit === undefined ? {} : { limit }),
      ...(over.ok && typeof over.value === "boolean" ? { over: over.value } : {}),
      ...(room === undefined ? {} : { room }),
    };
  });
}

/** This function gives the planned cost of a layer in a month: the sum of the planned costs of its accounts. */
export function plannedTotal(layer: TofuLayer): number {
  return numberOf(evaluateCost(PLANNED_TOTAL, costSpace(layer), COST_LAYER_KEY)) ?? 0;
}
