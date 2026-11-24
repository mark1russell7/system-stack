import { SAMPLE_ENDURANCE, yearShortfall } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import { checkHazards } from "./check.ts";
import { HAZARDS_SCHEMA, type HazardList, type PriorTable } from "./hazard.ts";
import type { OutageEvent } from "./outages.ts";
import { HAZARD_LIST } from "./data.ts";
import { EAGLEI_COUNTY_PRIORS } from "./eaglei-county-priors.ts";
import { EAGLEI_STATE_PRIORS } from "./eaglei-state-priors.ts";
import { areaCounts, coverageTally, hazardPriors, observedRegions, regionRates, type Observation } from "./priors.ts";

const DAY = 86_400;
const event = (area: string, peak: number): OutageEvent => ({ area, start: 0, seconds: 3600, peak, censored: false });
const state = (area: string): string => area.slice(0, 2);

describe("the priors of the reference list", () => {
  // The list with the table of the counties of the entry county-priors, in front of the table of the states.
  const withCounties: HazardList = { ...HAZARD_LIST, priors: [EAGLEI_COUNTY_PRIORS, ...(HAZARD_LIST.priors ?? [])] };

  it("has the table of the states, and the table of the counties is in its own entry. The gate passes with the two", () => {
    expect(HAZARD_LIST.priors).toEqual([EAGLEI_STATE_PRIORS]);
    expect([EAGLEI_COUNTY_PRIORS.scheme, EAGLEI_STATE_PRIORS.scheme]).toEqual(["us-county-fips", "us-state-fips"]);
    expect(EAGLEI_COUNTY_PRIORS.codes.length).toBeGreaterThan(3000);
    expect(EAGLEI_STATE_PRIORS.codes.length).toBeGreaterThanOrEqual(50);
    expect(checkHazards(withCounties).filter((fault) => fault.code === "hazards-prior")).toEqual([]);
  });

  it("holds the events at one customer in one year of the tables: a median in a band, no region above the limit and no more left-out regions", () => {
    for (const [table, most] of [[EAGLEI_COUNTY_PRIORS, 31], [EAGLEI_STATE_PRIORS, 2]] as const) {
      const products = Object.values(table.rates["infra.power.outage"] ?? {}).map(([perYear, reach]) => perYear * reach).sort((a, b) => a - b);
      const median = products[Math.floor(products.length / 2)]!;
      // The utilities report one or two interruptions a year at a customer. The counts here start at 1% of a county.
      expect(median).toBeGreaterThan(0.3);
      expect(median).toBeLessThan(3);
      for (const entry of Object.values(table.rates)) for (const [perYear, reach] of Object.values(entry)) expect(perYear * reach).toBeLessThanOrEqual(12);
      const left = Number(/no read: (\d+) regions/u.exec(table.method)?.[1]);
      expect(left).toBeLessThanOrEqual(most);
    }
  });

  it("gives a prior of each case of the tables for a county, and the prior of the state for a county that no table has", () => {
    const cases = Object.keys(EAGLEI_COUNTY_PRIORS.rates).sort();
    const county = hazardPriors(withCounties, { region: [{ scheme: "us-county-fips", code: "01001" }, { scheme: "us-state-fips", code: "01" }] });
    expect(county.map((prior) => prior.case).sort()).toEqual(cases);
    for (const prior of county) {
      expect(prior.perYear).toBeGreaterThanOrEqual(0);
      expect(prior.reach).toBeGreaterThanOrEqual(0);
      expect(prior.reach).toBeLessThanOrEqual(1);
      expect(prior.asOf).toBe(EAGLEI_COUNTY_PRIORS.asOf);
    }
    expect(county.find((prior) => prior.case === "infra.power.outage")?.place).toBe("us-county-fips:01001");
    // A code that is not a county falls back to the table of the state.
    const state = hazardPriors(withCounties, { region: [{ scheme: "us-county-fips", code: "00000" }, { scheme: "us-state-fips", code: "01" }] });
    expect(new Set(state.map((prior) => prior.place))).toEqual(new Set(["us-state-fips:01"]));
    expect(hazardPriors(HAZARD_LIST, {})).toEqual([]);
  });

  it("gives each prior the place of the option, so yearShortfall finds the prior of the state after the fall back", () => {
    const region = [{ scheme: "us-county-fips", code: "00000" }, { scheme: "us-state-fips", code: "01" }] as const;
    const home = hazardPriors(withCounties, { region, place: "home" });
    const plain = hazardPriors(withCounties, { region });
    expect(home).toEqual(plain.map((prior) => ({ ...prior, place: "home" })));
    // The cuts of the sample storm, as the outage case of the list. With the default place, the place of the user finds no prior.
    const [storm] = SAMPLE_ENDURANCE.cases ?? [];
    if (storm === undefined) throw new Error("The sample layer has no case.");
    const cases = [{ ...storm, case: "infra.power.outage" }];
    const at = { at: "2026-12-01" };
    expect(yearShortfall({ ...SAMPLE_ENDURANCE, cases, priors: plain }, "home", at).cases).toEqual([]);
    const year = yearShortfall({ ...SAMPLE_ENDURANCE, cases, priors: home }, "home", at);
    const outage = home.find((prior) => prior.case === "infra.power.outage");
    expect(outage?.perYear).toBeGreaterThan(0);
    expect(year.cases.map((item) => [item.case, item.rate])).toEqual([["infra.power.outage", (outage?.perYear ?? 0) * (outage?.reach ?? 0)]]);
    expect(() => hazardPriors(withCounties, { region, place: "" })).toThrow(RangeError);
    expect(() => hazardPriors(withCounties, { region, place: " home" })).toThrow(RangeError);
  });
});

