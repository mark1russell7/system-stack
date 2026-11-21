import { layout } from "ireko";
import { partNeeds, partsById, SAMPLE_STACK, working, type Need, type Part } from "@mark1russell7/system-stack";
import { goalStates, SAMPLE_RISK, worksChance, type GoalState } from "@mark1russell7/stack-risk";
import { monthTotal, SAMPLE_SPEND, serviceStates, type Billing, type MonthTotal } from "@mark1russell7/stack-spend";

// The model of the demo: the state of the sample stack when a visitor stops parts. This file has no DOM code.
// Each answer comes from a query of the packages. The page only shows the answers.

/** The stack of the demo: the sample stack of the core. */
export const STACK = SAMPLE_STACK;

/** The part of the goal of the demo: the function of the sample stack. */
export const GOAL = "alert";

/** A set of parts that do not work, with a name for a person. */
export interface Scenario {
  readonly id: string;
  /** The name of the scenario for the button. */
  readonly name: string;
  /** The `id` of each part that does not work, in the sequence of the stack. */
  readonly down: readonly string[];
}

/** The scenarios of the demo. The first scenario has no part down. */
export const SCENARIOS: readonly Scenario[] = [
  { id: "none", name: "Nothing is down", down: [] },
  { id: "power", name: "Power cut at home", down: ["home-power"] },
  { id: "card", name: "Card blocked", down: ["card"] },
  { id: "power-push", name: "Power cut, push down", down: ["home-power", "push"] },
  { id: "phone", name: "Phone lost", down: ["phone"] },
];

// The short label of each part of the sample stack, in one or two lines. A graph box on a phone is 60 pixels wide.
const LABELS: Readonly<Record<string, readonly string[]>> = {
  reader: ["Reader"],
  phone: ["Phone"],
  card: ["Payment", "card"],
  "home-power": ["Home", "power"],
  "home-network": ["Home", "network"],
  "home-host": ["Home", "computer"],
  "cloud-account": ["Cloud", "account"],
  "cloud-host": ["Cloud", "server"],
  "program-home": ["Program", "at home"],
  "program-cloud": ["Program", "in cloud"],
  "push-account": ["Push", "account"],
  push: ["Push", "service"],
  "call-account": ["Call", "account"],
  call: ["Call", "service"],
  alert: ["Alert"],
};

/** This function gives the short label of a part, in lines. A part with no label uses the words of its `id`. */
export function labelOf(id: string): readonly string[] {
  return LABELS[id] ?? id.split("-");
}

/** This function gives the short label of a part, in one line. */
export function shortName(id: string): string {
  return labelOf(id).join(" ");
}

/**
 * The state of a part in the demo.
 *
 * - `down`: the visitor stopped the part.
 * - `stopped`: the part does not work, because one of its needs does not hold.
 * - `point`: the part works, and its failure alone stops the goal.
 * - `works`: the part works.
 */
export type PartMark = "down" | "stopped" | "point" | "works";

/** A part of the stack, with its state in the demo. */
export interface PartView {
  readonly id: string;
  readonly kind: string;
  /** The name of the part for a person, from the stack. */
  readonly name: string;
  readonly mark: PartMark;
  /** The needs of the part, as a text for a person. */
  readonly needs: string;
}

/** A stop by code of an account, with the state of the part that stops the use. */
export interface CodeStop {
  /** The `id` of the part that stops the use. */
  readonly part: string;
  readonly amount: number;
  /** This field is true when the part that stops the use works. */
  readonly works: boolean;
}

/** An account of the spend layer, with the state of its cost in the demo. */
export interface ServiceView {
  readonly part: string;
  readonly billing: Billing;
  /** The hard limit of a month, from `serviceStates`. An account with no hard limit in force has none. */
  readonly hardLimit?: number | undefined;
  /** The largest cost of a month, from `serviceStates`. An account whose cost has no bound has none. */
  readonly monthMax?: number | undefined;
  /** The stops by code of the account, in the sequence of its record. */
  readonly stops: readonly CodeStop[];
}

/** The state of the whole demo for one set of parts that do not work. */
export interface DemoState {
  /** The `id` of each part that the visitor stopped, in the sequence of the stack. */
  readonly down: readonly string[];
  /** Each part of the stack, in the sequence of the stack. */
  readonly parts: readonly PartView[];
  /** The state of the goal, from `goalStates`. */
  readonly goal: GoalState;
  /** The chance that the goal works, from `worksChance`. A search that passed its limit gives none. */
  readonly chance?: number | undefined;
  /** The chance that the goal must have, from the risk layer. */
  readonly goalChance?: number | undefined;
  /** Each account of the spend layer, in the sequence of the layer. */
  readonly services: readonly ServiceView[];
  /** The largest cost of all accounts in a month, from `monthTotal`. */
  readonly total: MonthTotal;
  readonly currency: string;
}

/** This function gives the known parts of a list, one time each, in the sequence of the stack. */
export function cleanDown(down: Iterable<string>): string[] {
  const wanted = new Set(down);
  return STACK.parts.map((part) => part.id).filter((id, at, all) => wanted.has(id) && all.indexOf(id) === at);
}

/** This function gives the list of parts down after a visitor selects one part: the part stops, or it starts again. */
export function toggle(down: readonly string[], id: string): string[] {
  return cleanDown(down.includes(id) ? down.filter((part) => part !== id) : [...down, id]);
}

/** This function gives the scenario that has the same parts down, or `undefined`. */
export function scenarioOf(down: readonly string[]): Scenario | undefined {
  const list = cleanDown(down).join(",");
  return SCENARIOS.find((scenario) => cleanDown(scenario.down).join(",") === list);
}

