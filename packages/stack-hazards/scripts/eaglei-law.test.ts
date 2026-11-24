import { describe, expect, it } from "vitest";
import { checkHazards } from "../src/check.ts";
import { HAZARDS_SCHEMA } from "../src/hazard.ts";
import { outageCurves } from "../src/law.ts";
import type { OutageEvent } from "../src/outages.ts";
import { EAGLE_ARTICLE, LAWS_SCHEMA, type EagleLaws } from "./eaglei-fit.ts";
import { EAGLEI_SOURCE_ID, MIN_EVENTS, STORM_EVENTS_SOURCE_ID, ZONE_COUNTY_SOURCE_ID, causeSourceId, eagleLaw, lawModule } from "./eaglei-law.ts";

// Made-up states: the codes 98 and 99 are not codes of states. The state 98 has too few events for a curve.
const event = (area: string, minutes: number, censored = false): OutageEvent => ({ area, start: 0, seconds: minutes * 60, peak: 10, censored });
const events = [
  ...Array.from({ length: MIN_EVENTS }, (_, index) => event("99001", 30 + 15 * index, index === MIN_EVENTS - 1)),
  ...Array.from({ length: MIN_EVENTS - 1 }, () => event("98001", 60)),
];

function record(change: Partial<EagleLaws["source"]> = {}): EagleLaws {
  return {
    schema: LAWS_SCHEMA,
    source: { article: EAGLE_ARTICLE, version: 4, modified: "2026-02-25T18:52:23Z", license: "CC BY 4.0", doi: "10.0000/test.1", files: [], ...change },
    read: "2026-11-22T08:00:00.000Z",
    options: { share: undefined, interval: 900 },
    scheme: "us-state-fips",
    lines: 100,
    skipped: 0,
    tally: { counts: 100, times: 50, repeats: 0, unknown: 0, missing: 0, truncated: 0, joined: 0 },
    events: events.length,
    regions: outageCurves(events, (area) => area.slice(0, 2)),
    causes: {
      storms: {
        files: [
          { name: "StormEvents_details-ftp_v1.0_d2019_c20250101.csv.gz", bytes: 10 },
          { name: "StormEvents_details-ftp_v1.0_d2020_c20260301.csv.gz", bytes: 10 },
        ],
        zones: "bp16ap26.dbx",
        lines: 20,
        skipped: 2,
        tally: { rows: 18, placed: 18, unplaced: 0, other: {} },
      },
      options: { before: 3600, after: 10_800 },
      cases: {
        "met.tornado": { types: ["Tornado"], events: events.length, regions: outageCurves(events, (area) => area.slice(0, 2)) },
        "met.flood": { types: ["Flood"], events: 3, regions: outageCurves(events.slice(0, 3), (area) => area.slice(0, 2)) },
      },
    },
  };
}