describe("the counts of the priors", () => {
  it("counts the calendar years in which a source lists each area", () => {
    const tally = coverageTally();
    const at = (year: number, day = 0): number => Date.UTC(year, 0, 1) / 1000 + day * DAY;
    for (const time of [at(2020), at(2020, 200), at(2021), at(2023)]) tally.add({ area: "01001", out: 5, time });
    tally.add({ area: "01003", out: undefined, time: at(2022) });
    expect(Object.fromEntries(tally.years())).toEqual({ "01001": 3, "01003": 1 });
  });

  it("counts the events and the peak shares of each area with customers, with a share of at most 1", () => {
    const customers = new Map([
      ["01001", 1000],
      ["01003", 100],
    ]);
    const counts = areaCounts([event("01003", 500), event("01001", 100), event("01001", 300), event("99999", 10)], customers);
    expect(counts).toEqual({ "01001": { events: 2, share: 0.4 }, "01003": { events: 1, share: 1 } });
  });
});

describe("the rates of the regions", () => {
  const observation: Observation = {
    years: { "01001": 2, "01003": 4, "01005": 4, "02001": 1, "02003": 0 },
    customers: { "01001": 1000, "01003": 3000, "01005": 1000, "02001": 500, "02003": 500 },
  };
  const counts = { "01001": { events: 4, share: 1 }, "01003": { events: 2, share: 1.5 }, "02003": { events: 9, share: 9 } };

  it("gives each area its events in one year and the mean peak share of its events", () => {
    const rates = regionRates(counts, observation, (area) => area);
    expect(rates).toEqual({ "01001": [2, 0.25], "01003": [0.5, 0.75] });
  });

  it("pools the areas of a region: perYear * reach is the expected events at one customer in one year", () => {
    const [perYear, reach] = regionRates(counts, observation, state)["01"] ?? [0, 0];
    expect(perYear).toBe(2.5);
    // The hits in one year: 1 * 1000 / 2 + 1.5 * 3000 / 4 = 1625, over the 5000 customers of the observed areas.
    expect(perYear * reach).toBeCloseTo(1625 / 5000, 12);
  });

  it("gives no rate for an observed region with no event, and leaves out an area with no year", () => {
    expect(observedRegions(observation, state)).toEqual(["01", "02"]);
    expect(regionRates(counts, observation, state)["02"]).toBeUndefined();
    expect(observedRegions(observation, (area) => area)).not.toContain("02003");
  });
});

