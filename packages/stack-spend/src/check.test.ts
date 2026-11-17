import { SAMPLE_STACK, STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkSpend, dayNumber, SPEND_CODES } from "./check.ts";
import { SPEND_SCHEMA, type Limit, type NextPlan, type Proof, type Service, type SpendLayer } from "./layer.ts";
import { SAMPLE_ENDS, SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";

const today = "2026-11-16";
const proof: Proof = { date: "2026-11-01", by: "The owner" };
const stack: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "a", kind: "account" },
    { id: "b", kind: "account" },
    { id: "program", kind: "service" },
  ],
};
const layer = (...services: Service[]): SpendLayer => ({ schema: SPEND_SCHEMA, currency: "USD", kinds: [], proofDays: 90, services });
const codes = (value: SpendLayer, date: string = today): string[] => checkSpend(value, stack, { today: date }).map((fault) => `${fault.code} ${fault.at}`);

describe("dayNumber", () => {
  it("gives the count of days from 1970-01-01", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect((dayNumber("2026-11-16") ?? 0) - (dayNumber("2026-11-01") ?? 0)).toBe(15);
    expect((dayNumber("2028-03-01") ?? 0) - (dayNumber("2028-02-28") ?? 0)).toBe(2);
  });

  it("gives nothing for a text that is not a date of the calendar", () => {
    for (const text of ["", "2026-11", "2026-2-3", "2026-02-30", "2026-13-01", "2026-11-16T00:00:00Z", "16-11-2026"]) expect(dayNumber(text)).toBeUndefined();
  });
});

describe("checkSpend: the records", () => {
  it("passes a layer with a free, a fixed and a limited service", () => {
    const good = layer({ part: "a", billing: "free", proof }, { part: "b", billing: "metered", limits: [{ kind: "provider", amount: 5 }], proof }, { part: "program", billing: "fixed", price: 3, proof });
    expect(checkSpend(good, stack, { today })).toEqual([]);
  });

  it("finds a record that names no part", () => {
    expect(codes(layer({ part: "none", billing: "free", proof }))).toEqual(["service-part none"]);
  });

  it("finds two records for one part, and examines only the first", () => {
    expect(codes(layer({ part: "a", billing: "free", proof }, { part: "a", billing: "metered" }))).toEqual(["service-duplicate a"]);
  });

  it("finds each part of a covered kind with no record", () => {
    const value: SpendLayer = { ...layer({ part: "a", billing: "free", proof }), kinds: ["account"] };
    expect(checkSpend(value, stack, { today })).toEqual([{ level: "error", code: "part-no-service", at: "b", message: 'The part "b" has the kind "account", and it has no cost record.' }]);
    expect(codes({ ...value, kinds: ["account", "service"] })).toEqual(["part-no-service b", "part-no-service program"]);
  });

  it("finds a fixed service with no price, and a price that is not 0 or more", () => {
    expect(codes(layer({ part: "a", billing: "fixed", proof }))).toEqual(["price a"]);
    for (const price of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(codes(layer({ part: "a", billing: "fixed", price, proof }))).toEqual(["price a"]);
    expect(codes(layer({ part: "a", billing: "fixed", price: 0, proof }))).toEqual([]);
  });

  it("finds an amount that is not 0 or more, in a limit and in a wanted limit", () => {
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "provider", amount: -5 }], proof }))).toEqual(["amount a"]);
    expect(codes(layer({ part: "a", billing: "free", wanted: { kind: "provider", amount: Number.NaN }, proof }))).toEqual(["amount a", "limit-wanted a"]);
  });
});

