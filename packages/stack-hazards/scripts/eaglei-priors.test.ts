import { describe, expect, it } from "vitest";
import { checkHazards } from "../src/check.ts";
import { HAZARDS_SCHEMA, type PriorTable } from "../src/hazard.ts";
import { EAGLE_ARTICLE, LAWS_SCHEMA, OUTAGE_CASE, type EagleLaws } from "./eaglei-fit.ts";
import { EAGLEI_SOURCE_ID } from "./eaglei-law.ts";
import { COUNTY_SCHEME, eaglePriors, priorsModule } from "./eaglei-priors.ts";

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
    tally: { counts: 0, times: 0, repeats: 0, unknown: 0, missing: 0, truncated: 0 },
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
    expect(county.rates).toEqual({ [OUTAGE_CASE]: { "99001": [3, 0.1] }, "met.tornado": { "99001": [0.3333, 0.5] } });
    expect(county.method).toContain("at or above 1% of its customers");
    expect(state).toMatchObject({ scheme: "us-state-fips", codes: ["99"] });
    // The state pools 99001 and 99003: 3 events in one year that reach 900 customers in one year, of the 4000 customers of the two counties.
    expect(state.rates[OUTAGE_CASE]?.["99"]).toEqual([3, 0.075]);
    expect(eaglePriors(record({ options: { share: 0.05, interval: 900 } })).county.method).toContain("at or above 5% of its customers");
  });

  it("passes the gate with the cases and the source of the dataset", () => {
    const { county, state } = eaglePriors(record());
    const source = { name: "EAGLE-I", url: "https://doi.org/10.0000/test.1", publisher: "A laboratory", license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" }, read: "2026-11-22" };
    const hazards = [OUTAGE_CASE, "met.tornado"].map((code) => ({ case: code, title: code, examined: [EAGLEI_SOURCE_ID], cuts: [] }));
    expect(checkHazards({ schema: HAZARDS_SCHEMA, sources: { [EAGLEI_SOURCE_ID]: source }, hazards, priors: [county, state] })).toEqual([]);
  });

  it("refuses a record with another schema, another license or no counts of the priors", () => {
    expect(() => eaglePriors(record({ schema: "other" as typeof LAWS_SCHEMA }))).toThrow(RangeError);
    expect(() => eaglePriors(record({ source: { ...record().source, license: "CC BY-NC 4.0" } }))).toThrow(RangeError);
    expect(() => eaglePriors(record({ priors: undefined }))).toThrow(RangeError);
  });
});

describe("priorsModule", () => {
  it("gives a module whose tables are the tables of the fit", () => {
    const tables = eaglePriors(record());
    const text = priorsModule(tables);
    expect(text).toContain("Do not change it by hand.");
    const script = text.replace(/^import .*$/mu, "").replaceAll(/export const (\w+): PriorTable =/gu, "out.$1 =");
    const out: Record<string, PriorTable> = {};
    // The module is plain data, so its text with no types runs as a script.
    new Function("out", script)(out);
    expect(out["EAGLEI_COUNTY_PRIORS"]).toEqual(tables.county);
    expect(out["EAGLEI_STATE_PRIORS"]).toEqual(tables.state);
  });
});
