import { kaplanMeier } from "@mark1russell7/rigor-statistics";
import { curveFault } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkHazards } from "./check.ts";
import { HAZARDS_SCHEMA, type DurationLaw } from "./hazard.ts";
import { LAW_DAYS, outageCurves, survivalOf } from "./law.ts";
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

describe("outageCurves", () => {
  const events = [event("02x", 3600), event("01a", 1800), event("01b", 5400), event("01a", 900, true), event("02y", 7200)];
  const curves = outageCurves(events, (area) => area.slice(0, 2));

  it("gives a curve for each region, in the order of the codes, with its counts", () => {
    expect(Object.keys(curves)).toEqual(["01", "02"]);
    expect(curves["01"]).toMatchObject({ count: 3, censored: 1, open: 0, median: minutes(30) });
    expect(curves["02"]).toMatchObject({ count: 2, censored: 0, open: 0, median: minutes(60) });
    for (const { curve } of Object.values(curves)) expect(curveFault(curve)).toBeUndefined();
  });

  it("gives curves that pass the gate of a law, for each region of the source", () => {
    const law: DurationLaw = {
      read: true,
      source: "outages",
      fit: { family: "kaplan-meier", method: "product limit with right censoring", count: events.length },
      scheme: "test-region",
      curves: Object.fromEntries(Object.entries(curves).map(([code, value]) => [code, value.curve])),
    };
    const faults = checkHazards({
      schema: HAZARDS_SCHEMA,
      sources: {
        outages: {
          name: "A dataset of outages",
          url: "https://data.example.net/outages",
          publisher: "An agency",
          license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
          read: "2026-11-22",
          regions: { scheme: "test-region", codes: ["01", "02"] },
        },
      },
      hazards: [
        {
          case: "infra.power.outage",
          title: "Power outage",
          examined: ["outages"],
          cuts: [{ part: "power.grid", title: "No power", claims: [{ definition: true, says: "The case is a stop of the grid." }], duration: law }],
        },
      ],
    });
    expect(faults).toEqual([]);
  });
});
