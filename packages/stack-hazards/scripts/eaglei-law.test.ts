import { describe, expect, it } from "vitest";
import { checkHazards } from "../src/check.ts";
import { HAZARDS_SCHEMA } from "../src/hazard.ts";
import { outageCurves } from "../src/law.ts";
import type { OutageEvent } from "../src/outages.ts";
import { EAGLE_ARTICLE, LAWS_SCHEMA, type EagleLaws } from "./eaglei-fit.ts";
import { EAGLEI_SOURCE_ID, MIN_EVENTS, eagleLaw, lawModule } from "./eaglei-law.ts";

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
    tally: { counts: 100, times: 50, repeats: 0, unknown: 0, missing: 0, truncated: 0 },
    events: events.length,
    regions: outageCurves(events, (area) => area.slice(0, 2)),
  };
}

describe("eagleLaw", () => {
  it("keeps each state with enough events, and gives a law that passes the gate", () => {
    const { source, law, dropped } = eagleLaw(record());
    expect(dropped).toEqual(["98"]);
    expect(source).toMatchObject({ url: "https://doi.org/10.0000/test.1", updated: "2026-02-25", read: "2026-11-22", regions: { scheme: "us-state-fips", codes: ["99"] } });
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
  });
});

describe("lawModule", () => {
  it("gives a module whose source and curves read back to the same values", () => {
    const result = eagleLaw(record());
    const text = lawModule(result);
    const source = /export const EAGLEI_SOURCE: Source = (\{[\s\S]*?\n\});/u.exec(text)?.[1] ?? "";
    expect(JSON.parse(source)).toEqual(result.source);
    const curves = text.split("\n").flatMap((line) => {
      const match = /^ {4}("\d+"): (.*),$/u.exec(line);
      return match === null ? [] : [[JSON.parse(match[1] ?? "") as string, JSON.parse(match[2] ?? "") as unknown]];
    });
    expect(Object.fromEntries(curves)).toEqual(result.law.curves);
    expect(text).toContain(`fit: ${JSON.stringify(result.law.fit)},`);
  });
});
