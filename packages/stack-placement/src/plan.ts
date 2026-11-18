import { RISK_SCHEMA, worksChance, type PartImportance, type RiskLayer } from "@mark1russell7/stack-risk";
import { monthTotal, SPEND_SCHEMA, type MonthTotal, type SpendLayer } from "@mark1russell7/stack-spend";
import { evolve, frontOf, sweep, type EvaluationRow, type Measure, type Objective, type SweepCounts } from "@mark1russell7/strategy-search";
import { checkSpace, configId, spaceSize, STRATEGY_SPACE_SCHEMA, type StrategyConfig, type StrategySpace } from "@mark1russell7/strategy-space";
import type { LayerJoiner, Stack } from "@mark1russell7/system-stack";
import type { Choice, PlacementLayer } from "./layer.ts";
import { placedStack } from "./place.ts";

// The plan of a placement: the front of the choices, with the expected cost against the chance that the part works.

/** The name of the strategy space of a placement. A config of the search names the space with it. */
export const PLACEMENT_ENGINE = "stack-placement";

/** The name and the version of the evaluation of a choice. It is part of the `id` of a run. */
export const PLACEMENT_EVALUATOR = "stack-placement/1";

/** The objectives of a plan: the expected cost of a month, as low as possible. And the chance that the part works, as high as possible. */
export const PLACEMENT_OBJECTIVES: readonly Objective[] = [
  { name: "cost", goal: "min", unit: "currency of the layer" },
  { name: "chance", goal: "max", unit: "chance from 0 to 1" },
];

/**
 * These are the names of the breaks of a choice. A choice with a break is not on the front.
 *
 * - `join`: the choice has a fault, or its fragments do not join into one stack.
 * - `layer`: the risk layer or the spend layer of the placed stack has a fault of its form. Or a chance is not from 0 to 1.
 * - `cost`: the expected cost is more than the limit `cost`.
 * - `bound`: the cost of a month from the spend layer is more than the limit `bound`, or a service has no bound.
 * - `chance`: the chance that the part works is less than the limit `chance`.
 */
export const PLAN_BREAKS: readonly ["join", "layer", "cost", "bound", "chance"] = ["join", "layer", "cost", "bound", "chance"];

/** A name of `PLAN_BREAKS`. */
export type PlanBreak = (typeof PLAN_BREAKS)[number];

/** The defaults of a plan. */
export const PLAN_DEFAULTS: { readonly evaluations: 2000; readonly seed: "stack-placement"; readonly importance: 5 } = { evaluations: 2000, seed: "stack-placement", importance: 5 };

/** The relative tolerance of a comparison with a limit. Thus a sum with a rounding error does not break a limit. */
export const LIMIT_TOLERANCE = 1e-9;

/**
 * The steps of the values that the search compares: a cost to 1e-9 of the currency, a chance to 1e-12. Two choices that give
 * one true value can give floats with a different rounding error. With these steps, such choices tie, and the front keeps each.
 * A row keeps the value before the step.
 */
export const OBJECTIVE_STEPS: { readonly cost: 1e-9; readonly chance: 1e-12 } = { cost: 1e-9, chance: 1e-12 };

/** The options of `planPlacement`. */
export interface PlanOptions {
  /** The add-ons that join the layers of the fragments. The list has the risk add-on and the spend add-on, and the add-on of each other layer of a fragment. */
  readonly joiners: readonly LayerJoiner<unknown>[];
  /** The most evaluations. A space with this count of choices or less gets a grid of each choice. A larger space gets a genetic search. The default is 2000. */
  readonly evaluations?: number | undefined;
  /** The seed of a genetic search: a whole number, or a name. The default is `stack-placement`. */
  readonly seed?: number | string | undefined;
  /** The largest count of steps of the calculation of one chance. The default is the default of `worksChance`. */
  readonly maxSteps?: number | undefined;
  /** The count of the most important parts in each row of the front. The default is 5. */
  readonly importance?: number | undefined;
}

/** One row of the front of a plan: a choice that keeps each limit, and its measures. */
export interface PlacementRow {
  /** The `id` of the config of the choice in the search. */
  readonly config: string;
  /** The key of the candidate of each slot. An empty optional slot has the value `null`. */
  readonly choice: Choice;
  /** The source of each chosen candidate with a source, by the `id` of its slot. */
  readonly sources: Readonly<Record<string, string>>;
  /** The `id` of each shared fragment of the placed stack. */
  readonly shared: readonly string[];
  /** The expected cost of a month. */
  readonly cost: number;
  /** The chance that the part of the layer works. */
  readonly chance: number;
  /** The largest cost of a month from the spend layer, or `null` when a service has no bound. */
  readonly bound: number | null;
  /** The part of each service with no bound. */
  readonly open: readonly string[];
  /** The most important parts for the chance, from the largest importance. */
  readonly importance: readonly PartImportance[];
  /** The parts of the paths with no chance record. The calculation uses the chance 1 for each. */
  readonly assumed: readonly string[];
}

