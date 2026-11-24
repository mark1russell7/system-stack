import { describe, expect, it } from "vitest";
import { checkHazards } from "../src/check.ts";
import { HAZARDS_SCHEMA, type CountyPooling, type HazardSource, type PriorTable } from "../src/hazard.ts";
import { EAGLE_ARTICLE, LAWS_SCHEMA, OUTAGE_CASE, type EagleLaws } from "./eaglei-fit.ts";
import { EAGLEI_SOURCE_ID } from "./eaglei-law.ts";
import { POOL_HOLDOUT_SEED } from "./eaglei-pooling.ts";
import { COUNTY_SCHEME, eaglePriors, PRIOR_LIMIT, priorModules } from "./eaglei-priors.ts";

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
    expect(county).toMatchObject({ source: EAGLEI_SOURCE_ID, asOf: "2026-02-25", scheme: COUNTY_SCHEME, codes: ["99001", "99003"] });
    // The county 99003 has no event, so its pooled rate comes from the law of its state. Its reach is the mean reach of the events of its state.
    expect(county.rates).toEqual({ [OUTAGE_CASE]: { "99001": [2.899, 0.1], "99003": [0.1011, 0.1] }, "met.tornado": { "99001": [0.1667, 0.5], "99003": [0.1667, 0.5] } });
    expect(county.method).toContain("perYear is the pooled rate of a county toward the counties of its state");
    expect(county.method).toContain("at or above 1% of its customers");
    expect(state).toMatchObject({ scheme: "us-state-fips", codes: ["99"] });
    // The state pools 99001 and 99003: 3 events in one year that reach 900 customers in one year, of the 4000 customers of the two counties.
    expect(state.rates[OUTAGE_CASE]?.["99"]).toEqual([3, 0.075]);
    expect(eaglePriors(record({ options: { share: 0.05, interval: 900 } })).county.method).toContain("at or above 5% of its customers");
    expect(county.method).toContain("storm events of NOAA. A region");
    expect(county.method).not.toContain("too few customers");
    // With the option raise, the method tells that the customers of some counties come from their counts.
    const raised = eaglePriors(record({ options: { share: 0.01, interval: 900, raise: true }, raised: { "99001": { file: 10, fit: 40 } }, peaks: { "99001": { peak: 50, held: 40, over: 9, days: 5 } } }));
    expect(raised.county.method).toContain("storm events of NOAA. The file of the customers gives too few customers to some counties. For 1 counties, the customers are the count that the county reached on 4 different days. A region");
    expect(raised.state.method).toContain("For 1 counties");
  });

  it("passes the gate with the cases and the source of the dataset", () => {
    const { county, state } = eaglePriors(record());
    const source: HazardSource = { id: EAGLEI_SOURCE_ID, title: "EAGLE-I", url: "https://doi.org/10.0000/test.1", by: "A laboratory", license: "cc-by-4.0", terms: "https://creativecommons.org/licenses/by/4.0/", checked: "2026-11-22" };
    const hazards = [OUTAGE_CASE, "met.tornado"].map((code) => ({ case: code, title: code, examined: [EAGLEI_SOURCE_ID], cuts: [] }));
    expect(checkHazards({ schema: HAZARDS_SCHEMA, sources: { [EAGLEI_SOURCE_ID]: source }, hazards, priors: [county, state] })).toEqual([]);
  });

  it("leaves out a region with more than the limit of events at one customer in one year, so its prior is no read", () => {
    // 99001 has 40 events a year that each reach the county: more than the limit of 12.
    const over = record({ priors: { ...record().priors!, counts: { [OUTAGE_CASE]: { "99001": { events: 120, share: 120 } } } } });
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
      const script = text.replaceAll(/^import .*$/gmu, "").replaceAll(/export const (\w+)(?:: \w+)? =/gu, "out.$1 =");
      // The module is plain data, so its text with no types runs as a script.
      new Function("out", script)(out);
    }
    expect(out["EAGLEI_COUNTY_PRIORS"]).toEqual(tables.county);
    expect(out["EAGLEI_STATE_PRIORS"]).toEqual(tables.state);
    expect(out["EAGLEI_NATION_CUSTOMERS"]).toBe(tables.nation);
    // The pooling keeps the shape Infinity of a law with no spread, and 4 digits of each law.
    const pooling = out["EAGLEI_COUNTY_POOLING"] as unknown as CountyPooling;
    expect(pooling.laws["met.tornado"]?.["99"]).toEqual({ shape: Number.POSITIVE_INFINITY, mean: 0.1667, areas: 2, events: 1, from: "group" });
    expect(pooling.laws[OUTAGE_CASE]?.["99"]).toEqual({ shape: 0.3252, mean: 1.5, areas: 2, events: 9, from: "group" });
    expect(pooling.holdout).toMatchObject({ seed: POOL_HOLDOUT_SEED, rounds: 5 });
    expect(Object.keys(pooling.holdout.cases)).toEqual(["infra.power.outage", "met.tornado"]);
    expect(tables.nation).toBe(4000);
  });
});
