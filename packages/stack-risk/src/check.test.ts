import { SAMPLE_STACK, STACK_SCHEMA, stopSets, works, type Need, type Part, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkRisk, RISK_CODES, type RiskFault } from "./check.ts";
import { RISK_SCHEMA, type RiskLayer } from "./layer.ts";
import { SAMPLE_RISK, SAMPLE_TODAY } from "./sample.ts";

const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });
const risk = (fields: Partial<RiskLayer>): RiskLayer => ({ schema: RISK_SCHEMA, goals: [], ...fields });
const today = SAMPLE_TODAY;
const check = (layer: RiskLayer, of: Stack): RiskFault[] => checkRisk(layer, of, { today });
const codes = (faults: readonly RiskFault[]): string[] => faults.map((fault) => fault.code);

// The part `a` needs one of `b` and `c`, and the part `d`.
const small = stack({ id: "b", kind: "x" }, { id: "c", kind: "x" }, { id: "d", kind: "x" }, { id: "a", kind: "function", needs: [{ any: ["b", "c"] }, "d"] });

describe("checkRisk", () => {
  it("gives the two faults of the sample", () => {
    const faults = check(SAMPLE_RISK, SAMPLE_STACK);
    expect(codes(faults)).toEqual(["stop-set", "chance-low"]);
    expect(faults[0]).toEqual({
      level: "error",
      code: "stop-set",
      at: "alert",
      message: 'The failure of the set ["phone"] stops "alert". The goal of "alert" is to survive each set of 1 or fewer parts.',
      parts: ["phone"],
    });
    expect(faults[1]?.at).toBe("alert");
    expect(faults[1]?.message).toMatch(/^The chance that "alert" works is 0\.96\d+\. The goal is 0\.99\.$/);
  });

  it("passes for a layer with no record", () => {
    expect(check(risk({}), SAMPLE_STACK)).toEqual([]);
  });

  it("passes when each goal holds", () => {
    const layer = risk({ goals: [{ part: "a", survives: 0, chance: 0.8 }], chances: ["b", "c", "d"].map((part) => ({ part, works: 0.9 })) });
    expect(check(layer, small)).toEqual([]);
  });

  it("has a code for each fault", () => {
    expect(new Set(RISK_CODES).size).toBe(RISK_CODES.length);
    expect(RISK_CODES).toHaveLength(19);
  });

  describe("the limit of time", () => {
    const copies = (b: number, c: number): RiskLayer["chances"] => [
      { part: "b", works: 0.9, delay: [{ within: 5, chance: b }] },
      { part: "c", works: 0.9, wait: 30, delay: [{ within: 5, chance: c }] },
      { part: "d", works: 1 },
    ];

    it("examines the chance that the part ends in time", () => {
      const goal = { part: "a", survives: 0, chance: 0.95, within: 10 };
      const faults = check(risk({ goals: [goal], chances: copies(0.99, 0.99) }), small);
      expect(codes(faults)).toEqual(["chance-low"]);
      expect(faults[0]?.message).toMatch(/^The chance that "a" works and ends within 10 seconds is 0\.89[0-9]*\. The goal is 0\.95\.$/);
      expect(check(risk({ goals: [{ ...goal, within: 40 }], chances: copies(0.99, 0.99) }), small)).toEqual([]);
      expect(check(risk({ goals: [{ ...goal, chance: 0.85 }], chances: copies(0.99, 0.99) }), small)).toEqual([]);
    });

    it("refuses a limit that is not a time, and a limit with no chance", () => {
      for (const within of [-1, Number.NaN]) {
        expect(codes(check(risk({ goals: [{ part: "a", survives: 0, chance: 0.5, within }], chances: copies(1, 1) }), small))).toEqual(["goal-within"]);
      }
      expect(check(risk({ goals: [{ part: "a", survives: 0, within: 10 }] }), small)).toEqual([
        { level: "error", code: "goal-within", at: "a", message: `The goal of "a" has a limit of time and no chance.` },
      ]);
    });

    it("refuses a bad wait or bad delay points, and then gives no chance fault", () => {
      const bad = (fields: Partial<NonNullable<RiskLayer["chances"]>[number]>): RiskFault[] =>
        check(risk({ goals: [{ part: "a", survives: 0, chance: 0.99 }], chances: [{ part: "b", works: 0.5, ...fields }] }), small);
      expect(bad({ wait: -1 }).map((fault) => fault.message)).toEqual([`The wait -1 of "b" is not a time of 0 or more.`]);
      expect(bad({ wait: Number.POSITIVE_INFINITY }).map((fault) => fault.code)).toEqual(["chance-delay"]);
      expect(bad({ delay: [{ within: -1, chance: 0.5 }] }).map((fault) => fault.message)).toEqual([`The delay point 0 of "b" has the time -1, which is not a time of 0 or more.`]);
      expect(bad({ delay: [{ within: 1, chance: 0.5 }, { within: 1, chance: 0.6 }] }).map((fault) => fault.message)).toEqual([`The delay point 1 of "b" is not after the point before it.`]);
      expect(bad({ delay: [{ within: 1, chance: 1.5 }] }).map((fault) => fault.message)).toEqual([`The delay point 0 of "b" has the chance 1.5, which is not from 0 to 1.`]);
      expect(bad({ delay: [{ within: 1, chance: 0.6 }, { within: 2, chance: 0.5 }] }).map((fault) => fault.message)).toEqual([`The delay point 1 of "b" has a chance less than the chance of the point before it.`]);
    });
  });

  describe("the records", () => {
    it("refuses a goal of a part that is not in the stack, and a second goal of a part", () => {
      const faults = check(risk({ goals: [{ part: "not-a-part", survives: 0 }, { part: "b", survives: 0 }, { part: "b", survives: 1 }] }), small);
      expect(faults.map((fault) => [fault.code, fault.at])).toEqual([
        ["goal-part", "not-a-part"],
        ["goal-duplicate", "b"],
      ]);
    });

    it("refuses a count that is not a whole number from 0", () => {
      for (const survives of [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(codes(check(risk({ goals: [{ part: "b", survives }] }), small))).toEqual(["goal-survives"]);
      }
    });

    it("refuses a chance of a goal that is not from 0 to 1", () => {
      for (const chance of [1.5, -0.1, Number.NaN]) {
        expect(codes(check(risk({ goals: [{ part: "b", survives: 0, chance }] }), small))).toEqual(["goal-chance"]);
      }
    });

    it("refuses a chance record of a part that is not in the stack, a second record of a part, and a chance out of the range", () => {
      const layer = risk({
        chances: [
          { part: "not-a-part", works: 0.5 },
          { part: "b", works: 0.5 },
          { part: "b", works: 0.6 },
          { part: "c", works: 1.5 },
          { part: "d", works: Number.NaN },
        ],
      });
      expect(check(layer, small).map((fault) => [fault.code, fault.at])).toEqual([
        ["chance-part", "not-a-part"],
        ["chance-duplicate", "b"],
        ["chance-range", "c"],
        ["chance-range", "d"],
      ]);
    });

    it("does not calculate a chance when a chance record is out of the range", () => {
      const layer = risk({ goals: [{ part: "a", survives: 0, chance: 0.99 }], chances: [{ part: "b", works: 1.5 }] });
      expect(codes(check(layer, small))).toEqual(["chance-range"]);
    });

    it("refuses an accepted risk of a part with no goal", () => {
      const faults = check(risk({ accepted: [{ part: "a", stop: ["d"], reason: "An example" }] }), small);
      expect(faults.map((fault) => [fault.code, fault.at])).toEqual([["accept-part", "a"]]);
    });

    it("refuses an accepted risk with no part, or with a part that is not in the stack", () => {
      const layer = risk({
        goals: [{ part: "a", survives: 0 }],
        accepted: [
          { part: "a", stop: [], reason: "An example" },
          { part: "a", stop: ["d", "not-a-part"], reason: "An example" },
        ],
      });
      const faults = check(layer, small);
      expect(codes(faults)).toEqual(["accept-stop", "accept-stop"]);
      expect(faults[1]?.other).toBe("not-a-part");
    });

    it("refuses a last date of an accepted risk that is not a date", () => {
      const layer = risk({ goals: [{ part: "a", survives: 1 }], accepted: [{ part: "a", stop: ["d"], reason: "An example", until: "2027-02-30" }] });
      // The record has a fault, so it accepts nothing: the stop set is a fault too.
      expect(codes(check(layer, small))).toEqual(["accept-date", "stop-set"]);
    });
  });

  describe("the stop sets", () => {
    it("tells that the part of a goal does not work", () => {
      const broken = stack({ id: "a", kind: "function", needs: ["not-a-part"] });
      const faults = check(risk({ goals: [{ part: "a", survives: 1, chance: 0.5 }] }), broken);
      expect(faults.map((fault) => [fault.code, fault.at])).toEqual([["stopped", "a"]]);
    });

    it("gives no fault for the count 0 when the part works", () => {
      expect(check(risk({ goals: [{ part: "a", survives: 0 }] }), small)).toEqual([]);
    });

    it("gives one fault for each stop set of the size of the goal or less", () => {
      expect(check(risk({ goals: [{ part: "a", survives: 1 }] }), small).map((fault) => fault.parts)).toEqual([["d"]]);
      expect(check(risk({ goals: [{ part: "a", survives: 2 }] }), small).map((fault) => fault.parts)).toEqual([["d"], ["b", "c"]]);
    });

    it("gives no fault for a set that a record accepts, in any sequence of its parts", () => {
      const layer = risk({
        goals: [{ part: "a", survives: 2 }],
        accepted: [
          { part: "a", stop: ["c", "b"], reason: "An example" },
          { part: "a", stop: ["d"], reason: "An example", until: today },
        ],
      });
      expect(check(layer, small)).toEqual([]);
    });

    it("gives a fault for a set whose acceptance ended", () => {
      const layer = risk({ goals: [{ part: "a", survives: 1 }], accepted: [{ part: "a", stop: ["d"], reason: "An example", until: "2026-11-15" }] });
      const faults = check(layer, small);
      expect(faults).toEqual([
        {
          level: "error",
          code: "accept-old",
          at: "a",
          message: 'The acceptance of the stop set ["d"] of "a" ended on 2026-11-15. The failure of the set stops "a".',
          parts: ["d"],
        },
      ]);
    });

    it("gives no fault when one of two records of a set is in force", () => {
      const layer = risk({
        goals: [{ part: "a", survives: 1 }],
        accepted: [
          { part: "a", stop: ["d"], reason: "An example", until: "2026-01-01" },
          { part: "a", stop: ["d"], reason: "An example", until: "2027-01-01" },
        ],
      });
      expect(check(layer, small)).toEqual([]);
    });

    it("refuses an accepted risk that names no stop set of its goal", () => {
      const layer = risk({
        goals: [{ part: "a", survives: 1 }],
        accepted: [
          { part: "a", stop: ["d"], reason: "An example" },
          { part: "a", stop: ["b"], reason: "The part c does the work of b" },
          { part: "a", stop: ["b", "c"], reason: "The set is larger than the goal" },
          { part: "a", stop: ["d", "b"], reason: "The part d alone stops the part" },
        ],
      });
      const faults = check(layer, small);
      expect(codes(faults)).toEqual(["accept-unused", "accept-unused", "accept-unused"]);
      expect(faults.map((fault) => fault.parts)).toEqual([["b"], ["b", "c"], ["d", "b"]]);
      expect(faults[0]?.message).toBe('An accepted risk of "a" names the set ["b"]. It is no stop set of "a" of 1 or fewer parts.');
    });

    it("accepts the sets of one goal only", () => {
      const layer = risk({ goals: [{ part: "a", survives: 1 }, { part: "d", survives: 0 }], accepted: [{ part: "d", stop: ["d"], reason: "An example" }] });
      expect(check(layer, small).map((fault) => [fault.code, fault.at])).toEqual([
        ["stop-set", "a"],
        ["accept-unused", "d"],
      ]);
    });
  });

  describe("the chances", () => {
    it("names the parts of the paths with no chance record", () => {
      const faults = check(risk({ goals: [{ part: "a", survives: 0, chance: 0.5 }], chances: [{ part: "b", works: 0.9 }] }), small);
      expect(faults).toEqual([
        { level: "error", code: "chance-none", at: "a", message: 'The goal of "a" has a chance, and these parts of its paths have no chance record: ["c", "d"].', parts: ["c", "d"] },
      ]);
    });

    it("gives a fault for a chance that is less than the goal, and no fault for an equal chance", () => {
      const one = stack({ id: "a", kind: "x" });
      const chances = [{ part: "a", works: 0.9 }];
      expect(check(risk({ goals: [{ part: "a", survives: 0, chance: 0.9 }], chances }), one)).toEqual([]);
      expect(check(risk({ goals: [{ part: "a", survives: 0, chance: 0.95 }], chances }), one)).toEqual([
        { level: "error", code: "chance-low", at: "a", message: 'The chance that "a" works is 0.9. The goal is 0.95.' },
      ]);
    });
  });

  describe("the limits", () => {
    it("gives no read, and not a pass, when a search passes its limit", () => {
      const layer = risk({ goals: [{ part: "a", survives: 1, chance: 0.5 }], chances: ["b", "c", "d"].map((part) => ({ part, works: 0.9 })) });
      const faults = checkRisk(layer, small, { today, maxSets: 1 });
      expect(codes(faults)).toEqual(["no-read", "no-read"]);
      expect(faults.every((fault) => fault.level === "error")).toBe(true);
      expect(codes(checkRisk(SAMPLE_RISK, SAMPLE_STACK, { today, maxSteps: 1 }))).toEqual(["stop-set", "no-read"]);
    });

    it("gives no fault for an accepted risk of a goal with no read", () => {
      const layer = risk({ goals: [{ part: "a", survives: 1 }], accepted: [{ part: "a", stop: ["b"], reason: "An example" }] });
      expect(codes(checkRisk(layer, small, { today, maxSets: 1 }))).toEqual(["no-read"]);
    });

    it("throws for a date of the check that is not a date, and for a limit that is not valid", () => {
      expect(() => checkRisk(risk({}), small, { today: "16 November" })).toThrow(RangeError);
      expect(() => checkRisk(risk({ goals: [{ part: "a", survives: 1 }] }), small, { today, maxSets: 0 })).toThrow(RangeError);
    });
  });

  it("gives the faults in the sequence of the chance records, the accepted risks and the goals", () => {
    const layer = risk({
      goals: [{ part: "a", survives: 1 }],
      chances: [{ part: "not-a-part", works: 0.5 }],
      accepted: [
        { part: "b", stop: ["d"], reason: "An example" },
        { part: "a", stop: ["b"], reason: "An example" },
      ],
    });
    expect(codes(check(layer, small))).toEqual(["chance-part", "accept-part", "stop-set", "accept-unused"]);
  });
});

// Generated stacks: each need names a part of the stack, or a part that is not in it. The needs can go round.
const IDS = ["p0", "p1", "p2", "p3", "p4", "p5"];
const needArbitrary: fc.Arbitrary<Need> = fc.letrec<{ need: Need }>((tie) => ({
  need: fc.oneof(
    { maxDepth: 2 },
    fc.constantFrom(...IDS, "not-a-part"),
    fc.record({ all: fc.array(tie("need"), { maxLength: 3 }) }),
    fc.record({ any: fc.array(tie("need"), { maxLength: 3 }) }),
    fc.record({ any: fc.array(tie("need"), { maxLength: 3 }), count: fc.integer({ min: 0, max: 3 }) }),
  ),
})).need;
const stackArbitrary: fc.Arbitrary<Stack> = fc
  .tuple(fc.integer({ min: 1, max: IDS.length }), fc.array(fc.array(needArbitrary, { maxLength: 2 }), { minLength: IDS.length, maxLength: IDS.length }))
  .map(([count, needs]) => stack(...IDS.slice(0, count).map((id, index) => ({ id, kind: "x", needs: needs[index] ?? [] }))));
const caseArbitrary = fc.tuple(stackArbitrary, fc.integer({ min: 0, max: 3 }));

/** This function gives each subset of a list. */
const subsets = (list: readonly string[]): string[][] => list.reduce<string[][]>((sets, item) => [...sets, ...sets.map((set) => [...set, item])], [[]]);
const key = (set: readonly string[]): string => [...set].sort().join(" ");

describe("the gate of generated stacks", () => {
  it("has one stop-set fault for each smallest set of parts whose failure stops the part, and no other", () => {
    fc.assert(
      fc.property(caseArbitrary, ([generated, survives]) => {
        for (const part of generated.parts) {
          const root = part.id;
          const others = generated.parts.map((other) => other.id).filter((id) => id !== root);
          const faults = check(risk({ goals: [{ part: root, survives }] }), generated);
          if (!works(generated, root)) {
            expect(codes(faults)).toEqual(["stopped"]);
            continue;
          }
          // The sets by examination of each set of parts: a set stops the part, and no smaller set in it does.
          const stops = subsets(others).filter((off) => !works(generated, root, off));
          const smallest = stops.filter((off) => off.length <= survives && !stops.some((other) => other.length < off.length && other.every((id) => off.includes(id))));
          expect(faults.every((fault) => fault.code === "stop-set")).toBe(true);
          expect(faults.map((fault) => key(fault.parts ?? [])).sort()).toEqual(smallest.map(key).sort());
          // An accepted record for each set makes the gate pass.
          const accepted = faults.map((fault) => ({ part: root, stop: [...(fault.parts ?? [])].reverse(), reason: "An example" }));
          expect(check(risk({ goals: [{ part: root, survives }], accepted }), generated)).toEqual([]);
        }
      }),
      { seed: 20261116, numRuns: 300 },
    );
  });

  it("agrees with the stop sets of the core for the sample", () => {
    const stops = stopSets(SAMPLE_STACK, "alert", { size: 2 });
    if (stops.kind !== "exact") throw new Error("The sample gave no result.");
    const faults = check(risk({ goals: [{ part: "alert", survives: 2 }] }), SAMPLE_STACK);
    expect(faults.map((fault) => fault.parts)).toEqual(stops.sets);
  });
});
