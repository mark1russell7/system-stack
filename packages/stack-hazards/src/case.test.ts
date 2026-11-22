import { caseShortfall, checkEndurance, enduranceOf, SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK, stopCurves, type EnduranceLayer, type Survival } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import { hazardCase, hazardOf, NO_TOLD_LAW, supplyState, type HazardCaseOptions } from "./case.ts";
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

  it("gives no duration with no region, and the URLs of its claims as its source", () => {
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

  it("keeps each cut with no option, and the option keep gives the same output", () => {
    for (const hazard of HAZARD_LIST.hazards) {
      const cuts = hazardCase(HAZARD_LIST, hazard);
      expect(cuts.cuts.map((cut) => cut.part), hazard.case).toEqual(hazard.cuts.map((cut) => cut.part));
      expect(hazardCase(HAZARD_LIST, hazard, { assessed: "keep" }), hazard.case).toEqual(cuts);
    }
    const war = hazardCase(HAZARD_LIST, hazardOf(HAZARD_LIST, "security.armed-conflict")!);
    expect(war.cuts.map((cut) => cut.source)).toEqual(Array(5).fill("https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-038a"));
  });

  it("keeps a cut with only assessed claims as no read with the option drop, with the source of its claims", () => {
    const war = hazardCase(HAZARD_LIST, hazardOf(HAZARD_LIST, "security.armed-conflict")!, { assessed: "drop" });
    expect(war.cuts.map((cut) => cut.part)).toEqual(["power.grid", "phone.network", "road.local", "water.main", "sewer.main"]);
    expect(war.cuts.filter((cut) => cut.duration === undefined)).toHaveLength(5);
    expect(new Set(war.cuts.map((cut) => cut.source))).toEqual(new Set(["https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-038a"]));
    for (const code of ["civic.ai-collapse", "cbrne.emp", "security.nuclear-war", "cyber.infrastructure-attack"]) {
      const hazard = hazardOf(HAZARD_LIST, code)!;
      expect(hazardCase(HAZARD_LIST, hazard, { assessed: "drop" }).cuts.map((cut) => cut.part), code).toEqual(hazard.cuts.map((cut) => cut.part));
    }
  });

  it("keeps the law of a cut with a told claim, drops the law of a cut with only assessed claims, and drops only the assessed URLs", () => {
    const curve: Survival = [
      [0, 1],
      [2, 0],
    ];
    const told = { source: "page", basis: "told", says: "A page tells it." } as const;
    const risk = { source: "advisory", basis: "assessed", says: "An advisory assesses it." } as const;
    const terms = { name: "Public domain", url: "https://data.example.net/terms" };
    const law = { read: true, source: "outages", fit: { family: "exponential", method: "maximum likelihood", count: 9 }, scheme: "test-region", curves: { A: curve } } as const;
    const list: HazardList = {
      schema: HAZARDS_SCHEMA,
      sources: {
        page: { name: "A page", url: "https://data.example.net/page", publisher: "An agency", license: terms, read: "2026-11-22" },
        advisory: { name: "An advisory", url: "https://data.example.net/advisory", publisher: "An agency", license: terms, read: "2026-11-22" },
        outages: { name: "Outages", url: "https://data.example.net/outages", publisher: "An agency", license: terms, read: "2026-11-22", regions: { scheme: "test-region", codes: ["A"] } },
      },
      hazards: [
        {
          case: "infra.power.outage",
          title: "Power outage",
          examined: ["page", "advisory", "outages"],
          cuts: [
            { part: "power.grid", title: "No power", claims: [told, risk], duration: law },
            { part: "water.main", title: "No water", claims: [risk], duration: law },
            { part: "road.local", title: "No roads", claims: [{ definition: true, says: "The case closes the roads." }, risk], duration: { read: false, reason: "none" } },
          ],
        },
      ],
    };
    const hazard = list.hazards[0]!;
    const region = { scheme: "test-region", code: "A" };
    const view = (options: HazardCaseOptions) => hazardCase(list, hazard, options).cuts.map((cut) => [cut.part, cut.duration === undefined ? "no read" : "curve", cut.source]);
    expect(view({ region })).toEqual([
      ["power.grid", "curve", "https://data.example.net/outages"],
      ["water.main", "curve", "https://data.example.net/outages"],
      ["road.local", "no read", "definition https://data.example.net/advisory"],
    ]);
    expect(view({ region, assessed: "drop" })).toEqual([
      ["power.grid", "curve", "https://data.example.net/outages"],
      ["water.main", "no read", "https://data.example.net/advisory"],
      ["road.local", "no read", "definition"],
    ]);
    expect(view({ assessed: "drop" })).toEqual([
      ["power.grid", "no read", "https://data.example.net/page"],
      ["water.main", "no read", "https://data.example.net/advisory"],
      ["road.local", "no read", "definition"],
    ]);
    expect(supplyState(hazard, "water.main", { assessed: "drop" })).toEqual({ state: "cut", cut: { ...hazard.cuts[1], duration: NO_TOLD_LAW } });
    expect(supplyState(hazard, "power.grid", { assessed: "drop" })).toEqual({ state: "cut", cut: { ...hazard.cuts[0], claims: [told] } });
  });

  it("gives supplyState the cut of hazardCase under each option", () => {
    const war = hazardOf(HAZARD_LIST, "security.armed-conflict")!;
    expect(supplyState(war, "power.grid")).toEqual({ state: "cut", cut: war.cuts[0] });
    expect(supplyState(war, "power.grid", { assessed: "keep" })).toEqual({ state: "cut", cut: war.cuts[0] });
    const dropped = supplyState(war, "power.grid", { assessed: "drop" });
    expect(dropped.state === "cut" ? dropped.cut.duration : undefined).toBe(NO_TOLD_LAW);
    expect(dropped.state === "cut" ? dropped.cut.claims : undefined).toEqual(war.cuts[0]?.claims);
    expect(supplyState(war, "gas.main", { assessed: "drop" })).toEqual({ state: "no-read" });
  });

  it("gives the draws of the war case as no read in an endurance layer with the option drop, not 0 user-days", () => {
    const parts = { "power.grid": ["grid"], "road.local": ["road"], "water.main": ["water-main"], "phone.network": [], "sewer.main": [] };
    const war = hazardOf(HAZARD_LIST, "security.armed-conflict")!;
    for (const assessed of ["keep", "drop"] as const) {
      const cuts = hazardCase(HAZARD_LIST, war, { parts, assessed });
      const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, cases: [cuts], priors: [] };
      expect(checkEndurance(layer, SAMPLE_ENDURANCE_STACK).filter((fault) => fault.level === "error"), assessed).toEqual([]);
      const shortfall = caseShortfall(SAMPLE_ENDURANCE, cuts, enduranceOf(SAMPLE_ENDURANCE, cuts, { at: "2026-12-01" }));
      expect([...shortfall.unread].sort(), assessed).toEqual(["food.energy", "hydration.drink", "power.electric"]);
    }
    // A case with no cut stops no supply, so its draws give 0 user-days: a false pass. The option drop does not give it.
    const none = { case: war.case, title: war.title, cuts: [] };
    const empty = caseShortfall(SAMPLE_ENDURANCE, none, enduranceOf(SAMPLE_ENDURANCE, none, { at: "2026-12-01" }));
    expect(empty.unread).toEqual([]);
    expect(Object.values(empty.levels).every((days) => days === 0)).toBe(true);
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
