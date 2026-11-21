import { byId, copyText, h, setupTheme, svg } from "@mark1russell7/site-pages/chrome";
import { demoState, downFromHash, graphView, hashOf, labelOf, listText, SCENARIOS, scenarioOf, shortName, toggle, type DemoState, type PartMark, type PartView, type Shape } from "./demo.ts";

setupTheme(byId<HTMLButtonElement>("theme"), "theme");

const copy = byId<HTMLButtonElement>("copy");
copy.addEventListener("click", () => {
  void copyText(copy, byId("install").textContent ?? "");
});

// The demo. The model of `demo.ts` gives each answer, and this code draws it.

const BILLING_TEXT: Readonly<Record<string, string>> = { free: "Free", fixed: "Fixed price", metered: "Price for the use" };

const MARK_TEXT: Readonly<Record<PartMark, string>> = {
  works: "It works",
  point: "It works. Its failure alone stops the alert",
  down: "You stopped it",
  stopped: "It does not work: a need does not hold",
};

const STATE_TEXT: Readonly<Record<PartMark, string>> = {
  works: "Works",
  point: "Works. Alone stops the alert",
  down: "Stopped by you",
  stopped: "Does not work",
};

let down = downFromHash(location.hash);
let state: DemoState = demoState(down);

const graph = document.getElementById("graph") as unknown as SVGSVGElement;
const detail = byId("detail");
const nodes = new Map<string, SVGGElement>();
let edges: { readonly line: SVGPathElement; readonly source: string }[] = [];
const narrow = matchMedia("(max-width: 46rem)");

