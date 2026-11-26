import { describe, expect, it } from "vitest";
import { enduranceOf } from "./endurance.ts";
import { ENDURANCE_SCHEMA, type CaseCuts, type EnduranceLayer, type Survival } from "./layer.ts";
import { SAMPLE_ENDURANCE, SAMPLE_ENDURANCE_STACK } from "./sample.ts";
import { caseOutlook, caseShortfall } from "./shortfall.ts";

const AT = "2026-12-01";
// Each cut lasts from 0 to 10 days, with each length the same chance. Thus S(t) = 1 - t / 10.
const EVEN: Survival = [[0, 1], [10, 0]];

// Water 10 L. The drink takes 1 L a day at the level life. The food at the level health is rice, cooked with 2 L of water a pot.
// The heat comes from gas, which the case does not cut.
const cook: EnduranceLayer = {
  schema: ENDURANCE_SCHEMA,
  levels: ["life", "health"],
  resources: [{ code: "water", unit: "L" }, { code: "rice", unit: "u" }],
  stores: [{ id: "water", resource: "water", amount: 10 }, { id: "rice", resource: "rice", amount: 100 }],
  draws: [
    { need: "drink", level: "life", perDay: 1, supply: "main" },
    { need: "food", level: "health", perDay: 1, supply: "shop" },
    { need: "heat", level: "health", perDay: 1, supply: "gas" },
  ],
  direct: [{ resource: "water", need: "drink", amount: 1 }],
  converters: [{ id: "cook", takes: [{ resource: "rice", amount: 1 }, { resource: "water", amount: 2 }], gives: { need: "food", amount: 1 } }],
};
const dry: CaseCuts = {
  case: "dry",
  title: "No water and no shop",
  cuts: [
    { part: "main", title: "No water from the main", duration: EVEN, source: "test" },
    { part: "shop", title: "Closed shop", duration: EVEN, source: "test" },
  ],
};

