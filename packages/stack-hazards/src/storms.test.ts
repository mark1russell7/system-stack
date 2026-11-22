import { describe, expect, it } from "vitest";
import { STORM_CLASSES, stormCauses, stormLine, zoneCounties, type StormRow } from "./storms.ts";

// Made-up rows on the codes of Kansas: the county 20173, and the zone 20083 with the counties 20079 and 20173.
const HEADER = "BEGIN_YEARMONTH,BEGIN_DAY,BEGIN_TIME,END_YEARMONTH,END_DAY,END_TIME,EPISODE_ID,EVENT_ID,STATE,STATE_FIPS,YEAR,MONTH_NAME,EVENT_TYPE,CZ_TYPE,CZ_FIPS,CZ_NAME,WFO,BEGIN_DATE_TIME,CZ_TIMEZONE,END_DATE_TIME,EVENT_NARRATIVE";
const row = (begin: string, end: string, type: string, kind: string, cz: number, zone: string, name = "TEST"): string => {
  const [bm, bd, bt] = begin.split(" ");
  const [em, ed, et] = end.split(" ");
  return `${String(bm)},${String(bd)},${String(bt)},${String(em)},${String(ed)},${String(et)},1,2,"KANSAS",20,2023,"September","${type}","${kind}",${String(cz)},"${name}","ICT","x","${zone}","x","A narrative, with a comma"`;
};
const at = (text: string): number => Date.parse(text) / 1000;
const ZONES = "KS|083|ICT|Test Zone|KS083|Test|20079|C|sc|37.6|-97.3\nKS|083|ICT|Test Zone|KS083|Test|20173|C|sc|37.6|-97.3\nbroken|line\n";

describe("stormLine", () => {
  it("reads a row of a county, and gives each time in UTC from the offset of the row", () => {
    expect(stormLine(row("202309 9 1400", "202309 9 1530", "Tornado", "C", 173, "CST-6"))).toEqual({
      type: "Tornado",
      kind: "C",
      area: "20173",
      begin: at("2023-09-09T20:00:00Z"),
      end: at("2023-09-09T21:30:00Z"),
    });
  });

  it("reads a row of a zone with a comma and a doubled quote in a name, and the offset of daylight time", () => {
    const line = row("202301 31 5", "202302 1 2359", "Winter Storm", "Z", 83, "PDT-7", 'A ""B"", C');
    expect(stormLine(line)).toMatchObject({ kind: "Z", area: "20083", begin: at("2023-01-31T07:05:00Z"), end: at("2023-02-02T06:59:00Z") });
  });

  it("gives undefined for the header, a part of a broken line and a wrong field", () => {
    expect(stormLine(HEADER)).toBeUndefined();
    expect(stormLine('the rest of a narrative", "0"')).toBeUndefined();
    expect(stormLine(row("202302 30 1200", "202302 30 1300", "Tornado", "C", 173, "CST-6"))).toBeUndefined();
    expect(stormLine(row("202309 9 1400", "202309 9 1300", "Tornado", "C", 173, "CST-6"))).toBeUndefined();
    expect(stormLine(row("202309 9 2460", "202309 9 2460", "Tornado", "C", 173, "CST-6"))).toBeUndefined();
    expect(stormLine(row("202309 9 1400", "202309 9 1500", "Tornado", "C", 173, "CST"))).toBeUndefined();
    expect(stormLine(row("202309 9 1400", "202309 9 1500", "Tornado", "X", 173, "CST-6"))).toBeUndefined();
    expect(stormLine(row("202309 9 1400", "202309 9 1500", "", "C", 173, "CST-6"))).toBeUndefined();
  });
});

describe("zoneCounties", () => {
  it("gives the counties of each zone by the codes of the state and the zone, and skips a broken line", () => {
    expect(zoneCounties(ZONES)).toEqual(new Map([["20083", ["20079", "20173"]]]));
  });
});

describe("stormCauses", () => {
  const winter: StormRow = { type: "Winter Storm", kind: "Z", area: "20083", begin: at("2023-01-10T00:00:00Z"), end: at("2023-01-12T00:00:00Z") };
  const tornado: StormRow = { type: "Tornado", kind: "C", area: "20173", begin: at("2023-01-11T18:00:00Z"), end: at("2023-01-11T18:10:00Z") };

  it("gives the cases of the storm events that cover the county of an outage at its start, in the order of the table", () => {
    const index = stormCauses(STORM_CLASSES, zoneCounties(ZONES));
    for (const one of [winter, tornado]) index.add(one);
    index.add({ type: "Hail", kind: "C", area: "20173", begin: 0, end: 0 });
    index.add({ type: "Tornado", kind: "M", area: "20555", begin: 0, end: 0 });
    index.add({ type: "Heat", kind: "Z", area: "20999", begin: 0, end: 0 });
    expect(index.causes({ area: "20079", start: at("2023-01-11T18:05:00Z") })).toEqual(["met.winter.storm"]);
    expect(index.causes({ area: "20173", start: at("2023-01-11T18:05:00Z") })).toEqual(["met.winter.storm", "met.tornado"]);
    expect(index.causes({ area: "20173", start: at("2023-01-09T23:30:00Z") })).toEqual(["met.winter.storm"]);
    expect(index.causes({ area: "20173", start: at("2023-01-12T02:59:00Z") })).toEqual(["met.winter.storm"]);
    expect(index.causes({ area: "20173", start: at("2023-01-12T03:01:00Z") })).toEqual([]);
    expect(index.causes({ area: "20173", start: at("2023-01-09T22:59:00Z") })).toEqual([]);
    expect(index.causes({ area: "20001", start: at("2023-01-11T00:00:00Z") })).toEqual([]);
    expect(index.tally()).toEqual({ rows: 5, placed: 2, unplaced: 2, other: { Hail: 1 } });
  });

  it("finds a long storm event before many short events of the same county", () => {
    const index = stormCauses(STORM_CLASSES, new Map());
    index.add({ type: "Excessive Heat", kind: "C", area: "20173", begin: at("2023-07-01T00:00:00Z"), end: at("2023-07-06T00:00:00Z") });
    for (let day = 2; day <= 5; day += 1) index.add({ type: "Tornado", kind: "C", area: "20173", begin: at(`2023-07-0${String(day)}T12:00:00Z`), end: at(`2023-07-0${String(day)}T12:05:00Z`) });
    expect(index.causes({ area: "20173", start: at("2023-07-05T20:00:00Z") })).toEqual(["met.heat.extreme"]);
    expect(index.causes({ area: "20173", start: at("2023-07-05T13:00:00Z") })).toEqual(["met.heat.extreme", "met.tornado"]);
  });

  it("refuses a negative margin and a type in two cases", () => {
    expect(() => stormCauses(STORM_CLASSES, new Map(), { after: -1 })).toThrow(RangeError);
    expect(() => stormCauses({ one: ["Tornado"], two: ["Tornado"] }, new Map())).toThrow(/two cases/);
  });
});
