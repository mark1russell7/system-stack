import { curveFault as coreCurveFault } from "@mark1russell7/system-stack";
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

  it("finds a resource twice in the takes of a converter, and a part twice in the cuts of a case", () => {
    const converter = SAMPLE_ENDURANCE.converters?.[0];
    const storm = SAMPLE_ENDURANCE.cases?.[0];
    if (converter === undefined || storm === undefined) throw new Error("The sample has no converter or no case.");
    const layer: EnduranceLayer = {
      ...SAMPLE_ENDURANCE,
      converters: [{ ...converter, takes: [...converter.takes, { resource: "water.stored", amount: 1 }] }],
      cases: [{ ...storm, cuts: [...storm.cuts, { ...storm.cuts[0], part: "grid", title: "Again", duration: [[0, 1], [1, 0]], source: "s" }] }, ...(SAMPLE_ENDURANCE.cases?.slice(1) ?? [])],
    };
    expect(codes(layer).filter((code) => code === "endurance-twice")).toHaveLength(2);
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

  it("refuses a cut with a bound that is not a value of CUT_BOUNDS, and passes each value", () => {
    const storm = SAMPLE_ENDURANCE.cases?.[0];
    if (storm === undefined) throw new Error("no case");
    const withBound = (bound: unknown): EnduranceLayer => ({ ...SAMPLE_ENDURANCE, cases: [{ ...storm, cuts: [{ ...(storm.cuts[0] as (typeof storm.cuts)[number]), bound: bound as "law" }, ...storm.cuts.slice(1)] }] });
    const faults = checkEndurance(withBound("exact"), SAMPLE_ENDURANCE_STACK);
    expect(faults.find((fault) => fault.code === "endurance-bound")).toMatchObject({ level: "error", at: `storm/${storm.cuts[0]?.part ?? ""}` });
    for (const bound of ["law", "upper", "lower", "none"]) expect(codes(withBound(bound))).not.toContain("endurance-bound");
  });

  it("warns about a cut with no curve, and does not refuse it", () => {
    const storm = SAMPLE_ENDURANCE.cases?.[0];
    if (storm === undefined) throw new Error("no case");
    const { duration: _, ...bare } = storm.cuts[0] as (typeof storm.cuts)[number];
    const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, cases: [{ ...storm, cuts: [bare, ...storm.cuts.slice(1)] }, ...(SAMPLE_ENDURANCE.cases ?? []).slice(1)] };
    const faults = checkEndurance(layer, SAMPLE_ENDURANCE_STACK);
    expect(faults.find((fault) => fault.code === "endurance-cut-no-curve")).toMatchObject({ level: "warning", at: `storm/${bare.part}` });
    expect(faults.some((fault) => fault.code === "endurance-curve")).toBe(false);
    expect(hasEnduranceError(faults)).toBe(false);
  });

  it("refuses a limit for each day that is not 0 or more, and a count of devices that is not a whole number of 1 or more", () => {
    const converter = SAMPLE_ENDURANCE.converters?.[0];
    if (converter === undefined) throw new Error("The sample has no converter.");
    for (const bad of [{ perDay: -1 }, { perDay: Number.NaN }, { perDay: Infinity }, { devices: 0 }, { devices: 1.5 }, { devices: -2 }]) {
      const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, converters: [{ ...converter, ...bad }] };
      expect(codes(layer)).toEqual(["endurance-range"]);
    }
    const good: EnduranceLayer = { ...SAMPLE_ENDURANCE, converters: [{ ...converter, perDay: 0, devices: 3 }] };
    expect(codes(good)).toEqual([]);
  });

  it("refuses two counts of devices for one device", () => {
    const converter = SAMPLE_ENDURANCE.converters?.[0];
    if (converter === undefined) throw new Error("The sample has no converter.");
    const device = converter.device ?? "stove";
    const pair = (devices: number | undefined): EnduranceLayer => ({
      ...SAMPLE_ENDURANCE,
      converters: [{ ...converter, device, perDay: 4, devices: 2 }, { ...converter, id: `${converter.id}-2`, device, perDay: 6, devices }],
    });
    expect(checkEndurance(pair(1)).map((fault) => [fault.code, fault.at])).toEqual([["endurance-devices", `${converter.id}-2`]]);
    expect(checkEndurance(pair(undefined)).map((fault) => fault.code)).toEqual(["endurance-devices"]);
    expect(checkEndurance(pair(2))).toEqual([]);
  });

  it("warns on a device with a limited converter and a converter with no limit", () => {
    const converter = SAMPLE_ENDURANCE.converters?.[0];
    if (converter === undefined) throw new Error("The sample has no converter.");
    const device = converter.device ?? "stove";
    const mix = (second: number | undefined, third: number | undefined): EnduranceLayer => ({
      ...SAMPLE_ENDURANCE,
      converters: [
        { ...converter, device, perDay: 4 },
        { ...converter, id: `${converter.id}-2`, device, perDay: second },
        { ...converter, id: `${converter.id}-3`, device, perDay: third },
      ],
    });
    const faults = checkEndurance(mix(undefined, undefined));
    expect(faults.map((fault) => [fault.level, fault.code, fault.at])).toEqual([["warning", "endurance-device-mix", `${converter.id}-2`]]);
    expect(faults[0]?.message).toContain(`"${converter.id}-2" uses no device-days`);
    expect(checkEndurance(mix(6, undefined)).map((fault) => fault.at)).toEqual([`${converter.id}-3`]);
    expect(checkEndurance(mix(6, 2))).toEqual([]);
    // A converter with no device has a limit of its own, so it makes no mix.
    const alone: EnduranceLayer = { ...SAMPLE_ENDURANCE, converters: [{ ...converter, device, perDay: 4 }, { ...converter, id: `${converter.id}-2`, device: undefined }] };
    expect(codes(alone)).toEqual([]);
  });

  it("has a code for each fault", () => {
    expect(ENDURANCE_CODES).toHaveLength(15);
  });
});