describe("checkSpend: the limits", () => {
  it("finds a metered service with no limit", () => {
    const faults = checkSpend(layer({ part: "a", billing: "metered", proof }), stack, { today });
    expect(faults).toEqual([{ level: "error", code: "limit-none", at: "a", message: 'The cost of "a" grows with the use, and it has no limit.' }]);
  });

  it("finds a metered service whose only limit is an alert", () => {
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "alert", amount: 5 }], proof }))).toEqual(["limit-alert a"]);
  });

  it("passes an alert next to a hard limit", () => {
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "alert", amount: 5 }, { kind: "provider", amount: 10 }], proof }))).toEqual([]);
  });

  it("finds a balance with automatic recharge, also next to a hard limit", () => {
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "prepaid", amount: 20, recharge: true }], proof }))).toEqual(["limit-recharge a"]);
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "prepaid", amount: 20, recharge: true }, { kind: "provider", amount: 10 }], proof }))).toEqual(["limit-recharge a"]);
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "prepaid", amount: 20, recharge: false }], proof }))).toEqual([]);
  });

  it("finds a stop by code with no part, or with an unknown part", () => {
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "code", amount: 10 }], proof }))).toEqual(["limit-stop a"]);
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "code", amount: 10, stop: "none" }], proof }))).toEqual(["limit-stop a"]);
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "code", amount: 10, stop: "program" }], proof }))).toEqual([]);
  });

  it("finds a wanted limit, with its kind and its amount, and gives no second fault for the limit", () => {
    const faults = checkSpend(layer({ part: "a", billing: "metered", wanted: { kind: "provider", amount: 55 }, proof }), stack, { today });
    expect(faults.map((fault) => fault.message)).toEqual(['The wanted limit of "a" (provider, 55 USD for a month) is not in force.']);
  });

  it("finds a wanted limit also when a limit is in force", () => {
    expect(codes(layer({ part: "a", billing: "metered", limits: [{ kind: "provider", amount: 100 }], wanted: { kind: "provider", amount: 55 }, proof }))).toEqual(["limit-wanted a"]);
  });

  it("asks no limit of a free or a fixed service", () => {
    expect(codes(layer({ part: "a", billing: "free", proof }, { part: "b", billing: "fixed", price: 1, proof }))).toEqual([]);
  });
});

describe("checkSpend: the proofs", () => {
  it("finds a record with no proof", () => {
    expect(codes(layer({ part: "a", billing: "free" }))).toEqual(["proof-none a"]);
  });

  it("finds a date that is not a date, and a date after the check", () => {
    expect(codes(layer({ part: "a", billing: "free", proof: { date: "last week", by: "The owner" } }))).toEqual(["proof-date a"]);
    expect(codes(layer({ part: "a", billing: "free", proof: { date: "2026-11-17", by: "The owner" } }))).toEqual(["proof-date a"]);
    expect(codes(layer({ part: "a", billing: "free", proof: { date: "2026-11-16", by: "The owner" } }))).toEqual([]);
  });

  it("finds a proof that is older than the largest age, and passes a proof of that age", () => {
    const service: Service = { part: "a", billing: "free", proof: { date: "2026-08-18", by: "The owner" } };
    expect(codes(layer(service), "2026-11-16")).toEqual([]);
    const faults = checkSpend(layer(service), stack, { today: "2026-11-17" });
    expect(faults.map((fault) => fault.message)).toEqual(['The proof of "a" is 91 days old. The largest age is 90 days.']);
  });

  it("refuses a date of the check that is not a date", () => {
    expect(() => checkSpend(layer(), stack, { today: "today" })).toThrow(RangeError);
  });
});

