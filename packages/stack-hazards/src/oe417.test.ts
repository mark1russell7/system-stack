import { curveFault } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkHazards } from "./check.ts";
import { HAZARD_SOURCES } from "./data.ts";
import { HAZARDS_SCHEMA } from "./hazard.ts";
import { OE417_ATTACK_EVENTS, OE417_ATTACK_LAW, OE417_FILES, OE417_LEAST_HOURS, OE417_SOURCE, oe417AttackLaw, oe417Hours, type Oe417Event } from "./oe417.ts";

const event = (began: string | null, restored: string | null): Oe417Event => ({ year: 2020, began, restored, area: "An area", type: "Vandalism", customers: "10", megawatts: "Unknown" });

describe("oe417Hours", () => {
  it("gives the hours from the start to the restoration, also across a day", () => {
    expect(oe417Hours(event("2020-01-01T23:30", "2020-01-02T01:00"))).toBe(1.5);
  });

  it("gives no duration with no time of an end, or with a restoration at or before the start", () => {
    expect(oe417Hours(event(null, "2020-01-02T01:00"))).toBeUndefined();
    expect(oe417Hours(event("2020-01-01T10:00", null))).toBeUndefined();
    expect(oe417Hours(event("2020-01-01T10:00", "2020-01-01T10:00"))).toBeUndefined();
    expect(oe417Hours(event("2020-01-01T10:00", "2020-01-01T09:00"))).toBeUndefined();
  });
});

describe("oe417AttackLaw", () => {
  it("reads only the events of 15 minutes or more, with no censored event", () => {
    const law = oe417AttackLaw([event("2020-01-01T10:00", "2020-01-01T10:10"), event("2020-01-01T10:00", "2020-01-01T11:00"), event("2020-01-01T10:00", "2020-01-01T13:00"), event("2020-01-01T10:00", null)]);
    expect(law.fit.count).toBe(2);
    expect(law.curves["US"]?.at(-1)).toEqual([3 / 24, 0]);
  });

  it("refuses a set of events with no duration to read", () => {
    expect(() => oe417AttackLaw([event("2020-01-01T10:00", "2020-01-01T10:05")])).toThrow(RangeError);
  });
});

describe("the events of a physical attack", () => {
  it("holds only the events with a loss of customers or load, of an attack and not of a suspicion", () => {
    expect(OE417_ATTACK_EVENTS).toHaveLength(113);
    const count = (text: string): number => Number(text.replace(/,/gu, "").match(/\d+(\.\d+)?/u)?.[0] ?? Number.NaN);
    for (const item of OE417_ATTACK_EVENTS) {
      expect(item.type, item.type).toMatch(/physical|physcial|vandal|sabota|sabatoge|theft/iu);
      expect(item.type, item.type).not.toMatch(/suspect|suspicious|cyber/iu);
      expect(count(item.customers) > 0 || count(item.megawatts) > 0, `${item.year} ${item.area}`).toBe(true);
      expect(OE417_FILES[String(item.year)], String(item.year)).toBeDefined();
    }
  });

  it("names the archived copy of each summary that it read", () => {
    expect(Object.keys(OE417_FILES)).toHaveLength(24);
    for (const [year, file] of Object.entries(OE417_FILES)) {
      expect(file.archive, year).toMatch(/^https:\/\/web\.archive\.org\/web\/\d{14}id_\//u);
      expect(file.archive.endsWith(file.url), year).toBe(true);
      expect(file.url, year).toContain(`ID=${file.id}`);
    }
  });

  it("gives a law of the 15 minutes or more of each event with both times, which passes the gate", () => {
    const read = OE417_ATTACK_EVENTS.map(oe417Hours).filter((hours): hours is number => hours !== undefined && hours >= OE417_LEAST_HOURS);
    expect(OE417_ATTACK_LAW.fit.count).toBe(read.length);
    expect(read.length).toBeGreaterThanOrEqual(30);
    const curve = OE417_ATTACK_LAW.curves["US"];
    expect(curve).toBeDefined();
    if (curve !== undefined) expect(curveFault(curve)).toBeUndefined();
    expect(HAZARD_SOURCES["doe.oe-417"]).toBe(OE417_SOURCE);
    const faults = checkHazards({
      schema: HAZARDS_SCHEMA,
      sources: { "doe.oe-417": OE417_SOURCE },
      hazards: [
        {
          case: "infra.power.outage",
          title: "Power outage",
          examined: ["doe.oe-417"],
          cuts: [{ part: "power.grid", title: "No power", claims: [{ definition: true, says: "The case is a stop of the grid." }], duration: OE417_ATTACK_LAW }],
        },
      ],
    });
    expect(faults).toEqual([]);
  });
});