describe("hazardPriors", () => {
  const county: PriorTable = {
    source: "outages",
    asOf: "2026-02-25",
    scheme: "test-county",
    method: "The events of each county in one year.",
    codes: ["A1", "A2"],
    rates: { "infra.power.outage": { A1: [2, 0.25] }, "met.flood": { A1: [0.5, 0.5] } },
  };
  const region: PriorTable = { ...county, scheme: "test-region", codes: ["A"], rates: { "infra.power.outage": { A: [40, 0.01] } } };
  const list: HazardList = {
    schema: HAZARDS_SCHEMA,
    sources: { outages: { id: "outages", title: "Outages", url: "https://data.example.net/outages", by: "An agency", license: "public-domain", terms: "https://data.example.net/terms", checked: "2026-11-21" } },
    hazards: [
      { case: "infra.power.outage", title: "Power outage", examined: ["outages"], cuts: [] },
      { case: "met.flood", title: "Flood", examined: ["outages"], cuts: [] },
      { case: "met.tornado", title: "Tornado", examined: ["outages"], cuts: [] },
    ],
    priors: [county, region],
  };

  it("gives the prior of the first region of the option with a table of the case", () => {
    expect(hazardPriors(list, { region: [{ scheme: "test-county", code: "A1" }, { scheme: "test-region", code: "A" }] })).toEqual([
      { case: "infra.power.outage", place: "test-county:A1", perYear: 2, reach: 0.25, source: "https://data.example.net/outages", asOf: "2026-02-25" },
      { case: "met.flood", place: "test-county:A1", perYear: 0.5, reach: 0.5, source: "https://data.example.net/outages", asOf: "2026-02-25" },
    ]);
    expect(hazardPriors(list, { region: [{ scheme: "test-region", code: "A" }, { scheme: "test-county", code: "A1" }] })[0]?.place).toBe("test-region:A");
  });

  it("gives a prior of 0 in an observed region with no event, and no prior with no table: that is no read", () => {
    const priors = hazardPriors(list, { region: { scheme: "test-county", code: "A2" } });
    expect(priors.map((prior) => [prior.case, prior.perYear, prior.reach])).toEqual([
      ["infra.power.outage", 0, 0],
      ["met.flood", 0, 0],
    ]);
    // The region table has no flood, so a flood in the region is no read. A region that no table observes gives no prior.
    expect(hazardPriors(list, { region: { scheme: "test-region", code: "A" } }).map((prior) => prior.case)).toEqual(["infra.power.outage"]);
    expect(hazardPriors(list, { region: { scheme: "test-county", code: "B1" } })).toEqual([]);
    expect(hazardPriors(list)).toEqual([]);
  });

  it("passes the gate with good tables, and refuses a table with a wrong source, case, region or rate", () => {
    const prior = (tables: readonly PriorTable[]): string[] => checkHazards({ ...list, priors: tables }).filter((fault) => fault.code === "hazards-prior").map((fault) => fault.message);
    expect(prior([county, region])).toEqual([]);
    expect(prior([{ ...county, source: "none" }])).toHaveLength(1);
    expect(prior([{ ...county, asOf: "2026-02" }])).toHaveLength(1);
    expect(prior([{ ...county, method: " " }])).toHaveLength(1);
    expect(prior([{ ...county, rates: { "met.unknown": { A1: [1, 0.5] } } }])).toHaveLength(1);
    expect(prior([{ ...county, rates: { "met.flood": { B1: [1, 0.5] } } }])).toHaveLength(1);
    expect(prior([{ ...county, rates: { "met.flood": { A1: [-1, 0.5] } } }])).toHaveLength(1);
    expect(prior([{ ...county, rates: { "met.flood": { A1: [1, 1.5] } } }])).toHaveLength(1);
    expect(prior([{ ...county, rates: { "met.flood": { A1: [Number.NaN, 0.5] } } }])).toHaveLength(1);
  });
});
