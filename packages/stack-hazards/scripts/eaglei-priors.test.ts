import { describe, expect, it } from "vitest";
import { checkHazards } from "../src/check.ts";
import { eagleRegion } from "../src/eaglei.ts";
import { HAZARDS_SCHEMA, type AreaUnits, type CountyPooling, type HazardSource, type PriorTable, type StatePooling } from "../src/hazard.ts";
import { pooledTable, PRIOR_LEVEL } from "../src/priors.ts";
import { EAGLE_ARTICLE, LAWS_SCHEMA, OUTAGE_CASE, type EagleLaws } from "./eaglei-fit.ts";
import { EAGLEI_SOURCE_ID } from "./eaglei-law.ts";
import { POOL_HOLDOUT_SEED } from "./eaglei-pooling.ts";
import { COUNTY_SCHEME, eaglePriors, PRIOR_LIMIT, priorModules } from "./eaglei-priors.ts";

/**
 * This function runs the text of a made module, and puts each export in `out`. The module is data and one call of `pooledTable`.
 * Thus its text with no types runs as a script, with the imports as parameters.
 */
function runModule(text: string, out: Record<string, unknown>): void {
  const script = text.replaceAll(/^import .*$/gmu, "").replaceAll(/export const (\w+)(?:: [^=]+)? =/gu, "const $1 = out.$1 =");
  new Function("out", "pooledTable", "eagleRegion", "PRIOR_LIMIT", "PRIOR_LEVEL", script)(out, pooledTable, eagleRegion, PRIOR_LIMIT, PRIOR_LEVEL);
}

// Made-up counties of the made-up states 98 and 99. The county 99003 has no event, and the county 98001 has no customers.
function record(change: Partial<EagleLaws> = {}): EagleLaws {
  return {
    schema: LAWS_SCHEMA,
    source: { article: EAGLE_ARTICLE, version: 4, modified: "2026-02-25T18:52:23Z", license: "CC BY 4.0", doi: "10.0000/test.1", files: [] },
    read: "2026-11-22T08:00:00.000Z",
    options: { share: undefined, interval: 900 },
    scheme: "us-state-fips",
    lines: 0,
    skipped: 0,
    tally: { counts: 0, times: 0, repeats: 0, unknown: 0, missing: 0, truncated: 0, joined: 0 },
    events: 0,
    regions: {},
    priors: {
      observation: { years: { "99001": 3, "99003": 3, "98001": 2 }, customers: { "99001": 3000, "99003": 1000 } },
      counts: { [OUTAGE_CASE]: { "99001": { events: 9, share: 0.9 } }, "met.tornado": { "99001": { events: 1, share: 0.5 } } },
    },
    ...change,
  };
}

