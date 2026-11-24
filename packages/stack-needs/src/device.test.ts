import { SUPPLY_CATALOG, type SupplyCatalog, type SupplyProduct } from "@mark1russell7/market/supplies";
import { checkEndurance, enduranceOf, hasEnduranceError, joinEndurance, type CaseCuts, type EnduranceLayer } from "@mark1russell7/stack-endurance";
import { describe, expect, it } from "vitest";
import { ALERT_WATCH_NEED, DAILY_NEEDS, LIGHT_NEED, type DailyNeed } from "./daily.ts";
import { deviceFragment, HOURS_IN_DAY, type DeviceFragmentInput } from "./device.ts";

// TEST DATA: each device and run time of this file is made up, with the license `invented`.
// Only the tests that name SUPPLY_CATALOG use the cited facts of the catalog of market.

const fact = "test.fact";
const cells = { amount: 3, unit: "{each}" };

/** A made-up radio: 48 h of alert watch on 3 AA cells, so 16 h for each cell. */
const radio = {
  id: "test.radio",
  title: "A made-up alert radio",
  kind: "communication",
  gives: [],
  shelf: { read: false, why: "Test data." },
  device: { need: ALERT_WATCH_NEED, battery: "battery.aa", run: { amount: 48, unit: "h", per: cells, fact } },
} as unknown as SupplyProduct;

/** A made-up flashlight with no cited run time. */
const light = {
  id: "test.light",
  title: "A made-up flashlight",
  kind: "light",
  gives: [],
  shelf: { read: false, why: "Test data." },
  device: { need: LIGHT_NEED, battery: "battery.aa", run: { read: false, why: "Test data: no run time." } },
} as unknown as SupplyProduct;

const catalog: SupplyCatalog = { ...SUPPLY_CATALOG, products: [...SUPPLY_CATALOG.products, radio, light] };
const draws = { level: "critical", supply: "alert.grid" };
const input = (units: Record<string, number>, more: Partial<DeviceFragmentInput> = {}): DeviceFragmentInput => ({ catalog, units, draws, ...more });