/**
 * The plan of a placement.
 *
 * - `method`: `grid` for each choice of the space, `evolve` for a genetic search of a larger space.
 * - `front`: the choices that no other choice beats on the cost and on the chance, from the lowest cost.
 *   Rows with one cost are from the largest chance. Rows with equal values are in the order of their config.
 * - `breaks`: the count of the evaluated choices with each break, for the breaks with one or more choices.
 */
export interface PlacementPlan {
  readonly method: "grid" | "evolve";
  /** The `id` of the run of the search, from the space, the enumeration, the objectives and the evaluator. */
  readonly run: string;
  /** The count of the evaluated choices. */
  readonly evaluations: number;
  /** The count of the choices of the space, as a decimal text. The count can be larger than the largest safe number. */
  readonly size: string;
  readonly counts: SweepCounts;
  readonly front: readonly PlacementRow[];
  readonly breaks: Readonly<Partial<Record<PlanBreak, number>>>;
}

/**
 * This function gives the strategy space of a layer. Each slot is one stage, and each candidate is one option with no params.
 * An optional slot is an optional stage.
 */
export function placementSpace(layer: PlacementLayer): StrategySpace {
  return {
    schema: STRATEGY_SPACE_SCHEMA,
    engine: PLACEMENT_ENGINE,
    version: "1",
    stages: layer.slots.map((slot) => ({
      name: slot.id,
      options: slot.candidates.map((candidate) => ({ id: candidate.key, params: [] })),
      ...(slot.optional === true ? { optional: true } : {}),
    })),
  };
}

/** This function gives the choice of a config of the space of a layer. A stage with no option gives the value `null`. */
export function choiceOf(config: StrategyConfig): Choice {
  return Object.fromEntries(Object.entries(config.stages).map(([stage, picked]) => [stage, picked?.option ?? null]));
}

/** This function tells if a whole number is 1 or more. */
function isCount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/** This function tells if a value is more than a limit, with the tolerance `LIMIT_TOLERANCE`. */
function over(value: number, limit: number): boolean {
  return value > limit + LIMIT_TOLERANCE * Math.max(1, Math.abs(limit));
}

/** This function gives a value at the nearest multiple of a step. A value that is not finite stays as it is. */
function stepped(value: number, step: number): number {
  return Number.isFinite(value) ? Math.round(value / step) * step : value;
}

/**
 * This function gives the problems of the options of a plan. A problem is a bad count, or joiners with no risk add-on or no spend add-on.
 *
 * @param options - The options of a plan
 * @returns The problems, or an empty list for good options
 */
export function planProblems(options: PlanOptions): string[] {
  const problems: string[] = [];
  for (const [name, value] of [
    ["evaluations", options.evaluations],
    ["maxSteps", options.maxSteps],
    ["importance", options.importance],
  ] as const) {
    if (value !== undefined && !isCount(value)) problems.push(`The option "${name}" is ${String(value)}. It must be a whole number of 1 or more.`);
  }
  for (const schema of [RISK_SCHEMA, SPEND_SCHEMA]) {
    if (!options.joiners.some((joiner) => joiner.schema === schema)) problems.push(`The list of joiners has no add-on of "${schema}".`);
  }
  return problems;
}

/** The assessment of one choice: its measure for the search, and its row when it keeps each limit. */
interface Assessment {
  readonly measure: Measure;
  readonly row?: PlacementRow;
}

/** This function reads a layer of a placed stack with the `parse` of its add-on. A stack with no such layer gives `undefined`. */
function readLayer<Layer>(stack: Stack, joiner: LayerJoiner<unknown>): { readonly ok: true; readonly layer: Layer | undefined } | { readonly ok: false } {
  const value = stack.layers !== undefined && Object.hasOwn(stack.layers, joiner.schema) ? stack.layers[joiner.schema] : undefined;
  if (value === undefined) return { ok: true, layer: undefined };
  const read = joiner.parse(value);
  return read.ok ? { ok: true, layer: read.layer as Layer } : { ok: false };
}

/**
 * This function gives the plan of a placement: the front of the choices, with the expected cost against the chance that the part works.
 *
 * - Each choice gives one placed stack, from `placedStack`. `worksChance` of `stack-risk` gives the chance that the part works.
 * - `monthTotal` of `stack-spend` gives the largest cost of a month, for the limit `bound`.
 * - A space with the count `evaluations` of choices or less gets a grid of each choice. A larger space gets a seeded genetic search.
 * - A choice that breaks a limit, or whose stack has a fault, is not on the front. `breaks` counts each break.
 *
 * The result is deterministic: one layer, one stack and one set of options give one plan.
 *
 * @param layer - The placement layer
 * @param stack - The base stack
 * @param options - The joiners and the options of the search
 * @returns The plan
 * @throws RangeError when an option is bad, or when the space of the layer has a problem, for example a slot with no candidate
 */
