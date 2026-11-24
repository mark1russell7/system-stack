import { curveFault } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkHazards } from "./check.ts";
import { HAZARD_SOURCES, NO_CYBER_LAW, NO_GEOMAGNETIC_LAW } from "./data.ts";
import { HAZARDS_SCHEMA } from "./hazard.ts";
import {
  OE417_ATTACK_EVENTS,
  OE417_ATTACK_LAW,
  OE417_CYBER_TERMS,
  OE417_FILES,
  OE417_LEAST_HOURS,
  OE417_SOURCE,
  OE417_SPACE_WEATHER_TERMS,
  OE417_YEARS,
  oe417AttackLaw,
  oe417Count,
  oe417Hours,
  oe417IsAttack,
  type Oe417Event,
} from "./oe417.ts";

const event = (began: string | null, restored: string | null, customers = "10"): Oe417Event => ({ year: 2020, began, restored, area: "An area", type: "Vandalism", customers, megawatts: "Unknown" });
const sum = (key: keyof (typeof OE417_YEARS)[string]): number => Object.values(OE417_YEARS).reduce((total, year) => total + year[key], 0);

describe("oe417IsAttack and oe417Count", () => {
  it("accepts a proved attack, also with a misspelled word, and refuses a suspicion, a threat or a cyber event", () => {
    for (const type of ["Vandalism", "Physcial Attack; Sabotage", "Physical Attack - Sabatoge", "- Theft", "Actual Physical Event"]) expect(oe417IsAttack(type), type).toBe(true);
    for (const type of ["Suspected Physical Attack", "Physical Attack - Suspcious Activity", "Potential Physical Attack", "- Threat of physical attack", "Cyber Event", "Severe Weather"]) expect(oe417IsAttack(type), type).toBe(false);
  });

  it("reads the first number of a count, and gives NaN with no number", () => {
    expect(oe417Count("45,000")).toBe(45_000);
    expect(oe417Count("Unknown")).toBeNaN();
  });
});

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
  it("reads the events with customers of 15 minutes or more, and censors an open event at the longest read duration", () => {
    const law = oe417AttackLaw(
      [
        event("2020-01-01T10:00", "2020-01-01T10:10"),
        event("2020-01-01T10:00", "2020-01-01T11:00"),
        event("2020-01-01T10:00", "2020-01-01T13:00"),
        event("2020-01-01T10:00", "2020-01-02T10:00", "0"),
        event("2020-01-01T10:00", "2020-01-02T10:00", "Unknown"),
        event("2020-01-01T10:00", null),
        event(null, "2020-01-01T11:00"),
      ],
      { days: [1 / 24, 2 / 24] },
    );
    expect(law.fit.count).toBe(3);
    expect(law.fit.method).toContain("1 events with no time of the restoration");
    // The open event lasts at least 3 hours, so the curve is 1/3 after 3 hours and falls to 0 at 6 hours.
    expect(law.curves["US"]).toEqual([
      [0, 1],
      [1 / 24, 2 / 3],
      [2 / 24, 2 / 3],
      [3 / 24, 1 / 3],
      [6 / 24, 0],
    ]);
  });

  it("gives a curve that gets to 0 when no event is open", () => {
    const law = oe417AttackLaw([event("2020-01-01T10:00", "2020-01-01T11:00"), event("2020-01-01T10:00", "2020-01-01T13:00")]);
    expect(law.fit.count).toBe(2);
    expect(law.curves["US"]?.at(-1)).toEqual([3 / 24, 0]);
  });

  it("refuses a set of events with no duration to read", () => {
    expect(() => oe417AttackLaw([event("2020-01-01T10:00", "2020-01-01T10:05")])).toThrow(RangeError);
    expect(() => oe417AttackLaw([event("2020-01-01T10:00", "2020-01-01T12:00", "0")])).toThrow(RangeError);
  });
});

describe("the events of a physical attack", () => {
  it("holds only the events with a loss of customers or load, of an attack and not of a suspicion", () => {
    expect(OE417_ATTACK_EVENTS).toHaveLength(112);
    for (const item of OE417_ATTACK_EVENTS) {
      expect(oe417IsAttack(item.type), item.type).toBe(true);
      expect(item.type, item.type).not.toMatch(OE417_CYBER_TERMS);
      expect(oe417Count(item.customers) > 0 || oe417Count(item.megawatts) > 0, `${item.year} ${item.area}`).toBe(true);
      expect(OE417_FILES[String(item.year)], String(item.year)).toBeDefined();
    }
  });

  it("holds each event one time", () => {
    const keys = OE417_ATTACK_EVENTS.map((item) => JSON.stringify([item.year, item.restored, item.area, item.type, item.customers, item.megawatts]));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("has the count of the events of each year that the counts of the summaries give", () => {
    expect(Object.keys(OE417_YEARS)).toEqual(Object.keys(OE417_FILES));
    for (const [year, counts] of Object.entries(OE417_YEARS)) {
      expect(OE417_ATTACK_EVENTS.filter((item) => String(item.year) === year), year).toHaveLength(counts.kept);
      expect(counts.kept, year).toBeLessThanOrEqual(counts.attacks);
      expect(counts.attacks + counts.cyber, year).toBeLessThanOrEqual(counts.rows);
    }
    expect(sum("rows")).toBe(4146);
    expect(sum("copies")).toBe(32);
  });

  it("gives the counts that the reasons of the cyberattack and the solar storm tell", () => {
    expect(NO_CYBER_LAW.reason).toContain(`list ${String(sum("cyber"))} cyber events`);
    expect(sum("cyberLoss")).toBe(1);
    expect(NO_CYBER_LAW.reason).toContain("Only one tells of a loss");
    expect(sum("spaceWeather")).toBe(0);
    expect(NO_GEOMAGNETIC_LAW.reason).toContain("list no event whose type names a geomagnetic, solar, magnetic or space weather cause");
    for (const word of ["geomagnetic", "solar", "magnetic", "space weather"]) expect(word).toMatch(OE417_SPACE_WEATHER_TERMS);
  });

  it("names the archived copy of each summary that it read", () => {
    expect(Object.keys(OE417_FILES)).toHaveLength(24);
    for (const [year, file] of Object.entries(OE417_FILES)) {
      expect(file.archive, year).toMatch(/^https:\/\/web\.archive\.org\/web\/\d{14}id_\//u);
      expect(file.archive.endsWith(file.url), year).toBe(true);
      expect(file.url, year).toContain(`ID=${file.id}`);
    }
  });

  it("gives a law of the events with customers, with the open events censored, which passes the gate", () => {
    const homes = OE417_ATTACK_EVENTS.filter((item) => oe417Count(item.customers) > 0);
    const read = homes.map(oe417Hours).filter((hours): hours is number => hours !== undefined && hours >= OE417_LEAST_HOURS);
    const open = homes.filter((item) => item.began !== null && item.restored === null);
    expect(OE417_ATTACK_LAW.fit.count).toBe(read.length + open.length);
    expect(OE417_ATTACK_LAW.fit.method).toContain(`${String(open.length)} events with no time of the restoration`);
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
