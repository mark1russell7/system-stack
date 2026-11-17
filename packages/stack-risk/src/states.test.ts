import { SAMPLE_STACK, STACK_SCHEMA, type Part, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { RISK_SCHEMA, type Goal, type RiskLayer } from "./layer.ts";
import { SAMPLE_RISK } from "./sample.ts";
import { goalStates } from "./states.ts";

const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });
const goals = (...list: Goal[]): RiskLayer => ({ schema: RISK_SCHEMA, goals: list });
const pair = stack({ id: "b", kind: "x" }, { id: "c", kind: "x" }, { id: "a", kind: "function", needs: [{ any: ["b", "c"] }] });

describe("goalStates", () => {
  it("gives the single points of failure of the sample alert", () => {
    expect(goalStates(SAMPLE_RISK, SAMPLE_STACK)).toEqual([{ part: "alert", read: true, works: true, margin: 0, stop: ["reader"], points: ["reader", "phone"] }]);
  });

  it("gives more single points of failure when one of two paths is down", () => {
    const [state] = goalStates(SAMPLE_RISK, SAMPLE_STACK, { down: ["program-cloud"] });
    expect(state).toEqual({ part: "alert", read: true, works: true, margin: 0, stop: ["reader"], points: ["reader", "phone", "home-power", "home-network", "home-host", "program-home"] });
  });

  it("gives the margin 1 for a part that survives each failure of one part", () => {
    expect(goalStates(goals({ part: "a", survives: 1 }), pair)).toEqual([{ part: "a", read: true, works: true, margin: 1, stop: ["b", "c"], points: [] }]);
  });

  it("gives the margin 0 when a failure used the margin", () => {
    expect(goalStates(goals({ part: "a", survives: 1 }), pair, { down: ["b"] })).toEqual([{ part: "a", read: true, works: true, margin: 0, stop: ["c"], points: ["c"] }]);
  });

  it("gives the margin 0 and empty lists for a part that does not work", () => {
    const stopped = { part: "a", read: true, works: false, margin: 0, stop: [], points: [] };
    expect(goalStates(goals({ part: "a", survives: 1 }), pair, { down: ["b", "c"] })).toEqual([stopped]);
    expect(goalStates(goals({ part: "a", survives: 1 }), pair, { down: ["a"] })).toEqual([stopped]);
    expect(goalStates(goals({ part: "not-a-part", survives: 0 }), pair)).toEqual([{ ...stopped, part: "not-a-part" }]);
  });

  it("gives an infinite margin for a part that no failure of other parts stops", () => {
    expect(goalStates(goals({ part: "b", survives: 0 }), pair)).toEqual([{ part: "b", read: true, works: true, margin: Number.POSITIVE_INFINITY, stop: [], points: [] }]);
  });

  it("gives one state for each part, in the sequence of the goals", () => {
    const states = goalStates(goals({ part: "b", survives: 0 }, { part: "a", survives: 1 }, { part: "b", survives: 3 }), pair);
    expect(states.map((state) => state.part)).toEqual(["b", "a"]);
  });

  it("reads a sequence of parts that gives its items one time", () => {
    function* down(): Generator<string> {
      yield "b";
    }
    expect(goalStates(goals({ part: "a", survives: 1 }, { part: "c", survives: 0 }), pair, { down: down() })).toEqual([
      { part: "a", read: true, works: true, margin: 0, stop: ["c"], points: ["c"] },
      { part: "c", read: true, works: true, margin: Number.POSITIVE_INFINITY, stop: [], points: [] },
    ]);
  });

  it("gives no read when the search passes its limit", () => {
    expect(goalStates(goals({ part: "a", survives: 1 }, { part: "b", survives: 0 }), pair, { maxSets: 1 })).toEqual([
      { part: "a", read: false },
      { part: "b", read: true, works: true, margin: Number.POSITIVE_INFINITY, stop: [], points: [] },
    ]);
  });

  it("throws for a limit that is not valid", () => {
    expect(() => goalStates(goals({ part: "a", survives: 1 }), pair, { maxSets: 0 })).toThrow(RangeError);
  });
});
