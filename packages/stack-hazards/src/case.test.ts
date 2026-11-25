import { caseShortfall, checkEndurance, enduranceOf, SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK, stopCurves, type EnduranceLayer, type Survival } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import { curveFault } from "@mark1russell7/system-stack";
import { followCurve, hazardCase, hazardOf, NO_TOLD_LAW, supplyState, type HazardCaseOptions } from "./case.ts";
import { HAZARD_LIST, HAZARD_SOURCES, WATER_RECOVERY } from "./data.ts";
import { EAGLEI_GRID_LAW } from "./eaglei-law.ts";
import { OE417_ATTACK_LAW, OE417_SOURCE } from "./oe417.ts";
import { HAZARDS_SCHEMA, type CitedSpan, type HazardCut, type HazardList } from "./hazard.ts";

const STORM = hazardOf(HAZARD_LIST, "met.winter.storm")!;
const EAGLEI_SOURCE_URL = HAZARD_SOURCES[EAGLEI_GRID_LAW.source]?.url;
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

  it("gives the curve of EAGLE-I of a state for the grid cut of a power outage, and to the cuts that follow it", () => {
    const outage = hazardOf(HAZARD_LIST, "infra.power.outage")!;
    const cuts = hazardCase(HAZARD_LIST, outage, { region: { scheme: "us-state-fips", code: "48" } }).cuts;
    expect(cuts.find((cut) => cut.part === "power.grid")?.duration).toEqual(EAGLEI_GRID_LAW.curves["48"]);
    // Before 0.7.0, only the grid cut had a curve. Each other cut follows the grid cut.
    expect(cuts.filter((cut) => cut.duration !== undefined).map((cut) => cut.part)).toEqual(outage.cuts.map((cut) => cut.part));
    expect(cuts.filter((cut) => cut.follows === undefined).map((cut) => cut.part)).toEqual(["power.grid"]);
    expect(hazardCase(HAZARD_LIST, outage).cuts.every((cut) => cut.duration === undefined)).toBe(true);
  });

  it("gives the law of the nation to the grid cut of a physical attack, and a state law to a power outage, from one list of regions", () => {
    const attack = hazardOf(HAZARD_LIST, "infra.power.physical-attack")!;
    const outage = hazardOf(HAZARD_LIST, "infra.power.outage")!;
    const place = [
      { scheme: "us-state-fips", code: "37" },
      { scheme: "us-nation", code: "US" },
    ];
    const grid = (hazard: typeof attack, options: HazardCaseOptions) => hazardCase(HAZARD_LIST, hazard, options).cuts.find((cut) => cut.part === "power.grid");
    expect(grid(attack, { region: place })?.duration).toEqual(OE417_ATTACK_LAW.curves["US"]);
    expect(grid(attack, { region: place })?.source).toBe(OE417_SOURCE.url);
    expect(grid(outage, { region: place })?.duration).toEqual(EAGLEI_GRID_LAW.curves["37"]);
    expect(grid(attack, { region: { scheme: "us-nation", code: "US" } })?.duration).toEqual(OE417_ATTACK_LAW.curves["US"]);
    // A state alone does not reach the law of the nation: the cut is no read, not a pass.
    expect(grid(attack, { region: place[0] })?.duration).toBeUndefined();
    expect(grid(attack, { region: [] })?.duration).toBeUndefined();
  });

  it("reads the first region of the scheme of a law", () => {
    const outage = hazardOf(HAZARD_LIST, "infra.power.outage")!;
    const cuts = hazardCase(HAZARD_LIST, outage, { region: [{ scheme: "us-state-fips", code: "48" }, { scheme: "us-state-fips", code: "37" }] }).cuts;
    expect(cuts.find((cut) => cut.part === "power.grid")?.duration).toEqual(EAGLEI_GRID_LAW.curves["48"]);
  });

  it("gives the curve of the region of the user, and no curve for another region", () => {
    const curve: Survival = [
      [0, 1],
      [2, 0],
    ];
    const list: HazardList = {
      schema: HAZARDS_SCHEMA,
      sources: {
        outages: { id: "outages", title: "Outages", url: "https://data.example.net/outages", by: "An agency", license: "public-domain", terms: "https://data.example.net/terms", checked: "2026-11-21", regions: { scheme: "test-region", codes: ["A"] } },
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
    expect(hazardCase(list, hazard, { region: { scheme: "test-region", code: "A" } }).cuts[0]).toEqual({ part: "power.grid", title: "No power", duration: curve, bound: "law", source: "https://data.example.net/outages" });
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
    const terms = { license: "public-domain", terms: "https://data.example.net/terms" } as const;
    const law = { read: true, source: "outages", fit: { family: "exponential", method: "maximum likelihood", count: 9 }, scheme: "test-region", curves: { A: curve } } as const;
    const list: HazardList = {
      schema: HAZARDS_SCHEMA,
      sources: {
        page: { id: "page", title: "A page", url: "https://data.example.net/page", by: "An agency", ...terms, checked: "2026-11-22" },
        advisory: { id: "advisory", title: "An advisory", url: "https://data.example.net/advisory", by: "An agency", ...terms, checked: "2026-11-22" },
        outages: { id: "outages", title: "Outages", url: "https://data.example.net/outages", by: "An agency", ...terms, checked: "2026-11-22", regions: { scheme: "test-region", codes: ["A"] } },
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

describe("the curve of a cut that follows another cut", () => {
  const cause: Survival = [
    [0, 1],
    [1, 0.5],
    [3, 0],
  ];

  it("shifts the cause curve down by the onset and up by the recovery", () => {
    expect(followCurve(cause, 0, 0)).toEqual(cause);
    expect(followCurve(cause, 0, 2)).toEqual([
      [0, 1],
      [2, 1],
      [3, 0.5],
      [5, 0],
    ]);
    // The chance at the onset of 1 day is 0.5: the curve reads it at the day of the recovery.
    expect(followCurve(cause, 1, 1)).toEqual([
      [0, 1],
      [1, 0.5],
      [3, 0],
    ]);
    expect(followCurve(cause, 2, 1)).toEqual([
      [0, 1],
      [1, 0.25],
      [2, 0],
    ]);
  });

  it("gives a curve above the law where the cause can end before the onset, and no curve when the cut does not occur", () => {
    // The law after an onset of 1 day starts at 0.5. A curve of the core starts at 1, so it falls linearly to its next point.
    expect(followCurve(cause, 1, 0)).toEqual([
      [0, 1],
      [2, 0],
    ]);
    expect(followCurve(cause, 3, 0)).toBeUndefined();
    expect(followCurve(cause, 4, 1)).toEqual([
      [0, 1],
      [1, 0],
    ]);
  });

  it("gives curves with the form of the core, and refuses a term that is not a finite number of 0 or more", () => {
    for (const [onset, recovery] of [
      [0, 0],
      [0, 2],
      [0.5, 0],
      [0.5, 1.5],
      [2.5, 0.25],
      [3, 1],
    ] as const) {
      const curve = followCurve(cause, onset, recovery);
      expect(curve === undefined ? "none" : curveFault(curve), `${String(onset)} ${String(recovery)}`).toBeUndefined();
    }
    expect(() => followCurve(cause, -1, 0)).toThrow(RangeError);
    expect(() => followCurve(cause, 0, Number.NaN)).toThrow(RangeError);
    expect(() => followCurve(cause, Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
  });
});

describe("a hazard case with cuts that follow another cut", () => {
  const curve: Survival = [
    [0, 1],
    [1, 0.5],
    [3, 0],
  ];
  const terms = { license: "public-domain", terms: "https://data.example.net/terms", by: "An agency", checked: "2026-11-24" } as const;
  const span = (low: number, high: number, unit: CitedSpan["unit"], source: string, basis: CitedSpan["basis"] = "range"): CitedSpan => ({ low, high, unit, basis, says: "A made-up span.", claims: [{ source, basis: "told", says: "A rule tells it." }] });
  const noLaw = { read: false, reason: "none" } as const;
  const defined = [{ definition: true, says: "The case stops it." }] as const;
  const follow = (part: string, follows: HazardCut["follows"], claims: HazardCut["claims"] = defined): HazardCut => ({ part, title: part, claims, duration: noLaw, follows });
  const list: HazardList = {
    schema: HAZARDS_SCHEMA,
    sources: {
      outages: { id: "outages", title: "Outages", url: "https://data.example.net/outages", ...terms, regions: { scheme: "test-region", codes: ["A"] } },
      rule: { id: "rule", title: "A rule", url: "https://data.example.net/rule", ...terms },
      table: { id: "table", title: "A table", url: "https://data.example.net/table", ...terms },
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
            claims: defined,
            duration: { read: true, source: "outages", fit: { family: "exponential", method: "maximum likelihood", count: 9 }, scheme: "test-region", curves: { A: curve } },
          },
          follow("phone.network", { part: "power.grid" }),
          follow("water.main", { part: "power.grid", recovery: span(24, 48, "hours", "rule") }),
          follow("road.local", { part: "power.grid", onset: span(0.5, 1, "days", "table"), recovery: span(1, 2, "days", "rule") }),
          // A chain: the shops follow the phone cut, which follows the grid cut.
          follow("food.retail", { part: "phone.network", recovery: span(12, 24, "hours", "table") }),
          // A minimum onset is an upper bound, and a minimum recovery is a lower bound.
          follow("heat.main", { part: "power.grid", onset: span(12, 24, "hours", "table", "minimum"), recovery: span(1, 2, "days", "rule") }),
          follow("air.main", { part: "power.grid", recovery: span(24, 48, "hours", "rule", "minimum") }),
          follow("gas.main", { part: "sewer.main" }),
        ],
      },
    ],
  };
  const hazard = list.hazards[0]!;
  const region = { scheme: "test-region", code: "A" };

  it("gives each dependent cut the shifted curve of its cause, with the sources of the cause law and of the terms", () => {
    const cuts = hazardCase(list, hazard, { region }).cuts;
    const view = cuts.map((cut) => [cut.part, cut.duration, cut.source]);
    expect(view).toEqual([
      ["power.grid", curve, "https://data.example.net/outages"],
      ["phone.network", curve, "https://data.example.net/outages"],
      ["water.main", followCurve(curve, 0, 2), "https://data.example.net/outages https://data.example.net/rule"],
      ["road.local", followCurve(curve, 0.5, 2), "https://data.example.net/outages https://data.example.net/table https://data.example.net/rule"],
      ["food.retail", followCurve(curve, 0, 1), "https://data.example.net/outages https://data.example.net/table"],
      ["heat.main", followCurve(curve, 0.5, 2), "https://data.example.net/outages https://data.example.net/table https://data.example.net/rule"],
      ["air.main", followCurve(curve, 0, 1), "https://data.example.net/outages https://data.example.net/rule"],
      ["gas.main", undefined, "definition"],
    ]);
  });

  it("states the side of each term, and claims a bound only when each term is an upper bound", () => {
    const cuts = hazardCase(list, hazard, { region }).cuts;
    const read = (part: string) => cuts.find((cut) => cut.part === part)?.follows;
    expect(read("power.grid")).toBeUndefined();
    expect(read("phone.network")).toEqual({
      part: "power.grid",
      onset: { days: 0, cited: false, side: "upper", says: "onset not cited: 0, an upper bound" },
      recovery: { days: 0, cited: false, side: "lower", says: "recovery not cited: 0, a lower bound" },
      bound: "none",
    });
    expect(read("water.main")).toEqual({
      part: "power.grid",
      onset: { days: 0, cited: false, side: "upper", says: "onset not cited: 0, an upper bound" },
      recovery: { days: 2, cited: true, side: "upper", says: "recovery cited as a range: the high end, 48 hours, an upper bound" },
      bound: "upper",
    });
    expect(read("road.local")?.onset).toEqual({ days: 0.5, cited: true, side: "upper", says: "onset cited as a range: the low end, 0.5 days, an upper bound" });
    expect(read("road.local")?.bound).toBe("upper");
    expect(read("heat.main")?.onset).toEqual({ days: 0.5, cited: true, side: "upper", says: "onset cited as a rule minimum: the low end, 12 hours, an upper bound" });
    expect(read("heat.main")?.bound).toBe("upper");
    expect(read("air.main")?.recovery).toEqual({ days: 1, cited: true, side: "lower", says: "recovery cited as a rule minimum: the low end, 24 hours, a lower bound" });
    expect(read("air.main")?.bound).toBe("none");
    // The cause of the shops is the phone cut, which is not a bound. So the shops claim no bound.
    expect(read("food.retail")?.bound).toBe("none");
    expect(read("gas.main")).toBeUndefined();
  });

  it("sets the bound of the core on each cut with a curve: law for a cut with its own law, and the bound of follows for a dependent cut", () => {
    const cuts = hazardCase(list, hazard, { region }).cuts;
    expect(cuts.map((cut) => [cut.part, cut.bound])).toEqual([
      ["power.grid", "law"],
      ["phone.network", "none"],
      ["water.main", "upper"],
      ["road.local", "upper"],
      ["food.retail", "none"],
      ["heat.main", "upper"],
      ["air.main", "none"],
      ["gas.main", undefined],
    ]);
    for (const cut of cuts) if (cut.follows !== undefined) expect(cut.bound).toBe(cut.follows.bound);
    expect(cuts.find((cut) => cut.part === "gas.main")).not.toHaveProperty("bound");
    // The terms give no lower bound: each onset is an upper bound.
    expect(cuts.some((cut) => cut.bound === "lower")).toBe(false);
  });

  it("gives a dependent cut no duration and no field follows when its cause has no curve, as before", () => {
    for (const options of [{}, { region: { scheme: "test-region", code: "B" } }]) {
      const cuts = hazardCase(list, hazard, options).cuts;
      expect(cuts.every((cut) => cut.duration === undefined && !("follows" in cut) && !("bound" in cut))).toBe(true);
      expect(cuts.map((cut) => cut.source)).toEqual(["definition", "definition", "definition", "definition", "definition", "definition", "definition", "definition"]);
    }
  });

  it("maps a dependent cut to the parts of a stack, and finds its cause by the reference part", () => {
    const cuts = hazardCase(list, hazard, { region, parts: { "power.grid": ["feed"], "water.main": ["main-a", "main-b"] } }).cuts;
    expect(cuts.filter((cut) => cut.part.startsWith("main-")).map((cut) => cut.duration)).toEqual([followCurve(curve, 0, 2), followCurve(curve, 0, 2)]);
  });

  it("gives no curve to a dependent cut with only assessed claims and the option drop", () => {
    const risk = [{ source: "rule", basis: "assessed", says: "A rule assesses it." }] as const;
    const assessed: HazardList = { ...list, hazards: [{ ...hazard, cuts: [hazard.cuts[0]!, follow("water.main", { part: "power.grid" }, risk)] }] };
    const [, keep] = hazardCase(assessed, assessed.hazards[0]!, { region }).cuts;
    const [, drop] = hazardCase(assessed, assessed.hazards[0]!, { region, assessed: "drop" }).cuts;
    expect(keep?.duration).toEqual(curve);
    expect([drop?.duration, drop?.source]).toEqual([undefined, "https://data.example.net/rule"]);
  });

  it("gives the water main of a power outage the curve of the state, shifted up by the rule minimum of 24 hours, a lower bound, with the sources of the rules", () => {
    const outage = hazardOf(HAZARD_LIST, "infra.power.outage")!;
    const cuts = hazardCase(HAZARD_LIST, outage, { region: { scheme: "us-state-fips", code: "48" } }).cuts;
    const water = cuts.find((cut) => cut.part === "water.main");
    expect(water?.duration).toEqual(followCurve(EAGLEI_GRID_LAW.curves["48"]!, 0, 1));
    expect(water?.source.split(" ")).toEqual([EAGLEI_SOURCE_URL, ...WATER_RECOVERY.claims.map((claim) => HAZARD_SOURCES[claim.source ?? ""]?.url)]);
    expect([water?.follows?.onset.says, water?.follows?.recovery.says, water?.follows?.bound]).toEqual(["onset not cited: 0, an upper bound", "recovery cited as a rule minimum: the low end, 24 hours, a lower bound", "none"]);
    expect(water?.follows?.recovery.side).toBe("lower");
    for (const part of ["phone.network", "road.local", "food.retail", "fuel.retail", "cash.retail"]) {
      const cut = cuts.find((item) => item.part === part);
      expect(cut?.duration, part).toEqual(EAGLEI_GRID_LAW.curves["48"]);
      expect([cut?.source, cut?.follows?.recovery.side, cut?.follows?.bound], part).toEqual([EAGLEI_SOURCE_URL, "lower", "none"]);
    }
  });

  it("gives the cuts of a physical attack the law of the nation, and the cuts of a long collapse no curve", () => {
    const attack = hazardCase(HAZARD_LIST, hazardOf(HAZARD_LIST, "infra.power.physical-attack")!, { region: { scheme: "us-nation", code: "US" } }).cuts;
    expect(attack.find((cut) => cut.part === "water.main")?.duration).toEqual(followCurve(OE417_ATTACK_LAW.curves["US"]!, 0, 1));
    const collapse = hazardCase(HAZARD_LIST, hazardOf(HAZARD_LIST, "infra.power.grid-collapse")!, { region: [{ scheme: "us-state-fips", code: "48" }, { scheme: "us-nation", code: "US" }] }).cuts;
    expect(collapse.every((cut) => cut.duration === undefined && cut.follows === undefined)).toBe(true);
  });

  it("goes into an endurance layer with the curves of the dependent cuts: the gate passes", () => {
    const parts = { "power.grid": ["grid"], "road.local": ["road"], "water.main": ["water-main"], "phone.network": [], "food.retail": [], "fuel.retail": [], "cash.retail": [] };
    const outage = hazardCase(HAZARD_LIST, hazardOf(HAZARD_LIST, "infra.power.outage")!, { parts, region: { scheme: "us-state-fips", code: "48" } });
    const layer: EnduranceLayer = { ...SAMPLE_ENDURANCE, cases: [outage], priors: [] };
    expect(checkEndurance(layer, SAMPLE_ENDURANCE_STACK).filter((fault) => fault.level === "error")).toEqual([]);
    expect(outage.cuts.every((cut) => cut.duration !== undefined)).toBe(true);
  });
});