describe("checkSpend: the end of a plan", () => {
  const faultsOf = (value: SpendLayer, date: string = today): unknown[] => checkSpend(value, stack, { today: date }).map((fault) => [fault.level, fault.code, fault.message]);

  it("passes a plan that ends after the days of warning, with a plan after the end or with none", () => {
    expect(codes(layer({ part: "a", billing: "free", ends: { date: "2026-12-17" }, proof }))).toEqual([]);
    expect(codes(layer({ part: "a", billing: "free", ends: { date: "2027-06-01", next: { billing: "fixed", price: 20 } }, proof }))).toEqual([]);
    expect(codes(layer({ part: "a", billing: "free", ends: { date: "2027-06-01", next: { billing: "metered", limits: [{ kind: "provider", amount: 5 }] } }, proof }))).toEqual([]);
  });

  it("gives a warning for a plan that ends in the days of warning, and the default is 30 days", () => {
    const ends = (date: string): SpendLayer => layer({ part: "a", billing: "free", ends: { date }, proof });
    expect(faultsOf(ends("2026-12-16"))).toEqual([["warning", "end-soon", 'The plan of "a" ends on 2026-12-16, in 30 days. Then the provider stops the service.']]);
    expect(faultsOf(ends("2026-11-17"))).toEqual([["warning", "end-soon", 'The plan of "a" ends on 2026-11-17, in 1 day. Then the provider stops the service.']]);
    expect(faultsOf(ends("2026-11-16"))).toEqual([["warning", "end-soon", 'The plan of "a" ends on 2026-11-16, on the date of the check. Then the provider stops the service.']]);
    expect(faultsOf(ends("2026-12-17"))).toEqual([]);
  });

  it("tells in the warning that the cost changes, for a service with a plan after the end", () => {
    const paid = layer({ part: "a", billing: "free", ends: { date: "2026-11-30", next: { billing: "fixed", price: 20 } }, proof });
    expect(faultsOf(paid)).toEqual([["warning", "end-soon", 'The plan of "a" ends on 2026-11-30, in 14 days. Then the cost changes.']]);
  });

  it("uses the days of warning of the layer", () => {
    const ends = (endDays: number, date: string): string[] => codes({ ...layer({ part: "a", billing: "free", ends: { date }, proof }), endDays });
    expect(ends(7, "2026-11-23")).toEqual(["end-soon a"]);
    expect(ends(7, "2026-11-24")).toEqual([]);
    expect(ends(0, "2026-11-16")).toEqual(["end-soon a"]);
    expect(ends(0, "2026-11-17")).toEqual([]);
    expect(ends(400, "2027-11-16")).toEqual(["end-soon a"]);
  });

  it("finds a plan that ended before the date of the check", () => {
    const ended = layer({ part: "a", billing: "free", ends: { date: "2026-11-15" }, proof });
    expect(faultsOf(ended)).toEqual([["error", "end-past", 'The plan of "a" ended on 2026-11-15. The record gives the cost before the end.']]);
    expect(codes(ended, "2026-11-15")).toEqual(["end-soon a"]);
  });

  it("finds a date of an end that is not a date", () => {
    for (const date of ["", "2026-12", "2026-02-30", "December"]) expect(codes(layer({ part: "a", billing: "free", ends: { date }, proof }))).toEqual(["end-date a"]);
  });

  it("finds a cost after the end that grows with the use and has no hard limit", () => {
    const next = (...limits: Limit[]): SpendLayer => layer({ part: "a", billing: "free", ends: { date: "2027-06-01", next: { billing: "metered", limits } }, proof });
    expect(faultsOf(next())).toEqual([["error", "end-open", 'The plan of "a" ends on 2027-06-01. After the end, the cost grows with the use, and it has no hard limit.']]);
    expect(codes(next({ kind: "alert", amount: 5 }))).toEqual(["end-open a"]);
    expect(codes(next({ kind: "prepaid", amount: 5, recharge: true }))).toEqual(["end-open a"]);
    expect(codes(next({ kind: "prepaid", amount: 5 }))).toEqual([]);
    expect(codes(next({ kind: "code", amount: 5, stop: "program" }))).toEqual([]);
    expect(codes(layer({ part: "a", billing: "free", ends: { date: "2027-06-01", next: { billing: "metered" } }, proof }))).toEqual(["end-open a"]);
  });

  it("does not use a limit of the plan before the end for the plan after the end, and the reverse", () => {
    const before = layer({ part: "a", billing: "metered", limits: [{ kind: "provider", amount: 5 }], ends: { date: "2027-06-01", next: { billing: "metered" } }, proof });
    expect(codes(before)).toEqual(["end-open a"]);
    const after = layer({ part: "a", billing: "metered", ends: { date: "2027-06-01", next: { billing: "metered", limits: [{ kind: "provider", amount: 5 }] } }, proof });
    expect(codes(after)).toEqual(["limit-none a"]);
  });

  it("gives the warning and the fault of the cost for a plan that ends soon with an open cost", () => {
    const open = layer({ part: "a", billing: "free", ends: { date: "2026-11-30", next: { billing: "metered" } }, proof });
    expect(codes(open)).toEqual(["end-soon a", "end-open a"]);
    expect(codes(open, "2026-12-01")).toEqual(["end-past a", "end-open a"]);
  });

  it("examines the price and the limits of the plan after the end", () => {
    const next = (plan: NextPlan): unknown[] => faultsOf(layer({ part: "a", billing: "free", ends: { date: "2027-06-01", next: plan }, proof }));
    expect(next({ billing: "fixed" })).toEqual([["error", "price", 'The service "a" has a fixed price after the end of its plan, and its record gives no price.']]);
    expect(next({ billing: "fixed", price: -1 })).toEqual([["error", "price", 'The price -1 of "a" after the end of its plan is less than 0 or not finite.']]);
    expect(next({ billing: "metered", limits: [{ kind: "provider", amount: -2 }] })).toEqual([["error", "amount", 'The amount -2 of a limit of "a" after the end of its plan is less than 0 or not finite.']]);
    expect(next({ billing: "metered", limits: [{ kind: "code", amount: 2 }] })).toEqual([["error", "limit-stop", 'A stop by code of "a" after the end of its plan does not name the part that stops the use.']]);
    expect(next({ billing: "metered", limits: [{ kind: "code", amount: 2, stop: "none" }] })).toEqual([["error", "limit-stop", 'A stop by code of "a" after the end of its plan names "none", which is no part of the stack.']]);
  });

  it("gives no fault of an end for the second record of a part", () => {
    expect(codes(layer({ part: "a", billing: "free", proof }, { part: "a", billing: "free", ends: { date: "2026-01-01", next: { billing: "metered" } }, proof }))).toEqual(["service-duplicate a"]);
  });

  it("finds the three faults of the sample of ends: the warnings do not stop the gate, and the open cost does", () => {
    const faults = checkSpend(SAMPLE_ENDS, SAMPLE_STACK, { today: SAMPLE_TODAY });
    expect(faults.map((fault) => `${fault.level} ${fault.code} ${fault.at}`)).toEqual(["warning end-soon cloud-account", "error end-open cloud-account", "warning end-soon call-account"]);
    for (const fault of faults) expect(SPEND_CODES).toContain(fault.code);
  });

  it("gives only warnings for the sample of ends with a hard limit after the end of the trial", () => {
    const services = SAMPLE_ENDS.services.map((service) => (service.part === "cloud-account" ? { ...service, ends: { date: "2026-12-01", next: { billing: "metered" as const, limits: [{ kind: "provider" as const, amount: 5 }] } } } : service));
    const faults = checkSpend({ ...SAMPLE_ENDS, services }, SAMPLE_STACK, { today: SAMPLE_TODAY });
    expect(faults.map((fault) => fault.level)).toEqual(["warning", "warning"]);
  });
});