export function planPlacement(layer: PlacementLayer, stack: Stack, options: PlanOptions): PlacementPlan {
  const problems = planProblems(options);
  const space = placementSpace(layer);
  problems.push(...checkSpace(space).map((item) => item.detail));
  if (problems.length > 0) throw new RangeError(`The plan of the placement has problems: ${problems.join(" ")}`);
  const risks = options.joiners.find((joiner) => joiner.schema === RISK_SCHEMA);
  const spends = options.joiners.find((joiner) => joiner.schema === SPEND_SCHEMA);
  if (risks === undefined || spends === undefined) throw new RangeError("The list of joiners has no risk add-on or no spend add-on.");
  const evaluations = options.evaluations ?? PLAN_DEFAULTS.evaluations;
  const importance = options.importance ?? PLAN_DEFAULTS.importance;
  const limits = layer.limits ?? {};
  const sources = (choice: Choice): Record<string, string> => {
    const found: Record<string, string> = {};
    for (const slot of layer.slots) {
      const source = slot.candidates.find((candidate) => candidate.key === choice[slot.id])?.source;
      if (source !== undefined) found[slot.id] = source;
    }
    return found;
  };
  const assess = (config: string, choice: Choice): Assessment => {
    const placed = placedStack(layer, stack, choice, options.joiners);
    if (!placed.ok) return { measure: { breaks: ["join"], values: {} } };
    const risk = readLayer<RiskLayer>(placed.stack, risks);
    const spend = readLayer<SpendLayer>(placed.stack, spends);
    if (!risk.ok || !spend.ok) return { measure: { breaks: ["layer"], values: { cost: placed.cost } } };
    let works: ReturnType<typeof worksChance>;
    try {
      works = worksChance(risk.layer ?? { schema: RISK_SCHEMA, goals: [] }, placed.stack, layer.part, options.maxSteps === undefined ? {} : { maxSteps: options.maxSteps });
    } catch (error) {
      if (error instanceof RangeError) return { measure: { breaks: ["layer"], values: { cost: placed.cost } } };
      throw error;
    }
    const total: MonthTotal = spend.layer === undefined ? { bounded: 0, open: [] } : monthTotal(spend.layer);
    const breaks: PlanBreak[] = [];
    if (limits.cost !== undefined && over(placed.cost, limits.cost)) breaks.push("cost");
    if (limits.bound !== undefined && (total.open.length > 0 || over(total.bounded, limits.bound))) breaks.push("bound");
    if (limits.chance !== undefined && works.kind === "exact" && over(limits.chance, works.value)) breaks.push("chance");
    const chance = works.kind === "exact" ? works.value : Number.NaN;
    const measure: Measure = { breaks, values: { cost: stepped(placed.cost, OBJECTIVE_STEPS.cost), chance: stepped(chance, OBJECTIVE_STEPS.chance) } };
    if (works.kind !== "exact" || breaks.length > 0) return { measure };
    return {
      measure,
      row: {
        config,
        choice,
        sources: sources(choice),
        shared: placed.shared,
        cost: placed.cost,
        chance,
        bound: total.open.length > 0 ? null : total.bounded,
        open: total.open,
        importance: works.importance.slice(0, importance),
        assumed: works.assumed,
      },
    };
  };
  const assessed = new Map<string, Assessment>();
  const evaluate = (config: StrategyConfig): Measure => {
    const id = configId(space, config);
    const known = assessed.get(id);
    if (known !== undefined) return known.measure;
    const fresh = assess(id, choiceOf(config));
    assessed.set(id, fresh);
    return fresh.measure;
  };
  const size = spaceSize(space, { levels: 1 }).base;
  const grid = size <= BigInt(evaluations);
  const run =
    grid
      ? sweep(space, { objectives: PLACEMENT_OBJECTIVES, evaluate, enumerate: { mode: "grid", levels: 1, limit: Math.max(1, Number(size)) }, evaluator: PLACEMENT_EVALUATOR })
      : evolve(space, { objectives: PLACEMENT_OBJECTIVES, evaluate, seed: options.seed ?? PLAN_DEFAULTS.seed, evaluations, evaluator: PLACEMENT_EVALUATOR });
  const front = frontOf(run)
    .map((entry) => assessed.get(entry.row.config)?.row)
    .filter((row): row is PlacementRow => row !== undefined)
    .sort((a, b) => a.cost - b.cost || b.chance - a.chance || (a.config < b.config ? -1 : a.config > b.config ? 1 : 0));
  return { method: grid ? "grid" : "evolve", run: run.run, evaluations: run.rows.length, size: size.toString(), counts: run.counts, front, breaks: breakCounts(run.rows) };
}

/** This function counts the rows with each break, in the order of `PLAN_BREAKS`. */
function breakCounts(rows: readonly EvaluationRow[]): Partial<Record<PlanBreak, number>> {
  const counts: Partial<Record<PlanBreak, number>> = {};
  for (const name of PLAN_BREAKS) {
    const count = rows.filter((row) => row.breaks.includes(name)).length;
    if (count > 0) counts[name] = count;
  }
  return counts;
}