describe("caseOutlook", () => {
  it("gives the days, the chance and the shortfall of each draw in the take order", () => {
    const outlook = caseOutlook(cook, dry, { at: AT });
    expect(outlook).toMatchObject({ case: "dry", title: "No water and no shop", at: AT, share: "take", horizon: undefined, holds: ["heat"], unread: [], bound: "law" });
    const [drink, food] = outlook.draws;
    // The drink keeps back the 10 L for its 10 days. Each cut ends by 10 days, so the drink lasts through each event.
    expect(drink).toMatchObject({ need: "drink", level: "life", supply: "main", users: 1, days: 10 });
    expect(drink?.lasts).toEqual({ event: 1, independent: 1, upper: 1 });
    expect(drink?.shortfall.event).toBeCloseTo(0, 12);
    // The food gets no water, so it lasts only when the shop has no cut. Its shortfall is the mean cut, 5 days.
    expect(food?.days).toBe(0);
    expect(food?.lasts).toEqual({ event: 0, independent: 0, upper: 0 });
    expect(food?.shortfall.event).toBeCloseTo(5, 12);
  });

  it("gives the best share with the horizon", () => {
    const outlook = caseOutlook(cook, dry, { at: AT, horizon: 5, share: "best" });
    expect(outlook.share).toBe("best");
    expect(outlook.horizon).toBe(5);
    const [drink, food] = outlook.draws;
    // The drink keeps back 5 L for the horizon. The food cooks with the other 5 L: 2.5 days.
    expect(drink).toMatchObject({ days: 5, atHorizon: true, lasts: { event: 1, independent: 1, upper: 1 } });
    expect(food?.days).toBeCloseTo(2.5, 9);
    // P(min(D, 5) <= 2.5) = P(D <= 2.5) = 0.25, and E[max(0, min(D, 5) - 2.5)] is the area under S from 2.5 to 5.
    expect(food?.lasts.event).toBeCloseTo(0.25, 9);
    expect(food?.shortfall.event).toBeCloseTo(2.5 - (25 - 6.25) / 20, 9);
  });

  it("gives the values at each end of the sampling bands, with the same days, and no band for a stop with a cut with no band", () => {
    const band = { low: [[0, 1], [8, 0]], high: [[0, 1], [12, 0]] } as const;
    const banded: CaseCuts = { ...dry, cuts: dry.cuts.map((cut) => ({ ...cut, band })) };
    const outlook = caseOutlook(cook, banded, { at: AT, horizon: 5, share: "best" });
    const [drink, food] = outlook.draws;
    expect(drink?.band?.shorter.lasts).toEqual({ event: 1, independent: 1, upper: 1 });
    expect(food?.days).toBeCloseTo(2.5, 9);
    // The shorter end: S(t) = 1 - t / 8. The longer end: S(t) = 1 - t / 12.
    expect(food?.band?.shorter.lasts.event).toBeCloseTo(2.5 / 8, 9);
    expect(food?.band?.longer.lasts.event).toBeCloseTo(2.5 / 12, 9);
    expect(food?.band?.shorter.shortfall.event).toBeCloseTo(2.5 - (25 - 6.25) / 16, 9);
    expect(food?.band?.longer.shortfall.event).toBeCloseTo(2.5 - (25 - 6.25) / 24, 9);
    // The curve is between the two ends.
    const lasts = food?.lasts.event ?? Number.NaN;
    expect((food?.band?.longer.lasts.event ?? 1) <= lasts && lasts <= (food?.band?.shorter.lasts.event ?? 0)).toBe(true);
    // With no bands, no draw has a band. With a band on the shop only, the drink has none.
    expect(caseOutlook(cook, dry, { at: AT }).draws.some((draw) => draw.band !== undefined)).toBe(false);
    const shopOnly: CaseCuts = { ...dry, cuts: dry.cuts.map((cut) => (cut.part === "shop" ? { ...cut, band } : cut)) };
    expect(caseOutlook(cook, shopOnly, { at: AT }).draws.map((draw) => [draw.need, draw.band !== undefined])).toEqual([["drink", false], ["food", true]]);
  });

  it("puts a draw whose stop has no curve in unread", () => {
    const unsourced: CaseCuts = { ...dry, cuts: dry.cuts.map((cut) => (cut.part === "shop" ? { part: cut.part, title: cut.title, source: "test" } : cut)) };
    const outlook = caseOutlook(cook, unsourced, { at: AT });
    expect(outlook.draws.map((draw) => draw.need)).toEqual(["drink"]);
    expect(outlook.unread).toEqual(["food"]);
  });

  it("agrees with caseShortfall, and the upper curve is the safe side, on each case of the sample", () => {
    for (const caseCuts of SAMPLE_ENDURANCE.cases ?? []) {
      for (const stack of [undefined, SAMPLE_ENDURANCE_STACK]) {
        for (const horizon of [undefined, 2, 14]) {
          const options = { at: AT, stack, horizon };
          const outlook = caseOutlook(SAMPLE_ENDURANCE, caseCuts, options);
          const shortfall = caseShortfall(SAMPLE_ENDURANCE, caseCuts, enduranceOf(SAMPLE_ENDURANCE, caseCuts, options), options);
          expect(outlook.unread).toEqual(shortfall.unread);
          expect(outlook.bound).toBe(shortfall.bound);
          for (const level of SAMPLE_ENDURANCE.levels) {
            const sum = (pick: "event" | "independent" | "upper"): number =>
              outlook.draws.filter((draw) => draw.level === level).reduce((total, draw) => total + draw.shortfall[pick], 0);
            expect(sum("event")).toBeCloseTo(shortfall.levels[level] ?? 0, 9);
            expect(sum("independent")).toBeCloseTo(shortfall.independent[level] ?? 0, 9);
            expect(sum("upper")).toBeCloseTo(shortfall.upper[level] ?? 0, 9);
          }
          for (const draw of outlook.draws) {
            for (const chance of Object.values(draw.lasts)) expect(chance >= 0 && chance <= 1).toBe(true);
            expect(draw.lasts.upper).toBeLessThanOrEqual(Math.min(draw.lasts.event, draw.lasts.independent) + 1e-12);
          }
          const read = new Set([...outlook.draws.map((draw) => draw.need), ...outlook.holds, ...outlook.unread]);
          expect([...read].sort()).toEqual(SAMPLE_ENDURANCE.draws.map((draw) => draw.need).sort());
        }
      }
    }
  });

  it("refuses a bad share and a bad horizon", () => {
    expect(() => caseOutlook(cook, dry, { at: AT, share: "fair" as never })).toThrow(RangeError);
    expect(() => caseOutlook(cook, dry, { at: AT, horizon: 0 })).toThrow(RangeError);
  });
});