describe("eaglePriors", () => {
  it("gives a table of the counties and a table of the states, with the observed regions and the rates", () => {
    const { county, state } = eaglePriors(record());
    // The county 99003 has no event in any case, so it is not observed: the prior of its state applies to it.
    expect(county).toMatchObject({ source: EAGLEI_SOURCE_ID, asOf: "2026-02-25", scheme: COUNTY_SCHEME, codes: ["99001"] });
    expect(county.rates).toEqual({ [OUTAGE_CASE]: { "99001": [3, 0.1] }, "met.tornado": { "99001": [0.3333, 0.5] } });
    expect(county.method).toContain("A county with no event in any case is not observed, so the prior of its state applies: 1 counties. The laws of the states expect 0.50 such counties");
    expect(county.method).toContain("perYear is the pooled rate of a county toward the counties of its state");
    expect(county.method).toContain("at or above 1% of its customers");
    expect(state).toMatchObject({ scheme: "us-state-fips", codes: ["99"] });
    expect(state.method).toContain("perYear is the pooled rate of a state toward the states of the nation");
    // The state has the observed county 99001: 3 events in one year that reach 900 customers in one year, of its 3000 customers.
    expect(state.rates[OUTAGE_CASE]?.["99"]).toEqual([3, 0.1]);
    expect(eaglePriors(record({ options: { share: 0.05, interval: 900 } })).county.method).toContain("at or above 5% of its customers");
    expect(county.method).toContain("has no event too. A region");
    expect(county.method).not.toContain("too few customers");
    // With the option raise, the method tells that the customers of some counties come from their counts.
    const raised = eaglePriors(record({ options: { share: 0.01, interval: 900, raise: true }, raised: { "99001": { file: 10, fit: 40 } }, peaks: { "99001": { peak: 50, held: 40, over: 9, days: 5 } } }));
    expect(raised.county.method).toContain("one storm case do not overlap. The file of the customers gives too few customers to some counties. For 1 counties, the customers are the count that the county reached on 4 different days. A county with no event");
    expect(raised.state.method).toContain("For 1 counties");
  });

  it("tells in the method that the storm cases overlap, with the count of the fit when the record has it", () => {
    const plain = eaglePriors(record());
    for (const table of [plain.county, plain.state]) {
      expect(table.method).toContain(`a sum of the priors of the storm cases counts it two times or more. The case ${OUTAGE_CASE} and one storm case do not overlap.`);
    }
    const base = record().priors;
    if (base === undefined) throw new Error("The record has no priors.");
    const counted = eaglePriors(record({ priors: { ...base, overlap: { events: 5, multiple: 2 } } }));
    expect(counted.county.method).toContain("counts it two times or more. In the fit, 2 of the 5 outages in a storm case are in two cases or more. The case");
    expect(counted.state.method).toContain("2 of the 5 outages");
    // The overlap changes the method only, not the rates.
    expect(counted.county.rates).toEqual(plain.county.rates);
  });

  it("passes the gate with the cases and the source of the dataset", () => {
    const { county, state } = eaglePriors(record());
    const source: HazardSource = { id: EAGLEI_SOURCE_ID, title: "EAGLE-I", url: "https://doi.org/10.0000/test.1", by: "A laboratory", license: "cc-by-4.0", terms: "https://creativecommons.org/licenses/by/4.0/", checked: "2026-11-22" };
    const hazards = [OUTAGE_CASE, "met.tornado"].map((code) => ({ case: code, title: code, examined: [EAGLEI_SOURCE_ID], cuts: [] }));
    expect(checkHazards({ schema: HAZARDS_SCHEMA, sources: { [EAGLEI_SOURCE_ID]: source }, hazards, priors: [county, state] })).toEqual([]);
  });

  it("leaves out a region with more than the limit of events at one customer in one year, so its prior is no read", () => {
    // 99001 has 40 events a year that each reach the county: more than the limit of 12. 99003 has one tornado, so it is observed.
    const over = record({ priors: { ...record().priors!, counts: { [OUTAGE_CASE]: { "99001": { events: 120, share: 120 } }, "met.tornado": { "99003": { events: 1, share: 0.25 } } } } });
    const { county, nation } = eaglePriors(over);
    expect(county.codes).toEqual(["99003"]);
    // The customers of the nation keep each observed county, also the county over the limit.
    expect(nation).toBe(4000);
    expect(Object.keys(county.rates[OUTAGE_CASE] ?? {})).toEqual(["99003"]);
    expect(county.method).toContain(`more than ${String(PRIOR_LIMIT)} events at one customer in one year in a case is not in the table, so its prior is no read: 1 regions.`);
  });

  it("refuses a record with another schema, another license, no counts of the priors or raised counties of the old rule", () => {
    expect(() => eaglePriors(record({ schema: "other" as typeof LAWS_SCHEMA }))).toThrow(RangeError);
    expect(() => eaglePriors(record({ source: { ...record().source, license: "CC BY-NC 4.0" } }))).toThrow(RangeError);
    expect(() => eaglePriors(record({ priors: undefined }))).toThrow(RangeError);
    // A record of the rule of 4 readings: raised counties, and peaks with no days.
    const raised = { "99001": { file: 10, fit: 40 } };
    expect(() => eaglePriors(record({ raised, peaks: { "99001": { peak: 50, held: 40, over: 6 } } }))).toThrow(/no days in its peaks/u);
    expect(() => eaglePriors(record({ raised }))).toThrow(/no days in its peaks/u);
    // A record with no raised counties and old peaks is a fit with no option raise: its tables do not change.
    expect(() => eaglePriors(record({ peaks: { "99001": { peak: 50, held: 40, over: 6 } } }))).not.toThrow();
  });
});