/** This function gives the path of a line through its points. */
function pathOf(points: readonly { readonly x: number; readonly y: number }[]): string {
  return points.map((point, at) => `${at === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
}

/** This function gives the part of the state with the `id`. */
function partOf(id: string): PartView | undefined {
  return state.parts.find((part) => part.id === id);
}

/** This function shows the name, the state and the needs of a part under the graph. */
function showDetail(id: string): void {
  const part = partOf(id);
  if (part === undefined) return;
  const action = part.mark === "down" ? "Select it again to start it." : "Select it to stop it.";
  detail.textContent = `${part.name}. ${MARK_TEXT[part.mark]}. It needs ${part.needs}. ${action}`;
}

/** This function gives a state as a flag: an icon and a text. A no-break space keeps the icon with its text. */
function flag(kind: "good" | "warning" | "critical", icon: string, text: string): HTMLSpanElement {
  return h("span", { class: `flag ${kind}` }, h("span", { "aria-hidden": "true" }, icon), `\u00a0${text}`);
}

function select(id: string): void {
  down = toggle(down, id);
  update();
  showDetail(id);
}

/** This function draws the boxes and the lines of the graph for a shape. The state of each box comes later, in `update`. */
function draw(shape: Shape): void {
  const view = graphView(shape);
  graph.replaceChildren();
  nodes.clear();
  graph.setAttribute("viewBox", `0 0 ${String(view.width)} ${String(view.height)}`);
  graph.setAttribute("class", `graph ${shape}`);
  // A wide graph is never larger than its size. A narrow graph can grow a little on a large phone.
  graph.style.maxWidth = `${String(Math.round(shape === "wide" ? view.width : view.width * 1.4))}px`;
  graph.append(
    svg(
      "defs",
      {},
      svg("pattern", { id: "hatch", width: 6, height: 6, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" }, svg("line", { class: "hatch-line", x1: 0, y1: 0, x2: 0, y2: 6 })),
      svg("marker", { id: "arrow", viewBox: "0 0 8 8", refX: 7, refY: 4, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" }, svg("path", { class: "arrow", d: "M0 0 L8 4 L0 8 z" })),
    ),
  );
  const lines = svg("g", { class: "edges" });
  edges = view.edges.map((edge) => {
    const line = svg("path", { class: "edge", d: pathOf(edge.points), "marker-end": "url(#arrow)" });
    lines.append(line);
    return { line, source: edge.source };
  });
  const boxes = svg("g", { class: "nodes" });
  const lineHeight = shape === "wide" ? 15 : 12;
  for (const node of view.nodes) {
    const label = shape === "wide" ? [labelOf(node.id).join(" ")] : labelOf(node.id);
    const middle = node.y + node.height / 2;
    const text = svg(
      "text",
      { x: node.x + node.width / 2, y: middle, "text-anchor": "middle" },
      ...label.map((line, at) => svg("tspan", { x: node.x + node.width / 2, y: middle + (at - (label.length - 1) / 2) * lineHeight, "dominant-baseline": "central" }, line)),
    );
    const box = { x: node.x, y: node.y, width: node.width, height: node.height, rx: 6 };
    const group = svg(
      "g",
      { class: "node", "data-id": node.id, role: "button", tabindex: 0, style: `--rank: ${String(node.rank)}` },
      svg("rect", { class: "ring", x: node.x - 3, y: node.y - 3, width: node.width + 6, height: node.height + 6, rx: 9 }),
      svg("rect", { class: "box", ...box }),
      svg("rect", { class: "hatch", ...box }),
      text,
    );
    group.addEventListener("click", () => {
      select(node.id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      select(node.id);
    });
    group.addEventListener("pointerenter", () => {
      showDetail(node.id);
    });
    group.addEventListener("focus", () => {
      showDetail(node.id);
    });
    nodes.set(node.id, group);
    boxes.append(group);
  }
  graph.append(lines, boxes);
}

/** This function gives an amount of money as a text. */
function money(amount: number): string {
  return `${String(amount)} ${state.currency}`;
}

/** This function gives a chance as a percent, with two digits after the point when the chance is not a whole percent. */
function percent(chance: number): string {
  const value = chance * 100;
  return `${Number.isInteger(value) ? String(value) : value.toFixed(2)} %`;
}

function chips(ids: readonly string[], mark: PartMark): HTMLUListElement {
  return h("ul", { class: "chips" }, ...ids.map((id) => h("li", { class: `chip ${mark}` }, shortName(id))));
}

function drawGoal(): void {
  const goal = state.goal;
  const status = byId("goal-status");
  const margin = byId("goal-margin");
  const points = byId("goal-points");
  if (!goal.read) {
    status.replaceChildren(h("span", { class: "flag warning" }, "No result"));
    margin.textContent = "The search passed its limit, so this state has no result.";
    points.replaceChildren();
  } else if (!goal.works) {
    status.replaceChildren(flag("critical", "×", "Stopped"));
    margin.textContent = "The alert does not get to its reader. Start a part again, or select the scenario with nothing down.";
    points.replaceChildren(h("p", { class: "small" }, "You stopped:"), chips(state.down, "down"));
  } else {
    status.replaceChildren(flag("good", "✓", "Works"));
    margin.textContent =
      goal.margin === Number.POSITIVE_INFINITY ? "No failure of other parts stops it." : goal.margin === 0 ? "One more failure can stop it." : `It survives any ${String(goal.margin)} more failure${goal.margin === 1 ? "" : "s"}.`;
    if (goal.points.length > 0) points.replaceChildren(h("p", { class: "small" }, "Each of these parts alone stops it:"), chips(goal.points, "point"));
    else if (goal.stop.length > 0) points.replaceChildren(h("p", { class: "small" }, "The smallest set of failures that stops it:"), chips(goal.stop, "point"));
    else points.replaceChildren();
  }
  const chance = byId("chance");
  const note = byId("chance-note");
  if (state.chance === undefined) {
    chance.textContent = "No result";
    note.textContent = "The calculation of the chance passed its limit.";
    return;
  }
  chance.textContent = percent(state.chance);
  const target = state.goalChance;
  const meets = target === undefined || state.chance >= target;
  note.replaceChildren(
    "The chance that it works, with the parts down. ",
    target === undefined ? "" : meets ? flag("good", "✓", `Meets the goal of ${percent(target)}`) : flag("warning", "!", `Under the goal of ${percent(target)}`),
  );
}

function drawSpend(): void {
  const { total } = state;
  byId("total").textContent = total.open.length === 0 ? money(total.bounded) : "No bound";
  byId("total-note").textContent =
    total.open.length === 0
      ? "The most that all accounts can cost in a month."
      : `The cost of ${listText(total.open.map(shortName))} has no bound in a month. The other accounts cost at most ${money(total.bounded)}.`;
  byId("spend-rows").replaceChildren(
    ...state.services.map((service) =>
      h(
        "tr",
        {},
        h("th", { scope: "row" }, shortName(service.part)),
        h("td", {}, BILLING_TEXT[service.billing] ?? service.billing),
        h("td", {}, service.hardLimit === undefined ? "None" : money(service.hardLimit)),
        h("td", {}, service.monthMax === undefined ? flag("warning", "!", "No bound") : money(service.monthMax)),
      ),
    ),
  );
  byId("stops").replaceChildren(
    ...state.services.flatMap((service) =>
      service.stops.map((stop) =>
        h(
          "li",
          { class: stop.works ? "holds" : "lost" },
          stop.works ? flag("good", "✓", "Holds") : flag("critical", "×", "Does not hold"),
          ` ${shortName(stop.part)} stops the use of ${shortName(service.part)} at ${money(stop.amount)}.`,
          stop.works ? "" : ` ${shortName(stop.part)} does not work now.`,
        ),
      ),
    ),
  );
}

function drawParts(): void {
  byId("part-rows").replaceChildren(
    ...state.parts.map((part) =>
      h("tr", { "data-mark": part.mark }, h("th", { scope: "row" }, shortName(part.id), h("span", { class: "kind" }, part.kind)), h("td", {}, part.needs), h("td", {}, STATE_TEXT[part.mark])),
    ),
  );
}

function drawScenarios(): void {
  const current = scenarioOf(down)?.id;
  for (const button of byId("scenarios").querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-pressed", String(button.dataset["id"] === current));
}

/** This function asks the model for the state of the parts down, and shows it. */
function update(): void {
  state = demoState(down);
  for (const part of state.parts) {
    const group = nodes.get(part.id);
    if (group === undefined) continue;
    group.dataset["mark"] = part.mark;
    group.classList.toggle("goal-node", part.id === "alert");
    group.setAttribute("aria-pressed", String(part.mark === "down"));
    group.setAttribute("aria-label", `${shortName(part.id)}: ${STATE_TEXT[part.mark]}`);
  }
  const off = new Set(state.parts.filter((part) => part.mark === "down" || part.mark === "stopped").map((part) => part.id));
  for (const edge of edges) edge.line.classList.toggle("off", off.has(edge.source));
  drawGoal();
  drawSpend();
  drawParts();
  drawScenarios();
  const hash = hashOf(down);
  history.replaceState(null, "", hash === "" ? location.pathname + location.search : hash);
}

byId("scenarios").append(
  ...SCENARIOS.map((scenario) => {
    const button = h("button", { type: "button", class: "scenario", "data-id": scenario.id, "aria-pressed": "false" }, scenario.name);
    button.addEventListener("click", () => {
      down = [...scenario.down];
      update();
      detail.textContent = scenario.down.length === 0 ? "Each part works." : `Down: ${listText(scenario.down.map(shortName))}.`;
    });
    return button;
  }),
);

draw(narrow.matches ? "narrow" : "wide");
update();
narrow.addEventListener("change", () => {
  draw(narrow.matches ? "narrow" : "wide");
  update();
});