const HASH_PREFIX = "#down=";

/** This function reads the parts down from the hash of the address. It ignores an unknown part. */
export function downFromHash(hash: string): string[] {
  if (!hash.startsWith(HASH_PREFIX)) return [];
  return cleanDown(decodeURIComponent(hash.slice(HASH_PREFIX.length)).split(","));
}

/** This function gives the hash of the address for the parts down. With no part down, the hash is empty. */
export function hashOf(down: readonly string[]): string {
  const list = cleanDown(down);
  return list.length === 0 ? "" : `${HASH_PREFIX}${list.join(",")}`;
}

/** This function joins texts for a person: "a", "a and b", "a, b and c". */
export function listText(items: readonly string[], word = "and"): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1] ?? ""}`;
}

/** This function gives a need as a text for a person. */
function needText(need: Need): string {
  if (typeof need === "string") return shortName(need);
  if ("all" in need) return listText(need.all.map(needText));
  const count = need.count ?? 1;
  const items = need.any.map(needText);
  return count === 1 ? `one of ${listText(items, "or")}` : `${String(count)} of ${listText(items)}`;
}

/** This function gives the needs of a part as a text for a person. */
export function needsText(part: Part): string {
  const needs = part.needs ?? [];
  return needs.length === 0 ? "nothing" : needs.map(needText).join("; ");
}

/** This function gives the state of the demo when the parts of `down` do not work. */
export function demoState(down: Iterable<string>): DemoState {
  const list = cleanDown(down);
  const up = working(STACK, list);
  const goal = goalStates(SAMPLE_RISK, STACK, { down: list }).find((state) => state.part === GOAL) ?? { part: GOAL, read: false };
  const points = new Set(goal.read ? goal.points : []);
  const parts = STACK.parts.map((part): PartView => {
    const mark: PartMark = list.includes(part.id) ? "down" : !up.has(part.id) ? "stopped" : points.has(part.id) ? "point" : "works";
    return { id: part.id, kind: part.kind, name: part.name ?? part.id, mark, needs: needsText(part) };
  });
  const chance = worksChance(SAMPLE_RISK, STACK, GOAL, { down: list });
  const options = { stack: STACK, down: list };
  const records = new Map(SAMPLE_SPEND.services.map((service) => [service.part, service]));
  const services = serviceStates(SAMPLE_SPEND, options).map((state): ServiceView => {
    const stops = (records.get(state.part)?.limits ?? []).flatMap((limit) => (limit.kind === "code" && limit.stop !== undefined ? [{ part: limit.stop, amount: limit.amount, works: up.has(limit.stop) }] : []));
    return { ...state, stops };
  });
  return {
    down: list,
    parts,
    goal,
    ...(chance.kind === "exact" ? { chance: chance.value } : {}),
    goalChance: SAMPLE_RISK.goals.find((entry) => entry.part === GOAL)?.chance,
    services,
    total: monthTotal(SAMPLE_SPEND, options),
    currency: SAMPLE_SPEND.currency,
  };
}

/** The shape of the graph: `wide` from left to right, `narrow` from top to bottom for a phone. */
export type Shape = "wide" | "narrow";

/** A box of the graph. `rank` is the layer of the box, from 0. */
export interface GraphNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rank: number;
}

/** A line of the graph from a need to the part that needs it. */
export interface GraphEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly points: readonly { readonly x: number; readonly y: number }[];
}

/** The graph of the needs of the stack, with the boxes and the lines of `ireko`. */
export interface GraphView {
  readonly shape: Shape;
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

// The size of a box and the space between the boxes for each shape. A narrow graph is 336 pixels wide: it fits a phone of 360 pixels.
const SHAPES = {
  wide: { side: "right", width: 128, height: 40, distance: 0, spacing: 16 },
  narrow: { side: "bottom", width: 60, height: 40, distance: 28, spacing: 6 },
} as const;

const ROOT = "demo-root";

/**
 * This function gives the graph of the needs of the stack. The strategy `layers` of `ireko` places the boxes, and its
 * router `orthogonal` draws the lines.
 *
 * @throws Error when `ireko` gives an error for the layout
 */
export function graphView(shape: Shape): GraphView {
  const size = SHAPES[shape];
  const ids = partsById(STACK);
  const edges = STACK.parts.flatMap((part) => partNeeds(part).filter((need) => ids.has(need)).map((need) => ({ id: `${need}>${part.id}`, source: need, target: part.id })));
  const result = layout(
    {
      root: {
        id: ROOT,
        mode: "nested",
        layout: { type: "layers", side: size.side, distance: size.distance },
        children: STACK.parts.map((part) => ({ id: part.id, size: { width: size.width, height: size.height } })),
      },
      edges,
    },
    { spacing: size.spacing, router: "orthogonal", header: 0 },
  );
  const errors = result.issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new Error(`The layout of the graph failed: ${errors.map((issue) => issue.message).join(" ")}`);
  const boxes = result.nodes.filter((node) => node.id !== ROOT);
  const along = (node: { readonly x: number; readonly y: number }): number => (shape === "wide" ? node.x : node.y);
  const levels = [...new Set(boxes.map(along))].sort((a, b) => a - b);
  return {
    shape,
    width: result.bounds.width,
    height: result.bounds.height,
    nodes: boxes.map((node) => ({ id: node.id, x: node.x, y: node.y, width: node.width, height: node.height, rank: levels.indexOf(along(node)) })),
    edges: result.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, points: edge.points.map((point) => ({ x: point.x, y: point.y })) })),
  };
}