describe("priorModules", () => {
  it("gives two modules whose tables are the tables of the fit, with the run, the dataset and the options in the header", () => {
    const tables = eaglePriors(record());
    const modules = priorModules(tables, record(), "https://example.org/runs/1 attempt 3");
    const out: Record<string, PriorTable> = {};
    for (const text of Object.values(modules)) {
      expect(text).toContain("Do not change it by hand.");
      expect(text).toContain("// The run of the fit: https://example.org/runs/1 attempt 3.");
      expect(text).toContain("EAGLE-I version 4, modified 2026-02-25T18:52:23Z, DOI 10.0000/test.1");
      expect(text).toContain("share 0.01, interval 900 s");
      runModule(text, out);
    }
    // The county module keeps the counts, the laws and the reach. Its table is made from them at the import.
    // The import also gives the interval of each rate (PRIOR_LEVEL). The law of each state of the record has no spread, so each interval is one point at its rate.
    const madeCounty = out["EAGLEI_COUNTY_PRIORS"] as PriorTable;
    expect({ ...madeCounty, intervals: undefined }).toEqual({ ...tables.county, intervals: undefined });
    expect(madeCounty.intervals?.level).toBe(PRIOR_LEVEL);
    for (const [name, rates] of Object.entries(madeCounty.rates)) {
      expect(madeCounty.intervals?.rates[name]).toEqual(Object.fromEntries(Object.entries(rates).map(([code, [perYear]]) => [code, [perYear, perYear]])));
    }
    expect(out["EAGLEI_COUNTY_COUNTS"] as unknown as AreaUnits).toEqual(tables.counts);
    // The reach of 99001: 3 events in one year that reach 900 customers in one year, of its 3000 customers. The tornado reaches half of it.
    expect(out["EAGLEI_COUNTY_REACH"]).toEqual({ [OUTAGE_CASE]: [0.1], "met.tornado": [0.5] });
    expect(modules["eaglei-county-priors.ts"]).not.toContain("rates: {");
    expect(out["EAGLEI_STATE_PRIORS"]).toEqual(tables.state);
    expect(out["EAGLEI_NATION_CUSTOMERS"]).toBe(tables.nation);
    // The pooling of the states has the one law of the nation in each case, and its holdout.
    const statePooling = out["EAGLEI_STATE_POOLING"] as unknown as StatePooling;
    expect(statePooling.laws[OUTAGE_CASE]).toEqual({ shape: Number.POSITIVE_INFINITY, mean: 3, areas: 1, events: 9, from: "group" });
    expect(statePooling.holdout).toMatchObject({ seed: POOL_HOLDOUT_SEED, rounds: 5 });
    expect(Object.keys(statePooling.holdout.cases)).toEqual(["infra.power.outage", "met.tornado"]);
    // The pooling keeps the shape Infinity of a law with no spread, and 4 digits of each law.
    const pooling = out["EAGLEI_COUNTY_POOLING"] as unknown as CountyPooling;
    expect(pooling.laws["met.tornado"]?.["99"]).toEqual({ shape: Number.POSITIVE_INFINITY, mean: 0.3333, areas: 1, events: 1, from: "group" });
    expect(pooling.laws[OUTAGE_CASE]?.["99"]).toEqual({ shape: Number.POSITIVE_INFINITY, mean: 3, areas: 1, events: 9, from: "group" });
    // The silent county 99003 is not in the laws. The laws of the full observation expect 0.5046 silent counties.
    expect(pooling.silent).toEqual({ areas: 1, expected: 0.5046 });
    expect(pooling.holdout).toMatchObject({ seed: POOL_HOLDOUT_SEED, rounds: 5 });
    expect(Object.keys(pooling.holdout.cases)).toEqual(["infra.power.outage", "met.tornado"]);
    // The silent county 99003 is not observed, so its customers are not in the nation.
    expect(tables.nation).toBe(3000);
    // A record with no counts of each year has no holdout over time.
    expect(pooling.time).toBeUndefined();
    expect(statePooling.time).toBeUndefined();
  });

  it("gives the holdout over time of the counties and of the states when the record has the counts of each year", () => {
    const base = record().priors;
    if (base === undefined) throw new Error("The record has no priors.");
    const yearly = { observed: { "99001": [2020, 2021, 2022], "99003": [2020, 2021, 2022] }, counts: { [OUTAGE_CASE]: { "2020": { "99001": 2 }, "2021": { "99001": 3 }, "2022": { "99001": 4 } }, "met.tornado": { "2022": { "99001": 1 } } } };
    const laws = record({ priors: { ...base, yearly } });
    const tables = eaglePriors(laws);
    // The silent county 99003 is not observed, so only 99001 is in the holdout. The fit part has 2020 and 2021.
    expect(tables.pooling.time).toMatchObject({ fit: [2020, 2021], score: [2022, 2022], areas: 1 });
    expect(tables.statePooling.time).toMatchObject({ fit: [2020, 2021], score: [2022, 2022], areas: 1 });
    // The raw rate of 99001 is 5 / 2 a year, so its squared error in 2022 is (4 - 2.5)^2.
    expect(tables.pooling.time?.cases[OUTAGE_CASE]?.squared.raw).toBeCloseTo(2.25, 12);
    // The tornado has no event in the fit part, so the raw rate loses 99001.
    expect(tables.pooling.time?.cases["met.tornado"]).toMatchObject({ raw: Number.NEGATIVE_INFINITY, lost: 1 });
    const out: Record<string, unknown> = {};
    for (const text of Object.values(priorModules(tables, laws, "https://example.org/runs/1 attempt 1"))) {
      runModule(text, out);
    }
    const pooling = out["EAGLEI_COUNTY_POOLING"] as CountyPooling;
    expect(pooling.time?.cases[OUTAGE_CASE]?.squared.raw).toBe(2.3);
    expect((out["EAGLEI_STATE_POOLING"] as StatePooling).time?.areas).toBe(1);
  });
});