describe("the device fragment", () => {
  it("gives one hour of a day in hours from quantity", () => {
    expect(HOURS_IN_DAY).toBe(24);
  });

  it("gives a converter for each device with a cited run time: one cell for each run, and a limit of runs for each day", () => {
    const result = deviceFragment(input({ "test.radio": 2 }, { parts: { "test.radio": "radio.kitchen" } }));
    expect(result.layer.converters).toEqual([
      { id: "device:test.radio", device: "radio.kitchen", takes: [{ resource: "battery.aa", amount: 1 }], gives: { need: ALERT_WATCH_NEED, amount: 16 }, perDay: 1.5, devices: 2 },
    ]);
    expect(result.layer.resources).toEqual([{ code: "battery.aa", unit: "{each}" }]);
    expect(result.layer.draws).toEqual([{ need: ALERT_WATCH_NEED, level: "critical", perDay: 24, users: 1, supply: "alert.grid" }]);
    expect(result.layer.levels).toEqual(["critical"]);
    expect(result.lines).toEqual([{ product: "test.radio", need: ALERT_WATCH_NEED, battery: "battery.aa", devices: 2, hours: { read: true, value: 16, unit: "h" } }]);
    expect(result.read).toBe(true);
  });

  it("gives no converter and a no read for a device with no run time, and for a need with no daily rate", () => {
    const result = deviceFragment(input({ "test.light": 1 }));
    expect(result.layer.converters).toEqual([]);
    expect(result.layer.draws).toEqual([]);
    expect(result.noReads.map((each) => each.product ?? each.need)).toEqual(["test.light", LIGHT_NEED]);
    expect(result.noReads[0]!.why).toContain("Test data: no run time.");
    expect(result.read).toBe(false);
  });

  it("takes the run time of the caller in place of the catalog, with its citation", () => {
    const run = { amount: 25, unit: "h", per: { amount: 2, unit: "{each}" }, cite: "test.maker-page" };
    const result = deviceFragment(input({ "test.light": 1 }, { runs: { "test.light": run }, draws: undefined }));
    expect(result.layer.converters.map((each) => [each.gives.amount, each.perDay])).toEqual([[12.5, 24 / 12.5]]);
    expect(result.layer.draws).toEqual([]);
    expect(result.read).toBe(true);
    const blank = deviceFragment(input({ "test.light": 1 }, { runs: { "test.light": { ...run, cite: " " } }, draws: undefined }));
    expect(blank.noReads.map((each) => each.why)).toEqual(["The run time of the caller for test.light has no citation."]);
    const minutes = deviceFragment(input({ "test.light": 1 }, { runs: { "test.light": { ...run, amount: 600, unit: "min" } }, draws: undefined }));
    expect(minutes.layer.converters[0]!.gives.amount).toBe(5);
  });

  it("gives a no read for a run time that is not a time or not on a count of cells", () => {
    const bad = (run: { amount: number; unit: string; per: { amount: number; unit: string } }) =>
      deviceFragment(input({ "test.light": 1 }, { runs: { "test.light": { ...run, cite: "test" } }, draws: undefined })).noReads.map((each) => each.why);
    expect(bad({ amount: 5, unit: "Wh", per: cells })[0]).toContain("is not a time above 0");
    expect(bad({ amount: 0, unit: "h", per: cells })[0]).toContain("is not a time above 0");
    expect(bad({ amount: 5, unit: "h", per: { amount: 1, unit: "L" } })[0]).toContain("not a count of cells");
  });

  it("counts whole devices, and skips a product with no device or no units", () => {
    const result = deviceFragment(input({ "test.radio": 1.5, "food.rice-white-1kg": 3, "test.light": 0 }));
    expect(result.layer.converters.map((each) => each.devices)).toEqual([1]);
    const part = deviceFragment(input({ "test.radio": 0.5 }));
    expect(part.layer.converters).toEqual([]);
    expect(part.noReads[0]!.why).toContain("less than one whole device");
  });

  it("gives the need in its unit, and a no read for a need that is not a time or not of the household", () => {
    const needs = (change: Partial<DailyNeed>): DailyNeed[] => DAILY_NEEDS.map((need) => (need.code === ALERT_WATCH_NEED ? { ...need, ...change } : need));
    const inMinutes = needs({ unit: "min", rate: { ...(DAILY_NEEDS[0]!.rate as Extract<DailyNeed["rate"], { read: true }>), perDay: { value: 1440, unit: "min/d" } } });
    const minutes = deviceFragment(input({ "test.radio": 1 }, { needs: inMinutes }));
    expect(minutes.layer.converters[0]!.gives.amount).toBe(16 * 60);
    expect(minutes.layer.draws[0]!.perDay).toBe(1440);
    expect(deviceFragment(input({ "test.radio": 1 }, { needs: needs({ unit: "kWh" }) })).noReads[0]!.why).toContain("is not a time");
    expect(deviceFragment(input({ "test.radio": 1 }, { needs: needs({ users: "person" }) })).noReads[0]!.why).toContain("for each person");
    expect(deviceFragment(input({ "test.radio": 1 }, { needs: [] })).noReads[0]!.why).toContain("have no need");
  });

  it("refuses a device on a resource that is not in the catalog", () => {
    const odd = { ...radio, id: "test.odd", device: { ...radio.device!, battery: "battery.d" } } as SupplyProduct;
    expect(() => deviceFragment({ catalog: { ...catalog, products: [...catalog.products, odd] }, units: { "test.odd": 1 } })).toThrow(RangeError);
  });

  it("gives the days of alert watch that the stored cells hold, with the limit of runs of each radio", () => {
    const cut: CaseCuts = { case: "test.grid-cut", title: "A test stop of the grid", cuts: [{ part: "alert.grid", title: "No grid", source: "test" }] };
    const days = (count: number, stored: number): { days: number; capped?: readonly string[] | undefined } => {
      const devices = deviceFragment(input({ "test.radio": count }));
      const stores: EnduranceLayer = { schema: "endurance/1", levels: ["critical"], resources: [{ code: "battery.aa", unit: "{each}" }], stores: [{ id: "cells", resource: "battery.aa", amount: stored }], draws: [] };
      const join = joinEndurance([
        { from: "devices", layer: devices.layer as EnduranceLayer },
        { from: "stores", layer: stores },
      ]);
      if (!join.ok) throw new Error(JSON.stringify(join.errors));
      expect(hasEnduranceError(checkEndurance(join.layer))).toBe(false);
      return enduranceOf(join.layer, cut, { at: "2026-11-24" }).needs[ALERT_WATCH_NEED]!;
    };
    // One radio watches 24 h each day with 1.5 cells, so 12 cells hold 8 days.
    expect(days(1, 12).days).toBeCloseTo(8, 9);
    // Two radios do not watch more hours of one need: the draw is 24 h each day.
    expect(days(2, 12).days).toBeCloseTo(8, 9);
  });

  it("gives the radio and the flashlight of the catalog no converter, because their run time is no read", () => {
    const result = deviceFragment({ catalog: SUPPLY_CATALOG, units: { "communication.noaa-radio": 1, "light.flashlight": 1 }, draws });
    expect(result.layer.converters).toEqual([]);
    expect(result.noReads.map((each) => each.product ?? each.need)).toEqual(["communication.noaa-radio", "light.flashlight", LIGHT_NEED]);
    expect(result.layer.draws.map((each) => each.need)).toEqual([ALERT_WATCH_NEED]);
  });
});
