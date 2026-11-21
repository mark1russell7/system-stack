import { describe, expect, it } from "vitest";
import { cleanDown, demoState, downFromHash, graphView, hashOf, labelOf, listText, scenarioOf, SCENARIOS, STACK, toggle, type DemoState, type PartMark } from "./demo.ts";

function marks(state: DemoState): Record<string, PartMark> {
  return Object.fromEntries(state.parts.map((part) => [part.id, part.mark]));
}

describe("the state of the demo", () => {
  it("with nothing down, the alert works, and the phone and the reader are single points", () => {
    const state = demoState([]);
    expect(state.goal).toMatchObject({ read: true, works: true, margin: 0 });
    expect(state.goal.read && [...state.goal.points].sort()).toEqual(["phone", "reader"]);
    expect(marks(state)).toMatchObject({ phone: "point", reader: "point", "home-power": "works", alert: "works" });
    expect(state.chance).toBeCloseTo(0.9649835920528091, 12);
    expect(state.goalChance).toBe(0.99);
    expect(state.total).toEqual({ bounded: 10, open: ["cloud-account"] });
  });

  it("with the power of the home cut, the home parts stop, and the stop of the calls does not hold", () => {
    const state = demoState(["home-power"]);
    expect(marks(state)).toMatchObject({ "home-power": "down", "home-network": "stopped", "home-host": "stopped", "program-home": "stopped", alert: "works" });
    // The copy in the cloud is the only program now: each part of its path alone stops the alert.
    expect(marks(state)).toMatchObject({ "program-cloud": "point", "cloud-host": "point", "cloud-account": "point", card: "point" });
    const calls = state.services.find((service) => service.part === "call-account");
    expect(calls?.hardLimit).toBeUndefined();
    expect(calls?.monthMax).toBeUndefined();
    expect(calls?.stops).toEqual([{ part: "program-home", amount: 10, works: false }]);
    expect(state.total).toEqual({ bounded: 0, open: ["cloud-account", "call-account"] });
    expect(state.chance).toBeLessThan(demoState([]).chance ?? 0);
  });

  it("with the phone lost, the alert does not work, and its chance is 0", () => {
    const state = demoState(["phone"]);
    expect(state.goal).toMatchObject({ read: true, works: false, margin: 0 });
    expect(marks(state)).toMatchObject({ phone: "down", alert: "stopped" });
    expect(state.chance).toBe(0);
  });

  it("with nothing down, the stop of the calls holds", () => {
    const calls = demoState([]).services.find((service) => service.part === "call-account");
    expect(calls).toMatchObject({ hardLimit: 10, monthMax: 10, stops: [{ part: "program-home", amount: 10, works: true }] });
  });

  it("gives each part of the stack one time, in the sequence of the stack", () => {
    expect(demoState([]).parts.map((part) => part.id)).toEqual(STACK.parts.map((part) => part.id));
  });

  it("gives the needs of the alert as a text", () => {
    const alert = demoState([]).parts.find((part) => part.id === "alert");
    expect(alert?.needs).toBe("one of Program at home or Program in cloud; one of Push service or Call service; Phone; Reader");
    expect(demoState([]).parts.find((part) => part.id === "reader")?.needs).toBe("nothing");
  });
});

describe("the list of parts down", () => {
  it("keeps the known parts one time, in the sequence of the stack", () => {
    expect(cleanDown(["push", "x", "home-power", "push"])).toEqual(["home-power", "push"]);
  });

  it("stops a part, and starts it again", () => {
    expect(toggle([], "push")).toEqual(["push"]);
    expect(toggle(["push"], "home-power")).toEqual(["home-power", "push"]);
    expect(toggle(["home-power", "push"], "push")).toEqual(["home-power"]);
  });

  it("finds the scenario of a list", () => {
    expect(scenarioOf(["push", "home-power"])?.id).toBe("power-push");
    expect(scenarioOf([])?.id).toBe("none");
    expect(scenarioOf(["call"])).toBeUndefined();
  });

  it("reads and writes the hash of the address", () => {
    expect(downFromHash("#down=push,home-power,x")).toEqual(["home-power", "push"]);
    expect(downFromHash("#other")).toEqual([]);
    expect(hashOf(["push", "home-power"])).toBe("#down=home-power,push");
    expect(hashOf([])).toBe("");
  });

  it("has scenarios with known parts and different lists", () => {
    const ids = new Set(STACK.parts.map((part) => part.id));
    for (const scenario of SCENARIOS) for (const part of scenario.down) expect(ids.has(part)).toBe(true);
    expect(new Set(SCENARIOS.map((scenario) => cleanDown(scenario.down).join(","))).size).toBe(SCENARIOS.length);
  });
});

describe("the texts", () => {
  it("joins a list", () => {
    expect(listText([])).toBe("");
    expect(listText(["a"])).toBe("a");
    expect(listText(["a", "b"], "or")).toBe("a or b");
    expect(listText(["a", "b", "c"])).toBe("a, b and c");
  });

  it("gives a label of at most two lines to each part", () => {
    for (const part of STACK.parts) expect(labelOf(part.id).length).toBeLessThanOrEqual(2);
  });
});

describe("the graph", () => {
  for (const shape of ["wide", "narrow"] as const) {
    it(`places each part in the ${shape} graph, with no overlap and inside the bounds`, () => {
      const graph = graphView(shape);
      expect(graph.nodes.map((node) => node.id).sort()).toEqual(STACK.parts.map((part) => part.id).sort());
      for (const node of graph.nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0);
        expect(node.y).toBeGreaterThanOrEqual(0);
        expect(node.x + node.width).toBeLessThanOrEqual(graph.width);
        expect(node.y + node.height).toBeLessThanOrEqual(graph.height);
      }
      for (const a of graph.nodes) {
        for (const b of graph.nodes) {
          if (a.id >= b.id) continue;
          const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
          expect(apart, `${a.id} and ${b.id}`).toBe(true);
        }
      }
      for (const edge of graph.edges) expect(edge.points.length).toBeGreaterThanOrEqual(2);
    });
  }

  it("draws one line for each need", () => {
    expect(graphView("wide").edges.map((edge) => edge.id)).toContain("home-power>home-network");
    expect(graphView("wide").edges).toHaveLength(16);
  });

  it("puts the needs before the parts that need them", () => {
    for (const shape of ["wide", "narrow"] as const) {
      const graph = graphView(shape);
      const rank = new Map(graph.nodes.map((node) => [node.id, node.rank]));
      for (const edge of graph.edges) expect(rank.get(edge.source) ?? 0).toBeLessThan(rank.get(edge.target) ?? 0);
    }
  });

  it("fits the narrow graph in a phone of 360 pixels", () => {
    expect(graphView("narrow").width).toBeLessThanOrEqual(336);
  });
});
