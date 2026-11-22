import { checkEndurance, SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK, stopCurves, type EnduranceLayer, type Survival } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import { hazardCase, hazardOf, supplyState } from "./case.ts";
import { HAZARD_LIST } from "./data.ts";
import { EAGLEI_GRID_LAW } from "./eaglei-law.ts";
import { HAZARDS_SCHEMA, type HazardList } from "./hazard.ts";

const STORM = hazardOf(HAZARD_LIST, "met.winter.storm")!;
const SAMPLE_PARTS = { "power.grid": ["grid"], "road.local": ["road"], "phone.network": [] };

describe("a hazard case as the values of CaseCuts", () => {
  it("finds a case by its code", () => {
    expect(STORM.title).toBe("Winter storm");
    expect(hazardOf(HAZARD_LIST, "met.unknown")).toBeUndefined();
  });

  it("gives a cut with no duration for a cut with no law, and the URLs of its claims as its source", () => {
    const cuts = hazardCase(HAZARD_LIST, STORM);
    expect(cuts.case).toBe("met.winter.storm");
    expect(cuts.cuts.map((cut) => cut.part)).toEqual(["power.grid", "phone.network", "road.local"]);
    expect(cuts.cuts.every((cut) => cut.duration === undefined)).toBe(true);
    expect(cuts.cuts[2]?.source).toBe("https://www.weather.gov/safety/winter");
  });

  it("maps each reference part to the parts of a stack, and drops a part with an empty list", () => {
    const mapped = hazardCase(HAZARD_LIST, STORM, { parts: { "power.grid": ["feed-a", "feed-b"], "phone.network": [] } });
    expect(mapped.cuts.map((cut) => cut.part)).toEqual(["feed-a", "feed-b", "road.local"]);
  });

  it("tells no read for a supply that no source names, never a pass", () => {
    expect(supplyState(STORM, "power.grid").state).toBe("cut");
    expect(supplyState(STORM, "water.main")).toEqual({ state: "no-read" });
  });

  it("gives the curve of EAGLE-I of a state for the grid cut of a power outage, and no duration for the other cuts", () => {
    const outage = hazardOf(HAZARD_LIST, "infra.power.outage")!;
    const cuts = hazardCase(HAZARD_LIST, outage, { region: { scheme: "us-state-fips", code: "48" } }).cuts;
    expect(cuts.find((cut) => cut.part === "power.grid")?.duration).toEqual(EAGLEI_GRID_LAW.curves["48"]);
    expect(cuts.filter((cut) => cut.duration !== undefined).map((cut) => cut.part)).toEqual(["power.grid"]);
    expect(hazardCase(HAZARD_LIST, outage).cuts.every((cut) => cut.duration === undefined)).toBe(true);
  });

  it("gives the curve of the region of the user, and no curve for another region", () => {
    const curve: Survival = [
      [0, 1],
      [2, 0],
    ];
    const list: HazardList = {
      schema: HAZARDS_SCHEMA,
      sources: {
        outages: { name: "Outages", url: "https://data.example.net/outages", publisher: "An agency", license: { name: "Public domain", url: "https://data.example.net/terms" }, read: "2026-11-21", regions: { scheme: "test-region", codes: ["A"] } },
      },
      hazards: [
        {
          case: "infra.power.outage",
          title: "Power outage",
          examined: ["outages"],
          cuts: [
            {
              part: "power.grid",
              title: "No power",
              claims: [{ definition: true, says: "The case is a stop of the grid." }],
              duration: { read: true, source: "outages", fit: { family: "exponential", method: "maximum likelihood", count: 9 }, scheme: "test-region", curves: { A: curve } },
            },
          ],
        },
      ],
    };
    const hazard = list.hazards[0]!;
    expect(hazardCase(list, hazard, { region: { scheme: "test-region", code: "A" } }).cuts[0]).toEqual({ part: "power.grid", title: "No power", duration: curve, source: "https://data.example.net/outages" });
    expect(hazardCase(list, hazard, { region: { scheme: "test-region", code: "B" } }).cuts[0]?.duration).toBeUndefined();
    expect(hazardCase(list, hazard, { region: { scheme: "other", code: "A" } }).cuts[0]?.duration).toBeUndefined();
    expect(hazardCase(list, hazard).cuts[0]?.duration).toBeUndefined();
  });

  it("goes into an endurance layer: the gate passes, and a draw that the case can stop is no read", () => {
    const storm = hazardCase(HAZARD_LIST, STORM, { parts: SAMPLE_PARTS });
    const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, cases: [storm], priors: [] };
    const faults = checkEndurance(layer, SAMPLE_ENDURANCE_STACK);
    expect(faults.filter((fault) => fault.level === "error")).toEqual([]);
    expect(faults.filter((fault) => fault.code === "endurance-cut-no-curve")).toHaveLength(2);
    const power = SAMPLE_ENDURANCE.draws.find((draw) => draw.supply === "grid")!;
    expect(stopCurves(storm, power, { stack: SAMPLE_ENDURANCE_STACK })).toBeUndefined();
  });
});
