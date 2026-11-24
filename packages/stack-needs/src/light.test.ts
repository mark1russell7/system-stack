import { SUPPLY_CATALOG } from "@mark1russell7/market/supplies";
import { describe, expect, it } from "vitest";
import { checkDailyNeeds, DAILY_NEEDS, LIGHT_NEED } from "./daily.ts";
import { deviceFragment } from "./device.ts";
import { lightHours, lightNeed, MAX_LIGHT_DAYS, type LightHoursInput } from "./light.ts";

// TEST DATA: each point and awake window of this file is made up, with the license `invented`. The points are not homes.

const awake = (zone: string, start = "07:00", end = "23:00") => ({ zone, start, end });
const hours = (input: Partial<LightHoursInput> & Pick<LightHoursInput, "point" | "awake">) => lightHours({ from: "2026-12-21", days: 1, ...input });

describe("lightHours", () => {
  it("gives the dark hours of the awake window at the equator: from the sunset at near 18:07 to 23:00", () => {
    const [day] = hours({ point: { lat: 0, lon: 0 }, awake: awake("UTC") }).days;
    expect(day!.awakeHours).toBe(16);
    expect(day!.darkHours).toBeGreaterThan(4.6);
    expect(day!.darkHours).toBeLessThan(5.2);
  });

  it("gives all the awake hours in a polar night, and none in a polar day", () => {
    expect(hours({ point: { lat: 80, lon: 15 }, awake: awake("UTC") }).days[0]!.darkHours).toBe(16);
    expect(hours({ point: { lat: 80, lon: 15 }, awake: awake("UTC"), from: "2026-06-21" }).days[0]!.darkHours).toBe(0);
  });

  it("gives more dark hours in the winter than in the summer, and a most of the worst day", () => {
    const point = { lat: 40, lon: -74 };
    const winter = hours({ point, awake: awake("America/New_York") });
    const summer = hours({ point, awake: awake("America/New_York"), from: "2026-06-21" });
    expect(winter.most).toBeGreaterThan(6.4);
    expect(winter.most).toBeLessThan(7.1);
    expect(summer.most).toBeLessThan(2.6);
    const year = lightHours({ point, awake: awake("America/New_York"), from: "2026-01-01", days: 365 });
    expect(year.most).toBeGreaterThanOrEqual(winter.most - 0.05);
    expect(year.mean).toBeLessThan(year.most);
    expect(year.mean).toBeGreaterThan(summer.most);
  });

  it("splits a window across midnight at local midnight, and follows the wall clock at a change of the clock", () => {
    const night = hours({ point: { lat: 40, lon: -74 }, awake: awake("America/New_York", "22:00", "02:00") });
    expect(night.days[0]!.awakeHours).toBe(4);
    expect(night.days[0]!.darkHours).toBe(4);
    // On 2026-03-08 the clock of New York goes from 02:00 to 03:00. The date has 23 hours.
    const change = lightHours({ point: { lat: 40, lon: -74 }, awake: awake("America/New_York"), from: "2026-03-07", days: 2 });
    expect(change.days.map((day) => day.awakeHours)).toEqual([16, 16]);
    const full = lightHours({ point: { lat: 40, lon: -74 }, awake: awake("America/New_York", "00:00", "00:00"), from: "2026-03-08", days: 1 });
    expect(full.days[0]!.awakeHours).toBe(23);
  });

  it("gives the same dark hours for one plan in two time zones that show the same instants", () => {
    const point = { lat: 51.5, lon: 0 };
    const london = hours({ point, awake: awake("Europe/London") });
    const utc = hours({ point, awake: awake("UTC") });
    expect(london.most).toBeCloseTo(utc.most, 9);
  });

  it("refuses a bad window, date or count of days", () => {
    const point = { lat: 0, lon: 0 };
    expect(() => hours({ point, awake: awake("Nowhere/City") })).toThrow(RangeError);
    expect(() => hours({ point, awake: awake("UTC", "7:00") })).toThrow(RangeError);
    expect(() => hours({ point, awake: awake("UTC"), from: "2026-02-30" })).toThrow(RangeError);
    for (const days of [0, 1.5, MAX_LIGHT_DAYS + 1]) expect(() => hours({ point, awake: awake("UTC"), days })).toThrow(RangeError);
  });
});

describe("lightNeed", () => {
  it("gives a read of the need of light that passes the gate, and a draw of the device fragment", () => {
    const need = lightNeed(hours({ point: { lat: 40, lon: -74 }, awake: awake("America/New_York") }));
    expect(need.code).toBe(LIGHT_NEED);
    expect(need.rate.read).toBe(true);
    const needs = DAILY_NEEDS.map((each) => (each.code === LIGHT_NEED ? need : each));
    expect(checkDailyNeeds(needs).filter((finding) => finding.level === "error")).toEqual([]);
    const fragment = deviceFragment({ catalog: SUPPLY_CATALOG, units: { "light.flashlight": 1 }, needs, draws: { level: "critical", supply: "light.grid" } });
    const draw = fragment.layer.draws.find((each) => each.need === LIGHT_NEED);
    expect(draw?.perDay).toBeCloseTo(need.rate.read ? need.rate.perDay.value : Number.NaN, 9);
  });
});
