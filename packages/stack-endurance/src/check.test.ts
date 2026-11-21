import { describe, expect, it } from "vitest";
import { checkEndurance, curveFault, ENDURANCE_CODES, hasEnduranceError } from "./check.ts";
import type { EnduranceLayer } from "./layer.ts";
import { SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK } from "./sample.ts";

const codes = (layer: EnduranceLayer): string[] => checkEndurance(layer, SAMPLE_ENDURANCE_STACK).map((fault) => fault.code);

describe("checkEndurance", () => {
  it("passes the sample", () => {
    expect(checkEndurance(SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK)).toEqual([]);
    expect(checkEndurance(SAMPLE_ENDURANCE)).toEqual([]);
  });

  it("finds two records with one key", () => {
    const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, levels: ["life", "life"], stores: [...SAMPLE_ENDURANCE.stores, { id: "jugs", resource: "water.stored", amount: 1 }] };
    expect(checkEndurance(layer, SAMPLE_ENDURANCE_STACK).filter((fault) => fault.code === "endurance-twice").map((fault) => fault.at)).toEqual(["life", "jugs"]);
  });

  it("finds an unknown level, resource and part", () => {
    const layer: EnduranceLayer = {
      ...SAMPLE_ENDURANCE,
      stores: [{ id: "s", resource: "nothing", amount: 1, part: "shed" }],
      draws: [{ need: "hydration.drink", level: "luxury", perDay: 1, supply: "well" }],
    };
    expect(codes(layer)).toEqual(expect.arrayContaining(["endurance-resource-unknown", "endurance-part-unknown", "endurance-level-unknown"]));
    expect(checkEndurance(layer).map((fault) => fault.code)).not.toContain("endurance-part-unknown");
  });

  it("finds a negative amount, a bad date, a bad reach and a prior of no case", () => {
    const layer: EnduranceLayer = {
      ...SAMPLE_ENDURANCE,
      stores: [{ id: "s", resource: "water.stored", amount: -1, due: "2026-13-01" }],
      priors: [{ case: "flood", place: "home", perYear: 1, reach: 2, source: "s", asOf: AT }],
    };
    expect(codes(layer)).toEqual(expect.arrayContaining(["endurance-range", "endurance-date", "endurance-prior-case"]));
  });

  it("finds an empty converter and a draw with no way", () => {
    const layer: EnduranceLayer = {
      ...SAMPLE_ENDURANCE,
      converters: [{ id: "free", takes: [], gives: { need: "food.energy", amount: 1 } }],
      draws: [...SAMPLE_ENDURANCE.draws, { need: "heat", level: "comfort", perDay: 1, supply: "grid" }],
    };
    const faults = checkEndurance(layer, SAMPLE_ENDURANCE_STACK);
    expect(faults.find((fault) => fault.code === "endurance-converter-empty")?.level).toBe("error");
    expect(faults.find((fault) => fault.code === "endurance-no-way")).toMatchObject({ level: "warning", at: "heat" });
    expect(hasEnduranceError(faults)).toBe(true);
    expect(hasEnduranceError(faults.filter((fault) => fault.level === "warning"))).toBe(false);
  });

  it("finds a bad curve", () => {
    const storm = SAMPLE_ENDURANCE.cases?.[0];
    if (storm === undefined) throw new Error("no case");
    const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, cases: [{ ...storm, cuts: [{ ...(storm.cuts[0] as (typeof storm.cuts)[number]), duration: [[0, 1], [1, 0.5]] }] }] };
    expect(codes(layer)).toContain("endurance-curve");
  });

  it("has a code for each fault", () => {
    expect(ENDURANCE_CODES).toHaveLength(10);
  });
});

const AT = "2026-12-01";

describe("curveFault", () => {
  it("gives the first fault of a curve", () => {
    expect(curveFault([[0, 1], [1, 0]])).toBeUndefined();
    expect(curveFault([])).toBe("The curve does not start at [0, 1].");
    expect(curveFault([[0, 0.9], [1, 0]])).toBe("The curve does not start at [0, 1].");
    expect(curveFault([[0, 1], [0, 0]])).toMatch(/days of the point 1/);
    expect(curveFault([[0, 1], [1, 0.5], [2, 0.6], [3, 0]])).toMatch(/chance of the point 2/);
    expect(curveFault([[0, 1], [1, 0.5]])).toBe("The curve does not end at a chance of 0.");
  });
});
