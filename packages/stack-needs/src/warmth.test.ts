import { describe, expect, it } from "vitest";
import { checkDailyNeeds, DAILY_NEEDS, WARMTH_NEED } from "./daily.ts";
import { heatLossFromUse, heatLossOf, MAX_WARMTH_DAYS, warmthHeat, warmthNeed } from "./warmth.ts";

// TEST DATA: each building, temperature and heat of this file is made up, with the license `invented`. No value is of a real home.

describe("the heat loss of a home", () => {
  it("sums the area times the U-value of each element", () => {
    // 100 m² of wall at 0.5, 80 m² of roof at 0.25 and 20 m² of window at 2.8: 50 + 20 + 56 = 126 W/K.
    expect(heatLossOf([{ areaM2: 100, uWm2K: 0.5 }, { areaM2: 80, uWm2K: 0.25 }, { areaM2: 20, uWm2K: 2.8 }])).toBeCloseTo(126, 9);
    expect(() => heatLossOf([])).toThrow(RangeError);
    expect(() => heatLossOf([{ areaM2: -1, uWm2K: 1 }])).toThrow(RangeError);
    expect(() => heatLossOf([{ areaM2: 1, uWm2K: Number.NaN }])).toThrow(RangeError);
  });

  it("gives the coefficient from the heat of a past period and its degree days", () => {
    // 3024 kWh over 1000 kelvin days: 3 024 000 Wh / 24 000 Kh = 126 W/K.
    expect(heatLossFromUse(3024, 1000)).toBeCloseTo(126, 9);
    expect(() => heatLossFromUse(1, 0)).toThrow(RangeError);
    expect(() => heatLossFromUse(-1, 10)).toThrow(RangeError);
  });

  it("gives back the heat of the period from the coefficient: the two methods agree", () => {
    const outdoor = [-5, 0, 3, 8, 12, 20];
    const balance = 18;
    const degreeDays = outdoor.reduce((sum, t) => sum + Math.max(0, balance - t), 0);
    const heat = warmthHeat({ heatLossWK: 126, indoorC: balance, outdoorC: outdoor });
    expect(heatLossFromUse(heat.days.reduce((sum, day) => sum + day.heatKWh, 0), degreeDays)).toBeCloseTo(126, 9);
  });
});

describe("warmthHeat", () => {
  it("gives the heat of each day, no heat on a warm day, and the most of the worst day", () => {
    const heat = warmthHeat({ heatLossWK: 125, indoorC: 15, outdoorC: [-5, 5, 20] });
    // 125 W/K × 20 K × 24 h = 60 kWh. 125 × 10 × 24 = 30 kWh.
    expect(heat.days.map((day) => day.heatKWh)).toEqual([60, 30, 0]);
    expect(heat.most).toBe(60);
    expect(heat.mean).toBe(30);
  });

  it("takes the gains of the persons from the flow", () => {
    const heat = warmthHeat({ heatLossWK: 125, indoorC: 15, outdoorC: [-5], gainsW: 500 });
    // (2500 - 500) W × 24 h = 48 kWh.
    expect(heat.most).toBeCloseTo(48, 9);
  });

  it("refuses a bad value or a plan of no days or too many days", () => {
    const good = { heatLossWK: 100, indoorC: 15, outdoorC: [0] };
    for (const bad of [{ heatLossWK: -1 }, { indoorC: Number.NaN }, { gainsW: -1 }, { outdoorC: [] }, { outdoorC: [Infinity] }, { outdoorC: new Array(MAX_WARMTH_DAYS + 1).fill(0) }])
      expect(() => warmthHeat({ ...good, ...bad })).toThrow(RangeError);
  });
});

describe("warmthNeed", () => {
  it("gives a read of the need of warmth that passes the gate", () => {
    const need = warmthNeed(warmthHeat({ heatLossWK: 125, indoorC: 15, outdoorC: [-5, 5] }));
    expect(need).toMatchObject({ code: WARMTH_NEED, unit: "kWh", users: "household", rate: { read: true, perDay: { value: 60, unit: "kWh/d" } } });
    const needs = DAILY_NEEDS.map((each) => (each.code === WARMTH_NEED ? need : each));
    expect(checkDailyNeeds(needs).filter((finding) => finding.level === "error")).toEqual([]);
  });
});
