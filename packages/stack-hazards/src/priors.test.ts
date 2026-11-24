import { SAMPLE_ENDURANCE, yearShortfall } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import { checkHazards } from "./check.ts";
import { HAZARDS_SCHEMA, type HazardList, type PriorTable } from "./hazard.ts";
import type { OutageEvent } from "./outages.ts";
import { HAZARD_LIST } from "./data.ts";
import { EAGLEI_COUNTY_POOLING, EAGLEI_COUNTY_PRIORS } from "./eaglei-county-priors.ts";
import { EAGLEI_STATE_POOLING, EAGLEI_STATE_PRIORS } from "./eaglei-state-priors.ts";
import { OE417_NATION_PRIORS } from "./oe417.ts";
import { areaCounts, coverageTally, hazardPriors, observedRegions, pooledRates, regionCounts, regionObservation, regionRates, withoutSilentAreas, type Observation } from "./priors.ts";

const DAY = 86_400;
const event = (area: string, peak: number): OutageEvent => ({ area, start: 0, seconds: 3600, peak, censored: false });
const state = (area: string): string => area.slice(0, 2);

describe("the priors of the reference list", () => {
  // The list with the table of the counties of the entry county-priors, in front of the table of the states.
  const withCounties: HazardList = { ...HAZARD_LIST, priors: [EAGLEI_COUNTY_PRIORS, ...(HAZARD_LIST.priors ?? [])] };

  it("has the table of the states, and the table of the counties is in its own entry. The gate passes with the two", () => {
    expect(HAZARD_LIST.priors).toEqual([EAGLEI_STATE_PRIORS, OE417_NATION_PRIORS]);
    expect([EAGLEI_COUNTY_PRIORS.scheme, EAGLEI_STATE_PRIORS.scheme]).toEqual(["us-county-fips", "us-state-fips"]);
    expect(EAGLEI_COUNTY_PRIORS.codes.length).toBeGreaterThan(3000);
    expect(EAGLEI_STATE_PRIORS.codes.length).toBeGreaterThanOrEqual(50);
    expect(checkHazards(withCounties).filter((fault) => fault.code === "hazards-prior")).toEqual([]);
  });

  it("holds the events at one customer in one year of the tables: a median in a band, no region above the limit and no more left-out regions", () => {
    for (const [table, most] of [[EAGLEI_COUNTY_PRIORS, 8], [EAGLEI_STATE_PRIORS, 2]] as const) {
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
    expect(county.find((prior) => prior.case === "infra.power.outage")?.region).toBe("us-county-fips:01001");
    expect(new Set(state.map((prior) => prior.region))).toEqual(new Set(["us-state-fips:01"]));
    expect(hazardPriors(HAZARD_LIST, {})).toEqual([]);
  });

  it("gives each prior the place of the option, so yearShortfall finds the prior of the state after the fall back", () => {
    const region = [{ scheme: "us-county-fips", code: "00000" }, { scheme: "us-state-fips", code: "01" }] as const;
    const home = hazardPriors(withCounties, { region, place: "home" });
    const plain = hazardPriors(withCounties, { region });
    expect(home).toEqual(plain.map((prior) => ({ ...prior, place: "home" })));
    // The option place changes the place, not the region: the page still tells that the rate is the rate of the state.
    expect(new Set(home.map((prior) => prior.region))).toEqual(new Set(["us-state-fips:01"]));
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
    expect(Object.fromEntries(tally.calendar())).toEqual({ "01001": [2020, 2021, 2023], "01003": [2022] });
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

describe("the pooled rates of the areas", () => {
  // The state 99 has two counties with events. The state 98 has two observed counties and no event. The county 97001 has no customers.
  const observation: Observation = { years: { "99001": 3, "99003": 3, "98001": 2, "98002": 4, "97001": 5 }, customers: { "99001": 3000, "99003": 1000, "98001": 10, "98002": 10 } };
  const counts = { "99001": { events: 9, share: 0.9 }, "99003": { events: 3, share: 0.6 } };

  it("moves the rate of each county toward the mean of its state, and keeps the events of the state", () => {
    const { rates, laws } = pooledRates(counts, observation, state);
    expect(laws["99"]).toMatchObject({ mean: 2, areas: 2, events: 12, from: "group" });
    const [high, low] = [rates["99001"]?.[0] ?? 0, rates["99003"]?.[0] ?? 0];
    // The raw rates are 3 and 1. Each pooled rate is between its raw rate and the mean of the state.
    expect(high).toBeGreaterThan(2);
    expect(high).toBeLessThan(3);
    expect(low).toBeGreaterThan(1);
    expect(low).toBeLessThan(2);
    // With equal years, the pooled events of the state are its events.
    expect((high + low) * 3).toBeCloseTo(12, 9);
    // The reach of a county with events is the mean share of its events.
    expect(rates["99003"]?.[1]).toBeCloseTo(0.2, 12);
    expect(rates["97001"]).toBeUndefined();
  });

  it("gives a state with no event its pooled rate toward the states with events, and the plain mean reach of all counties with events", () => {
    const { rates, laws } = pooledRates(counts, observation, state);
    const law = laws["98"];
    expect(law).toMatchObject({ shape: Number.POSITIVE_INFINITY, areas: 2, events: 0, from: "nation" });
    expect(law?.mean).toBeGreaterThan(0);
    // The raw rate of the state 99 is 2. The rate of a state with no event is far under it.
    expect(law?.mean).toBeLessThan(1);
    // The reach of 99001 is 0.1 and of 99003 is 0.2. Their plain mean is 0.15. The mean over the events is 1.5 / 12 = 0.125.
    expect(rates["98001"]?.[0]).toBe(law?.mean);
    expect(rates["98001"]?.[1]).toBeCloseTo(0.15, 12);
    expect(rates["98002"]).toEqual(rates["98001"]);
  });

  it("gives no rate when no area has an event, and an area with no event in a state with events gets the mean reach of the state", () => {
    expect(pooledRates({}, observation, state).rates).toEqual({});
    const one = pooledRates({ "99001": { events: 2, share: 0.5 } }, observation, state).rates;
    expect(one["99003"]?.[1]).toBe(0.25);
  });

  it("gives an area with no event the plain mean of the reach of the areas of its state with events, not the mean over the events", () => {
    const three: Observation = { years: { "99001": 1, "99003": 1, "99005": 1 }, customers: { "99001": 10, "99003": 10, "99005": 10 } };
    // The reach of 99001 is 0.5 in 1 event, and of 99003 is 0.1 in 3 events. The plain mean is 0.3. The mean over the events is 0.8 / 4 = 0.2.
    const { rates } = pooledRates({ "99001": { events: 1, share: 0.5 }, "99003": { events: 3, share: 0.3 } }, three, state);
    expect(rates["99005"]?.[1]).toBeCloseTo(0.3, 12);
  });

  it("holds the gate of the committed table: in each case, the pooled rates score above the raw rates and the state rates on the held-out events", () => {
    expect(EAGLEI_COUNTY_POOLING.holdout.rounds).toBeGreaterThanOrEqual(5);
    const cases = Object.keys(EAGLEI_COUNTY_PRIORS.rates).sort();
    expect(Object.keys(EAGLEI_COUNTY_POOLING.holdout.cases)).toEqual(cases);
    for (const name of cases) {
      const score = EAGLEI_COUNTY_POOLING.holdout.cases[name];
      expect(score?.pooled, name).toBeGreaterThan(score?.state ?? Number.POSITIVE_INFINITY);
      // The raw score is -Infinity when a county with no event in the fit half has an event in the score half. Thus the finite scores of the counties with events compare pooled with raw.
      expect(score?.seen.pooled, name).toBeGreaterThan(score?.seen.raw ?? Number.POSITIVE_INFINITY);
      expect(score?.squared.pooled, name).toBeLessThan(Math.min(score?.squared.raw ?? 0, score?.squared.state ?? 0));
      // The gate of the reach of the counties with no event in the fit half: the plain mean has a mean absolute error within 5% of the mean over the events.
      expect(score?.reach.plain.error, name).toBeLessThanOrEqual(1.05 * (score?.reach.events.error ?? 0));
      // Each state with an observed county has a law in each case.
      expect(Object.keys(EAGLEI_COUNTY_POOLING.laws[name] ?? {}).length, name).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("the pooled rates of the states", () => {
  // The state 01 has two observed counties with events. The state 02 has one observed county with no event. The county 02003 has no year.
  const observation: Observation = { years: { "01001": 2, "01003": 4, "02001": 3, "02003": 0 }, customers: { "01001": 1000, "01003": 3000, "02001": 500, "02003": 500 } };
  const counts = { "01001": { events: 4, share: 1 }, "01003": { events: 2, share: 1.5 }, "02003": { events: 9, share: 9 } };

  it("makes each state an area: the plain mean of the years of its counties, the sum of their customers, events and shares of the state", () => {
    expect(regionObservation(observation, state)).toEqual({ years: { "01": 3, "02": 3 }, customers: { "01": 4000, "02": 500 } });
    const regions = regionCounts(counts, observation, state);
    // The share of the state 01: 1 * 1000 / 4000 + 1.5 * 3000 / 4000 = 1.375. The county 02003 has no year, so it is not observed.
    expect(regions).toEqual({ "01": { events: 6, share: 1.375 }, "02": { events: 0, share: 0 } });
    // With equal years, the rates of the states as areas are the rates of `regionRates`.
    const equal: Observation = { years: { "01001": 4, "01003": 4 }, customers: observation.customers };
    const [perYear, reach] = regionRates(counts, equal, state)["01"] ?? [0, 0];
    const own = regionRates(regionCounts(counts, equal, state), regionObservation(equal, state), (area) => area)["01"] ?? [0, 0];
    expect(own[0]).toBeCloseTo(perYear, 12);
    expect(own[1]).toBeCloseTo(reach, 12);
  });

  it("gives a state with no event a rate above 0 when the states are pooled toward the nation", () => {
    const { rates, laws } = pooledRates(regionCounts(counts, observation, state), regionObservation(observation, state), () => "nation");
    expect(laws["nation"]).toMatchObject({ areas: 2, events: 6, from: "group" });
    expect(rates["02"]?.[0]).toBeGreaterThan(0);
    // The reach of the state with no event is the reach of the one state with events: 1.375 / 6.
    expect(rates["02"]?.[1]).toBeCloseTo(1.375 / 6, 12);
  });

  it("holds the gate of the committed table: no state has a prior of 0, and the pooled rates pass the holdout in each case", () => {
    const cases = Object.keys(EAGLEI_STATE_PRIORS.rates).sort();
    for (const name of cases) for (const code of EAGLEI_STATE_PRIORS.codes) expect(EAGLEI_STATE_PRIORS.rates[name]?.[code]?.[0], `${name} ${code}`).toBeGreaterThan(0);
    expect(EAGLEI_STATE_POOLING.holdout.rounds).toBeGreaterThanOrEqual(5);
    expect(Object.keys(EAGLEI_STATE_POOLING.holdout.cases)).toEqual(cases);
    expect(Object.keys(EAGLEI_STATE_POOLING.laws).sort()).toEqual(cases);
    for (const name of cases) {
      const score = EAGLEI_STATE_POOLING.holdout.cases[name];
      // The pooled score is finite, also when a state with no event in the fit half has events in the score half. It is above the score of one rate for the nation.
      expect(Number.isFinite(score?.pooled), name).toBe(true);
      expect(score?.pooled, name).toBeGreaterThan(score?.state ?? Number.POSITIVE_INFINITY);
      // On the states with events in the fit half, the pooled score is at most 1% under the raw score. The squared error is at most 5% above the raw error.
      expect(score?.seen.pooled, name).toBeGreaterThanOrEqual(1.01 * (score?.seen.raw ?? 0));
      expect(score?.squared.pooled, name).toBeLessThanOrEqual(1.05 * (score?.squared.raw ?? 0));
    }
    // In some cases, the raw rates lose a state: it has no event in the fit half and events in the score half.
    expect(Object.values(EAGLEI_STATE_POOLING.holdout.cases).some((score) => score.raw === Number.NEGATIVE_INFINITY && score.lost > 0)).toBe(true);
  });
});

describe("the silent areas", () => {
  const observation: Observation = { years: { "99001": 3, "99003": 1, "98001": 2, "97001": 5 }, customers: { "99001": 3000, "99003": 1000, "98001": 10 } };

  it("takes the observed areas with no event in any case out of the observation, and gives the count that the laws expect", () => {
    const counts = { "case.a": { "99001": { events: 6, share: 0.6 } }, "case.b": { "98001": { events: 1, share: 0.5 } } };
    const { observation: kept, silent, expected } = withoutSilentAreas(counts, observation, state);
    expect(silent).toEqual(["99003"]);
    expect(kept).toEqual({ years: { "99001": 3, "98001": 2, "97001": 5 }, customers: { "99001": 3000, "98001": 10 } });
    // Each state has one area with events, so each law has the shape Infinity: the chance of 0 is exp(-mean * years) in each case.
    // case.a: the mean of 99 is 2 and of 98 is its pooled rate toward 99. case.b: the mean of 98 is 0.5 and of 99 is its pooled rate toward 98.
    const a = pooledRates(counts["case.a"], observation, state).laws;
    const b = pooledRates(counts["case.b"], observation, state).laws;
    const chance = (area: string, years: number) => Math.exp(-((a[state(area)]?.mean ?? 0) + (b[state(area)]?.mean ?? 0)) * years);
    expect(expected).toBeCloseTo(chance("99001", 3) + chance("99003", 1) + chance("98001", 2), 12);
    // With no silent area, the observation does not change.
    expect(withoutSilentAreas({ "case.a": { "99001": { events: 1, share: 1 }, "99003": { events: 1, share: 1 }, "98001": { events: 1, share: 1 } } }, observation, state).silent).toEqual([]);
  });

  it("holds the gate of the committed table: the laws expect at most 10% of the silent counties, so most of them are gaps of the files", () => {
    const { areas, expected } = EAGLEI_COUNTY_POOLING.silent;
    expect(areas).toBeGreaterThan(0);
    expect(expected).toBeLessThanOrEqual(0.1 * areas);
    // The sum of the absolute bias of the reach over the cases is smaller with the plain mean than with the mean over the events.
    const scores = Object.values(EAGLEI_COUNTY_POOLING.holdout.cases);
    const bias = (method: "plain" | "events") => scores.reduce((sum, score) => sum + Math.abs(score.reach[method].bias / Math.max(1, score.reach.areas)), 0);
    expect(bias("plain")).toBeLessThan(bias("events"));
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
      { case: "infra.power.outage", place: "test-county:A1", region: "test-county:A1", perYear: 2, reach: 0.25, source: "https://data.example.net/outages", asOf: "2026-02-25" },
      { case: "met.flood", place: "test-county:A1", region: "test-county:A1", perYear: 0.5, reach: 0.5, source: "https://data.example.net/outages", asOf: "2026-02-25" },
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

  it("refuses an empty scheme, a region two times, a rate that is not a pair, and two tables with the same scheme, case and region", () => {
    const prior = (tables: readonly unknown[]): string[] => checkHazards({ ...list, priors: tables as PriorTable[] }).filter((fault) => fault.code === "hazards-prior").map((fault) => fault.message);
    expect(prior([{ ...county, scheme: "" }])).toHaveLength(1);
    expect(prior([{ ...county, scheme: " test-county" }])).toHaveLength(1);
    expect(prior([{ ...county, codes: [...county.codes, county.codes[0]] }])).toHaveLength(1);
    // A table from JSON can have any shape. The gate gives a fault, and it does not throw.
    for (const rate of [1, [1], [1, 0.5, 2], null, "1,0.5", ["1", 0.5]]) expect(prior([{ ...county, rates: { "met.flood": { A1: rate } } }]), JSON.stringify(rate)).toHaveLength(1);
    expect(prior([{ ...county, rates: { "met.flood": null } }])).toHaveLength(1);
    expect(prior([{ ...county, rates: { "met.flood": [[1, 0.5]] } }])).toHaveLength(1);
    // Two tables of one scheme overlap in each case of the two and each region of the two: one fault for the pair, with the count.
    const overlap = prior([county, region, { ...county, asOf: "2026-03-01" }]);
    expect(overlap).toHaveLength(1);
    expect(overlap[0]).toContain('"priors.0" and "priors.2"');
    expect(overlap[0]).toContain("4 pairs of a case and a region");
    // Two tables of one scheme with no shared case, or no shared region, do not overlap.
    expect(prior([county, { ...county, rates: { "met.tornado": { A1: [1, 0.5] } } }])).toEqual([]);
    expect(prior([county, { ...county, codes: ["Z9"], rates: {} }])).toEqual([]);
  });
});