describe("eagleLaw", () => {
  it("keeps each state with enough events, and gives a law that passes the gate", () => {
    const { source, law, dropped } = eagleLaw(record());
    expect(dropped).toEqual(["98"]);
    expect(source).toMatchObject({ id: EAGLEI_SOURCE_ID, url: "https://doi.org/10.0000/test.1", license: "cc-by-4.0", terms: "https://creativecommons.org/licenses/by/4.0/", updated: "2026-02-25", checked: "2026-11-22", regions: { scheme: "us-state-fips", codes: ["99"] } });
    expect(law).toMatchObject({ source: EAGLEI_SOURCE_ID, scheme: "us-state-fips", fit: { family: "kaplan-meier", count: MIN_EVENTS } });
    expect(Object.keys(law.curves)).toEqual(["99"]);
    const faults = checkHazards({
      schema: HAZARDS_SCHEMA,
      sources: { [EAGLEI_SOURCE_ID]: source },
      hazards: [
        {
          case: "infra.power.outage",
          title: "Power outage",
          examined: [EAGLEI_SOURCE_ID],
          cuts: [{ part: "power.grid", title: "No power", claims: [{ definition: true, says: "The case is a stop of the grid." }], duration: law }],
        },
      ],
    });
    expect(faults).toEqual([]);
  });

  it("refuses another schema, another license, no DOI and a record with no state of enough events", () => {
    expect(() => eagleLaw({ ...record(), schema: "eaglei-laws/0" as typeof LAWS_SCHEMA })).toThrow(/schema/);
    expect(() => eagleLaw(record({ license: "CC BY-NC 4.0" }))).toThrow(/license/);
    expect(() => eagleLaw(record({ doi: "" }))).toThrow(/DOI/);
    expect(() => eagleLaw({ ...record(), regions: outageCurves(events.slice(MIN_EVENTS), (area) => area.slice(0, 2)) })).toThrow(/no state/);
    expect(() => eagleLaw({ ...record(), causes: undefined })).toThrow(/no causes/);
  });

  it("gives a law with its own source for each storm case with a state of enough events, and the laws pass the gate", () => {
    const { source, causes } = eagleLaw(record());
    expect(Object.keys(causes.laws)).toEqual(["met.tornado"]);
    const tornado = causes.laws["met.tornado"];
    expect(tornado?.id).toBe(causeSourceId("met.tornado"));
    expect(tornado?.source).toMatchObject({ id: tornado?.id, url: source.url, license: source.license, terms: source.terms, checked: "2026-11-22", regions: { scheme: "us-state-fips", codes: ["99"] } });
    expect(tornado?.law).toMatchObject({ source: "eaglei.met.tornado", fit: { family: "kaplan-meier", count: MIN_EVENTS } });
    expect(tornado?.law.fit.method).toContain("from 1 hour before to 3 hours after a storm event of the case");
    expect(causes.storms).toMatchObject({ id: STORM_EVENTS_SOURCE_ID, by: "NOAA National Centers for Environmental Information", license: "us-public-domain", updated: "2026-03-01", checked: "2026-11-22" });
    expect(causes.zones).toMatchObject({ id: ZONE_COUNTY_SOURCE_ID, url: "https://www.weather.gov/source/gis/Shapefiles/County/bp16ap26.dbx", license: "us-public-domain", checked: "2026-11-22" });
    const faults = checkHazards({
      schema: HAZARDS_SCHEMA,
      sources: { [EAGLEI_SOURCE_ID]: source, [STORM_EVENTS_SOURCE_ID]: causes.storms, [ZONE_COUNTY_SOURCE_ID]: causes.zones, ...(tornado === undefined ? {} : { [tornado.id]: tornado.source }) },
      hazards: [
        {
          case: "met.tornado",
          title: "Tornado",
          examined: [EAGLEI_SOURCE_ID, STORM_EVENTS_SOURCE_ID, ZONE_COUNTY_SOURCE_ID],
          cuts: [{ part: "power.grid", title: "No power", claims: [{ definition: true, says: "The case cuts the grid." }], duration: tornado?.law ?? { read: false, reason: "none" } }],
        },
      ],
    });
    expect(faults).toEqual([]);
  });
});

describe("lawModule", () => {
  it("gives a module whose source and curves read back to the same values", () => {
    const result = eagleLaw(record());
    const text = lawModule(result);
    const source = /export const EAGLEI_SOURCE: HazardSource = (\{[\s\S]*?\n\});/u.exec(text)?.[1] ?? "";
    expect(JSON.parse(source)).toEqual(result.source);
    const curves = text.split("\n").flatMap((line) => {
      const match = /^ {4}("\d+"): (.*),$/u.exec(line);
      return match === null ? [] : [[JSON.parse(match[1] ?? "") as string, JSON.parse(match[2] ?? "") as unknown]];
    });
    expect(Object.fromEntries(curves)).toEqual(result.law.curves);
    expect(text).toContain(`fit: ${JSON.stringify(result.law.fit)},`);
    const tornado = result.causes.laws["met.tornado"];
    expect(text).toContain('  "eaglei.met.tornado": {');
    expect(text).toContain('    "codes": ["99"]');
    expect(text).toContain(`    fit: ${JSON.stringify(tornado?.law.fit)},`);
    expect(text).toContain(`      "99": ${JSON.stringify(tornado?.law.curves["99"])},`);
    const storms = /export const STORM_EVENTS_SOURCE: HazardSource = (\{[\s\S]*?\n\});/u.exec(text)?.[1] ?? "";
    expect(JSON.parse(storms)).toEqual(result.causes.storms);
    expect(text).not.toContain("met.flood");
  });
});
