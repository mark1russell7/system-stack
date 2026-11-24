import { curveFault } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkHazards } from "./check.ts";
import { HAZARD_LIST, HAZARD_SOURCES, NO_CYBER_LAW, NO_GEOMAGNETIC_LAW } from "./data.ts";
import { EAGLEI_NATION_CUSTOMERS } from "./eaglei-state-priors.ts";
import { HAZARDS_SCHEMA } from "./hazard.ts";
import { hazardPriors } from "./priors.ts";
import {
  OE417_ATTACK_EVENTS,
  OE417_ATTACK_CASE,
  OE417_ATTACK_LAW,
  OE417_NATION_PRIORS,
  OE417_PRIOR_FIRST,
  oe417AttackPrior,
  oe417LawEvents,
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

describe("the prior of a physical attack", () => {
  it("counts the events of the law in 2015 to 2023 over the customers of the nation", () => {
    const events = oe417LawEvents(OE417_ATTACK_EVENTS);
    // The law reads 70 events: 62 ends of 15 minutes or more and 8 open events.
    expect(events).toHaveLength(70);
    expect(OE417_ATTACK_LAW.read && OE417_ATTACK_LAW.fit.count).toBe(70);
    // The yearly counts of 2011 to 2023. The window of the prior is the longest window to 2023 that a dispersion test at 5% does not refuse.
    // A new summary changes these counts. Then calculate the window again. A dispersion test of rigor-statistics can make this a gate.
    const counts = Array.from({ length: 13 }, (_, i) => events.filter((event) => event.year === 2011 + i).length);
    expect(counts).toEqual([1, 0, 3, 0, 4, 6, 6, 5, 8, 8, 7, 14, 8]);
    expect(OE417_PRIOR_FIRST).toBe(2015);
    const kept = events.filter((event) => event.year >= OE417_PRIOR_FIRST);
    expect(kept).toHaveLength(66);
    const customers = kept.reduce((sum, event) => sum + oe417Count(event.customers), 0);
    expect(OE417_NATION_PRIORS).toMatchObject({ source: "doe.oe-417", asOf: "2023-12-31", scheme: "us-nation", codes: ["US"] });
    const [perYear, reach] = OE417_NATION_PRIORS.rates[OE417_ATTACK_CASE]?.["US"] ?? [Number.NaN, Number.NaN];
    expect(perYear).toBeCloseTo(66 / 9, 12);
    expect(reach).toBeCloseTo(customers / 66 / EAGLEI_NATION_CUSTOMERS, 15);
    // One customer in the nation has an event once in 2,000 to 4,000 years.
    expect(1 / (perYear * reach)).toBeGreaterThan(2000);
    expect(1 / (perYear * reach)).toBeLessThan(4000);
    expect(EAGLEI_NATION_CUSTOMERS).toBeGreaterThan(140_000_000);
    expect(EAGLEI_NATION_CUSTOMERS).toBeLessThan(170_000_000);
    expect(OE417_NATION_PRIORS.method).toContain("each observed county of EAGLE-I");
  });

  it("gives the prior of the nation to a user with a region of the scheme us-nation, and no prior without it", () => {
    const priors = hazardPriors(HAZARD_LIST, { region: [{ scheme: "us-state-fips", code: "01" }, { scheme: "us-nation", code: "US" }] });
    const attack = priors.find((prior) => prior.case === OE417_ATTACK_CASE);
    expect(attack).toMatchObject({ place: "us-nation:US", perYear: 66 / 9, source: OE417_SOURCE.url, asOf: "2023-12-31" });
    // The state table has no attack case, so the outage prior still comes from the state.
    expect(priors.find((prior) => prior.case === "infra.power.outage")?.place).toBe("us-state-fips:01");
    expect(hazardPriors(HAZARD_LIST, { region: { scheme: "us-state-fips", code: "01" } }).some((prior) => prior.case === OE417_ATTACK_CASE)).toBe(false);
    expect(checkHazards(HAZARD_LIST).filter((fault) => fault.code === "hazards-prior")).toEqual([]);
  });

  it("reads only the years of the option, and refuses bad years, bad customers and years with no event", () => {
    const one = oe417AttackPrior(OE417_ATTACK_EVENTS, { first: 2022, last: 2022, customers: 1_000_000 });
    const in2022 = oe417LawEvents(OE417_ATTACK_EVENTS).filter((event) => event.year === 2022);
    expect(one.rates[OE417_ATTACK_CASE]?.["US"]?.[0]).toBe(in2022.length);
    // The method tells only what the function calculates: with no note, it names no source of the customers and no reason for the years.
    expect(one.method).toContain("over 1000000 customers of the nation. An event with no count of customers is not in the count, and that makes the rate too low.");
    expect(one.method).not.toContain("EAGLE-I");
    expect(one.method.endsWith("too low.")).toBe(true);
    expect(oe417AttackPrior(OE417_ATTACK_EVENTS, { first: 2022, last: 2022, customers: 1, note: "A note." }).method.endsWith("too low. A note.")).toBe(true);
    expect(() => oe417AttackPrior(OE417_ATTACK_EVENTS, { first: 2023, last: 2011, customers: 1 })).toThrow(RangeError);
    expect(() => oe417AttackPrior(OE417_ATTACK_EVENTS, { first: 2011.5, last: 2023, customers: 1 })).toThrow(RangeError);
    expect(() => oe417AttackPrior(OE417_ATTACK_EVENTS, { first: 2011, last: 2023, customers: 0 })).toThrow(RangeError);
    expect(() => oe417AttackPrior(OE417_ATTACK_EVENTS, { first: 2000, last: 2010, customers: 1 })).toThrow(RangeError);
  });
});
