import { kaplanMeier } from "@mark1russell7/rigor-statistics";
import { bandFault, curveFault } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkHazards } from "./check.ts";
import { HAZARDS_SCHEMA, type DurationLaw } from "./hazard.ts";
import { bandOf, LAW_DAYS, outageCurves, survivalOf } from "./law.ts";
import type { OutageEvent } from "./outages.ts";

const minutes = (count: number): number => count / 1440;
const event = (area: string, seconds: number, censored = false): OutageEvent => ({ area, start: 0, seconds, peak: 10, censored });

describe("survivalOf", () => {
  it("reads the curve at the days of the law, and stops at a chance of 0", () => {
    const curve = survivalOf(kaplanMeier([60, 60, 180, 180].map((value) => ({ time: minutes(value) }))));
    expect(curve).toEqual([
      [0, 1],
      [minutes(15), 1],
      [minutes(30), 1],
      [minutes(45), 1],
      [minutes(60), 0.5],
      [minutes(90), 0.5],
      [minutes(120), 0.5],
      [minutes(180), 0],
    ]);
    expect(curveFault(curve)).toBeUndefined();
  });

  it("closes an open tail at two times the largest observed time, or at the end of the options", () => {
    const estimate = kaplanMeier([{ time: minutes(60) }, { time: minutes(120), censored: true }]);
    const curve = survivalOf(estimate);
    expect(curve.slice(-3)).toEqual([
      [minutes(90), 0.5],
      [minutes(120), 0.5],
      [minutes(240), 0],
    ]);
    expect(curveFault(curve)).toBeUndefined();
    expect(survivalOf(estimate, { days: [minutes(30), minutes(100)], end: 1 })).toEqual([
      [0, 1],
      [minutes(30), 1],
      [minutes(100), 0.5],
      [minutes(120), 0.5],
      [1, 0],
    ]);
  });

  it("gives the time of a chance of 0 between two days", () => {
    expect(survivalOf(kaplanMeier([{ time: minutes(20) }]))).toEqual([
      [0, 1],
      [minutes(15), 1],
      [minutes(20), 0],
    ]);
  });

  it("refuses a step at 0 days, days that do not increase and an end before the largest time", () => {
    expect(() => survivalOf(kaplanMeier([{ time: 0 }]))).toThrow(RangeError);
    expect(() => survivalOf(kaplanMeier([{ time: 1 }]), { days: [0.5, 0.5] })).toThrow(RangeError);
    expect(() => survivalOf(kaplanMeier([{ time: 1, censored: true }]), { end: 1 })).toThrow(RangeError);
    expect(LAW_DAYS.every((day, index) => index === 0 || day > (LAW_DAYS[index - 1] ?? 0))).toBe(true);
  });
});

describe("bandOf", () => {
  const estimate = kaplanMeier([30, 45, 60, 60, 90, 120, 180, 240, 240, 360].map((value, index) => ({ time: minutes(value), censored: index === 9 })));

  it("gives two curves on each side of the curve, with the days of the curve", () => {
    const curve = survivalOf(estimate);
    const band = bandOf(estimate);
    expect(bandFault(curve, band)).toBeUndefined();
    expect(band.low.map(([day]) => day)).toEqual(curve.map(([day]) => day));
    expect(band.high.map(([day]) => day)).toEqual(curve.map(([day]) => day));
    expect(band.low.some(([, chance], index) => chance < (curve[index]?.[1] ?? 0) - 0.01)).toBe(true);
    expect(band.high.some(([, chance], index) => chance > (curve[index]?.[1] ?? 0) + 0.01)).toBe(true);
  });

  it("gives a narrower band with more events of the same form, and the curve itself at z 0", () => {
    const width = (band: ReturnType<typeof bandOf>): number => Math.max(...band.high.map(([, high], index) => high - (band.low[index]?.[1] ?? 0)));
    const many = kaplanMeier([30, 45, 60, 60, 90, 120, 180, 240, 240, 360].map((value, index) => ({ time: minutes(value), censored: index === 9, count: 100 })));
    expect(width(bandOf(many))).toBeLessThan(width(bandOf(estimate)) / 5);
    expect(bandOf(estimate, {}, 0)).toEqual({ low: survivalOf(estimate), high: survivalOf(estimate) });
  });

  it("refuses what survivalOf refuses, with its own name", () => {
    expect(() => bandOf(kaplanMeier([{ time: 0 }]))).toThrow(/^bandOf: /);
  });
});

describe("outageCurves", () => {
  const events = [event("02x", 3600), event("01a", 1800), event("01b", 5400), event("01a", 900, true), event("02y", 7200)];
  const curves = outageCurves(events, (area) => area.slice(0, 2));

  it("gives a curve for each region, in the order of the codes, with its counts", () => {
    expect(Object.keys(curves)).toEqual(["01", "02"]);
    expect(curves["01"]).toMatchObject({ count: 3, censored: 1, open: 0, median: minutes(30) });
    expect(curves["02"]).toMatchObject({ count: 2, censored: 0, open: 0, median: minutes(60) });
    for (const { curve, band } of Object.values(curves)) {
      expect(curveFault(curve)).toBeUndefined();
      expect(bandFault(curve, band)).toBeUndefined();
    }
  });

  it("gives curves that pass the gate of a law, for each region of the source", () => {
    const law: DurationLaw = {
      read: true,
      source: "outages",
      fit: { family: "kaplan-meier", method: "product limit with right censoring", count: events.length },
      scheme: "test-region",
      curves: Object.fromEntries(Object.entries(curves).map(([code, value]) => [code, value.curve])),
      bands: Object.fromEntries(Object.entries(curves).map(([code, value]) => [code, value.band])),
    };
    const list = (duration: DurationLaw): Parameters<typeof checkHazards>[0] => ({
      schema: HAZARDS_SCHEMA,
      sources: {
        outages: {
          id: "outages",
          title: "A dataset of outages",
          url: "https://data.example.net/outages",
          by: "An agency",
          license: "cc-by-4.0",
          terms: "https://creativecommons.org/licenses/by/4.0/",
          checked: "2026-11-22",
          regions: { scheme: "test-region", codes: ["01", "02"] },
        },
      },
      hazards: [
        {
          case: "infra.power.outage",
          title: "Power outage",
          examined: ["outages"],
          cuts: [{ part: "power.grid", title: "No power", claims: [{ definition: true, says: "The case is a stop of the grid." }], duration }],
        },
      ],
    });
    expect(checkHazards(list(law))).toEqual([]);
    const swapped = { ...law, bands: { ...law.bands, "01": { low: curves["01"]?.band.high ?? [], high: curves["01"]?.band.low ?? [] } } };
    expect(checkHazards(list(swapped)).map((fault) => [fault.code, fault.message.includes('the band of the region "01"')])).toEqual([["hazards-curve", true]]);
    const stray = { ...law, bands: { ...law.bands, "03": curves["01"]?.band ?? { low: [], high: [] } } };
    expect(checkHazards(list(stray)).map((fault) => fault.code)).toEqual(["hazards-curve"]);
  });
});