describe("checkSpend: the sample", () => {
  it("finds the two faults of the sample, in the sequence of the records", () => {
    const faults = checkSpend(SAMPLE_SPEND, SAMPLE_STACK, { today: SAMPLE_TODAY });
    expect(faults.map((fault) => `${fault.code} ${fault.at}`)).toEqual(["limit-alert cloud-account", "limit-recharge call-account"]);
  });

  it("uses only its own codes, and each fault is an error", () => {
    const bad = layer({ part: "none", billing: "fixed", price: -1, limits: [{ kind: "code", amount: -1 }, { kind: "prepaid", amount: 1, recharge: true }], wanted: { kind: "alert", amount: 1 } }, { part: "none", billing: "free" }, { part: "a", billing: "metered", proof: { date: "x", by: "y" } });
    const faults = checkSpend({ ...bad, kinds: ["account"] }, stack, { today });
    expect(faults.length).toBeGreaterThan(7);
    for (const fault of faults) {
      expect(SPEND_CODES).toContain(fault.code);
      expect(fault.level).toBe("error");
    }
  });

  it("does not change its arguments", () => {
    const before = JSON.stringify([SAMPLE_SPEND, SAMPLE_STACK]);
    checkSpend(SAMPLE_SPEND, SAMPLE_STACK, { today: SAMPLE_TODAY });
    expect(JSON.stringify([SAMPLE_SPEND, SAMPLE_STACK])).toBe(before);
  });
});