const AT = "2026-12-01";

describe("curveFault", () => {
  it("refuses a cycle of converters and a gift of an unknown resource", () => {
    const layer: EnduranceLayer = {
      ...SAMPLE_ENDURANCE,
      resources: [...SAMPLE_ENDURANCE.resources, { code: "a", unit: "u" }, { code: "b", unit: "u" }],
      converters: [
        ...(SAMPLE_ENDURANCE.converters ?? []),
        { id: "a-from-b", takes: [{ resource: "b", amount: 1 }], gives: { resource: "a", amount: 1 } },
        { id: "b-from-a", takes: [{ resource: "a", amount: 1 }], gives: { resource: "b", amount: 1 } },
        { id: "again", takes: [{ resource: "fuel.propane", amount: 1 }, { resource: "energy.battery", amount: 1 }], gives: { resource: "energy.battery", amount: 2 } },
        { id: "unknown", takes: [{ resource: "a", amount: 1 }], gives: { resource: "nothing", amount: 1 } },
      ],
    };
    const faults = checkEndurance(layer);
    expect(faults.filter((fault) => fault.code === "endurance-cycle").map((fault) => fault.at)).toEqual(expect.arrayContaining(["energy.battery"]));
    expect(faults.filter((fault) => fault.code === "endurance-cycle")).toHaveLength(2);
    expect(faults.some((fault) => fault.code === "endurance-resource-unknown" && fault.at === "unknown")).toBe(true);
    expect(checkEndurance(SAMPLE_ENDURANCE).filter((fault) => fault.code === "endurance-cycle")).toEqual([]);
  });

  it("gives the curve check of the core", () => {
    expect(curveFault).toBe(coreCurveFault);
    expect(curveFault([[0, 1], [1, 0.5]])).toBe("The curve does not end at a chance of 0.");
  });
});
