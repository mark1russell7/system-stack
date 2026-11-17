import { SAMPLE_STACK, STACK_SCHEMA, stopped, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkSpend } from "./check.ts";
import { endStops, planEnds } from "./ends.ts";
import { END_DAYS, SPEND_SCHEMA, type Service, type SpendLayer } from "./layer.ts";
import { SAMPLE_ENDS, SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";

const today = "2026-11-16";
const stack: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "a", kind: "account" },
    { id: "b", kind: "account" },
    { id: "c", kind: "account" },
    { id: "key", kind: "secret", needs: ["a"] },
    { id: "job", kind: "program", needs: ["key"] },
    { id: "page", kind: "program", needs: [{ any: ["b", "c"] }] },
  ],
};
const layer = (...services: Service[]): SpendLayer => ({ schema: SPEND_SCHEMA, currency: "USD", kinds: [], proofDays: 90, services });
const stops = (part: string, date: string): Service => ({ part, billing: "free", ends: { date } });
const changes = (part: string, date: string): Service => ({ part, billing: "free", ends: { date, next: { billing: "fixed", price: 20 } } });

describe("planEnds", () => {
  it("gives no end for a layer with no plan that ends", () => {
    expect(planEnds(SAMPLE_SPEND, { today: SAMPLE_TODAY })).toEqual([]);
    expect(planEnds(layer(), { today })).toEqual([]);
  });

  it("gives the two ends of the sample, with the nearest date first", () => {
    expect(planEnds(SAMPLE_ENDS, { today: SAMPLE_TODAY })).toEqual([
      { part: "call-account", date: "2026-11-30", days: 14, stops: true },
      { part: "cloud-account", date: "2026-12-01", days: 15, stops: false },
    ]);
  });

  it("gives a count of days below 0 for a plan that ended, and 0 for the last day", () => {
    expect(planEnds(layer(stops("a", "2026-11-15"), stops("b", "2026-11-16")), { today })).toEqual([
      { part: "a", date: "2026-11-15", days: -1, stops: true },
      { part: "b", date: "2026-11-16", days: 0, stops: true },
    ]);
  });

  it("keeps the sequence of the records for two ends on one date", () => {
    const ends = planEnds(layer(stops("c", "2026-12-01"), changes("a", "2026-12-01"), stops("b", "2026-11-20")), { today });
    expect(ends.map((end) => end.part)).toEqual(["b", "c", "a"]);
  });

  it("does not give a record whose date is not a date, and uses the first record of a part", () => {
    expect(planEnds(layer(stops("a", "soon"), stops("b", "2026-12-01"), stops("b", "2026-11-20")), { today })).toEqual([{ part: "b", date: "2026-12-01", days: 15, stops: true }]);
  });

  it("refuses a date of the check that is not a date, and does not change the layer", () => {
    expect(() => planEnds(SAMPLE_ENDS, { today: "today" })).toThrow(RangeError);
    const before = JSON.stringify(SAMPLE_ENDS);
    planEnds(SAMPLE_ENDS, { today: SAMPLE_TODAY });
    expect(JSON.stringify(SAMPLE_ENDS)).toBe(before);
  });
});

describe("endStops", () => {
  it("gives the service that stops in the sample, and the part that cannot work without it", () => {
    expect(endStops(SAMPLE_ENDS, SAMPLE_STACK, { today: SAMPLE_TODAY })).toEqual({ ended: ["call-account"], stopped: ["call-account", "call"] });
  });

  it("gives nothing for a layer with no plan that ends", () => {
    expect(endStops(SAMPLE_SPEND, SAMPLE_STACK, { today: SAMPLE_TODAY })).toEqual({ ended: [], stopped: [] });
  });

  it("follows the needs of the stack: a key and its job stop with the account", () => {
    expect(endStops(layer(stops("a", "2026-12-01")), stack, { today })).toEqual({ ended: ["a"], stopped: ["a", "key", "job"] });
  });

  it("does not stop a part that has a second path, until that path stops too", () => {
    expect(endStops(layer(stops("b", "2026-12-01")), stack, { today })).toEqual({ ended: ["b"], stopped: ["b"] });
    expect(endStops(layer(stops("b", "2026-12-01"), stops("c", "2026-12-10")), stack, { today })).toEqual({ ended: ["b", "c"], stopped: ["b", "c", "page"] });
  });

  it("does not stop a service with a plan after the end", () => {
    expect(endStops(layer(changes("a", "2026-12-01")), stack, { today })).toEqual({ ended: [], stopped: [] });
  });

  it("counts a plan that ended before the date of the check", () => {
    expect(endStops(layer(stops("a", "2026-01-01")), stack, { today })).toEqual({ ended: ["a"], stopped: ["a", "key", "job"] });
  });

  it("uses the days of warning of the layer, and the default of 30 days", () => {
    expect(END_DAYS).toBe(30);
    const ends = layer(stops("a", "2026-12-16"), stops("b", "2026-12-17"));
    expect(endStops(ends, stack, { today }).ended).toEqual(["a"]);
    expect(endStops({ ...ends, endDays: 31 }, stack, { today }).ended).toEqual(["a", "b"]);
    expect(endStops({ ...ends, endDays: 0 }, stack, { today }).ended).toEqual([]);
  });

  it("uses the days of the options before the days of the layer", () => {
    const ends = { ...layer(stops("a", "2026-12-16"), stops("b", "2027-06-01")), endDays: 5 };
    expect(endStops(ends, stack, { today, days: 365 }).ended).toEqual(["a", "b"]);
    expect(endStops(ends, stack, { today, days: 0 }).ended).toEqual([]);
  });

  it("agrees with the warnings of the gate: each service that stops has the warning, or its plan ended", () => {
    for (const endDays of [0, 7, 30, 400]) {
      const ends = { ...layer(stops("a", "2026-11-10"), stops("b", "2026-11-20"), stops("c", "2026-12-20"), changes("key", "2026-11-20")), endDays };
      const faults = checkSpend(ends, stack, { today });
      const warned = faults.filter((fault) => fault.code === "end-soon" || fault.code === "end-past").map((fault) => fault.at);
      const stopping = warned.filter((part) => ends.services.find((service) => service.part === part)?.ends?.next === undefined);
      expect([...endStops(ends, stack, { today }).ended].sort()).toEqual(stopping.sort());
    }
  });

  it("gives the parts of stopped of the core, with the services that stop as the parts that are down", () => {
    const ends = layer(stops("a", "2026-12-01"), stops("c", "2026-11-20"));
    const result = endStops(ends, stack, { today });
    expect(result.ended).toEqual(["c", "a"]);
    expect(result.stopped).toEqual(stopped(stack, ["a", "c"]));
  });

  it("refuses a date of the check that is not a date, and does not change its arguments", () => {
    expect(() => endStops(SAMPLE_ENDS, SAMPLE_STACK, { today: "" })).toThrow(RangeError);
    const before = JSON.stringify([SAMPLE_ENDS, SAMPLE_STACK]);
    endStops(SAMPLE_ENDS, SAMPLE_STACK, { today: SAMPLE_TODAY });
    expect(JSON.stringify([SAMPLE_ENDS, SAMPLE_STACK])).toBe(before);
  });
});
