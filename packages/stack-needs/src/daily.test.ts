import { isNeedCode, NEEDS } from "@mark1russell7/alerts";
import { resultOf } from "@mark1russell7/guidebook";
import { describe, expect, it } from "vitest";
import { ALERT_WATCH_NEED, checkDailyNeeds, DAILY_NEED_CODES, DAILY_NEEDS, LIGHT_NEED, WARMTH_NEED, type DailyNeed } from "./daily.ts";

const watch = DAILY_NEEDS.find((need) => need.code === ALERT_WATCH_NEED);
const withRate = (rate: DailyNeed["rate"], unit = "h"): DailyNeed[] => [{ code: "test.need", unit, users: "person", rate }];
const codes = (needs: readonly DailyNeed[]): string[] => checkDailyNeeds(needs, { at: "2026-11-24" }).map((finding) => finding.code);

describe("the daily needs of the kit", () => {
  it("passes the gate at the date of the read", () => {
    expect(resultOf(checkDailyNeeds(DAILY_NEEDS, { at: "2026-11-24" })).ok).toBe(true);
    expect(checkDailyNeeds(DAILY_NEEDS, { at: "2026-11-24" })).toEqual([]);
  });

  it("has the three needs in the form <area>.<what>, and none is a need of the alert list with a different unit", () => {
    expect(DAILY_NEEDS.map((need) => need.code)).toEqual([ALERT_WATCH_NEED, LIGHT_NEED, WARMTH_NEED]);
    for (const need of DAILY_NEEDS) expect(isNeedCode(need.code), need.code).toBe(true);
    const units = new Map(NEEDS.map((need) => [need.code, need.unit]));
    for (const need of DAILY_NEEDS) if (units.has(need.code)) expect(units.get(need.code)).toBe(need.unit);
  });

  it("gives the alert receiver 24 hours each day for each household, from two public-domain pages of the National Weather Service", () => {
    expect(watch?.users).toBe("household");
    expect(watch?.rate).toMatchObject({ read: true, perDay: { value: 24, unit: "h/d" } });
    if (watch?.rate.read !== true) throw new Error("no read");
    expect(watch.rate.sources.map((source) => source.url)).toEqual(["https://www.weather.gov/nwr/nwr_receivers", "https://www.weather.gov/nwr/nwr_warning"]);
    for (const source of watch.rate.sources) expect(source.license).toBe("us-public-domain");
  });

  it("keeps light and warmth as a no read with a reason, not as 0", () => {
    for (const code of [LIGHT_NEED, WARMTH_NEED]) {
      const need = DAILY_NEEDS.find((item) => item.code === code);
      expect(need?.rate.read, code).toBe(false);
      if (need?.rate.read === false) expect(need.rate.why).toContain("input data");
    }
  });
});

describe("the gate of the daily needs", () => {
  const source = { id: "s", title: "S", url: "https://example.org/s", license: "us-public-domain" as const, checked: "2026-11-24", by: "Example", terms: "https://example.org/terms" };

  it("has two codes", () => {
    expect(DAILY_NEED_CODES).toEqual(["daily-need-id", "daily-need-rate"]);
  });

  it("refuses an empty code and two needs with one code", () => {
    const rate = { read: false as const, why: "No source." };
    expect(codes([{ code: " ", unit: "h", users: "person", rate }])).toEqual(["daily-need-id"]);
    expect(codes([...withRate(rate), ...withRate(rate)])).toEqual(["daily-need-id"]);
  });

  it("refuses a rate in a unit that does not convert, a rate below 0, a rate that is not finite and a rate with no source", () => {
    expect(codes(withRate({ read: true, perDay: { value: 1, unit: "kWh/d" }, sources: [source], note: "n" }))).toEqual(["daily-need-rate"]);
    expect(codes(withRate({ read: true, perDay: { value: -1, unit: "h/d" }, sources: [source], note: "n" }))).toEqual(["daily-need-rate"]);
    expect(codes(withRate({ read: true, perDay: { value: Number.NaN, unit: "h/d" }, sources: [source], note: "n" }))).toEqual(["daily-need-rate"]);
    expect(codes(withRate({ read: true, perDay: { value: 1, unit: "h/d" }, sources: [], note: "n" }))).toEqual(["daily-need-rate"]);
  });

  it("accepts a rate in a unit that converts, for example minutes for each day for a need in hours", () => {
    expect(codes(withRate({ read: true, perDay: { value: 90, unit: "min/d" }, sources: [source], note: "n" }))).toEqual([]);
  });

  it("refuses a no read with no reason", () => {
    expect(codes(withRate({ read: false, why: " " }))).toEqual(["daily-need-rate"]);
  });

  it("gives the findings of the gate of the sources, with a publisher and a page of terms that each source must have", () => {
    const bare = { id: "s", title: "S", url: "https://example.org/s", license: "us-public-domain" as const, checked: "2026-11-24" };
    expect(codes(withRate({ read: true, perDay: { value: 1, unit: "h/d" }, sources: [bare], note: "n" }))).toEqual(["missing-field", "missing-field"]);
  });
});
