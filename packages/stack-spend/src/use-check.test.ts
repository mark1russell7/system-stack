import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SPEND_SCHEMA, type Limit, type Service, type SpendLayer } from "./layer.ts";
import { USE_SOURCES, type UseOptions, type UseRead, type UseSource } from "./reads.ts";
import { SAMPLE_READS, SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";
import { checkUse, USE_CODES, type UseFault } from "./use-check.ts";

const today = "2026-11-16";
const layer = (...services: Service[]): SpendLayer => ({ schema: SPEND_SCHEMA, currency: "USD", kinds: [], proofDays: 90, services });
const metered = (part: string, ...limits: Limit[]): Service => ({ part, billing: "metered", limits });
const capped = (part: string, amount: number): Service => metered(part, { kind: "provider", amount });
const read = (part: string, source: UseSource, amount: number, date: string = today): UseRead => ({ part, source, amount, date });
const faultsOf = (service: Service, reads: readonly UseRead[], options: Partial<UseOptions> = {}): UseFault[] => checkUse(layer(service), reads, { today, ...options });
const codesOf = (faults: readonly UseFault[]): string[] => faults.map((fault) => `${fault.level} ${fault.code}`);

describe("the faults of the reads", () => {
  it("tells a read of a part with no cost record", () => {
    expect(faultsOf(capped("a", 10), [read("x", "count", 1), read("a", "count", 1)])).toEqual([
      { level: "error", code: "read-part", at: "x", message: 'A read names "x", which has no cost record.' },
    ]);
  });

  it("tells an amount that is less than 0 or not finite", () => {
    const faults = faultsOf(capped("a", 10), [read("a", "count", -1), read("a", "count", Number.NaN), read("a", "provider", Number.POSITIVE_INFINITY), read("a", "count", 1)]);
    expect(codesOf(faults)).toEqual(["error read-amount", "error read-amount", "error read-amount"]);
    expect(faults[0]?.message).toBe('The amount -1 of a read of "a" is less than 0 or not finite.');
  });

  it("tells a date that is not a date, or that is after the date of the check", () => {
    const faults = faultsOf(capped("a", 10), [read("a", "count", 1, "2026-11-31"), read("a", "count", 1, "2026-11-17"), read("a", "count", 1)]);
    expect(codesOf(faults)).toEqual(["error read-date", "error read-date"]);
    expect(faults[1]?.message).toBe('The date "2026-11-17" of a read of "a" is not a date of the form YYYY-MM-DD, or it is after the date of the check, 2026-11-16.');
  });

  it("gives one fault for a read with more than one fault", () => {
    expect(codesOf(faultsOf(capped("a", 10), [read("x", "count", -1, "no date"), read("a", "count", -1, "no date"), read("a", "count", 1)]))).toEqual(["error read-part", "error read-amount"]);
  });
});

describe("the faults of the used amounts", () => {
  it("passes for a used amount below each level", () => {
    expect(faultsOf(capped("a", 10), [read("a", "count", 4), read("a", "provider", 4)])).toEqual([]);
  });

  it("gives a warning at each level of the hard limit", () => {
    expect(faultsOf(capped("a", 10), [read("a", "count", 5)])).toEqual([
      { level: "warning", code: "use-level", at: "a", message: 'The used amount of "a" in the month 2026-11 is 5 USD: 50 percent of its hard limit of 10 USD, or more.' },
    ]);
    expect(faultsOf(capped("a", 10), [read("a", "count", 8.5)])[0]?.message).toContain("80 percent");
    expect(faultsOf(capped("a", 10), [read("a", "count", 10)])[0]?.message).toContain("100 percent");
    expect(faultsOf(capped("a", 8), [read("a", "count", 1)], { levels: [0.125] })[0]?.message).toContain("12.5 percent");
  });

  it("fails when the used amount is more than the hard limit", () => {
    expect(faultsOf(capped("a", 10), [read("a", "provider", 12)])).toEqual([
      { level: "error", code: "use-over", at: "a", message: 'The used amount of "a" in the month 2026-11 is 12 USD. Its hard limit is 10 USD, so the limit did not hold.' },
    ]);
  });

  it("fails for each cost of the use when the hard limit is 0", () => {
    expect(codesOf(faultsOf(capped("a", 0), [read("a", "count", 0)]))).toEqual([]);
    expect(codesOf(faultsOf(capped("a", 0), [read("a", "count", 0.01)]))).toEqual(["error use-over"]);
  });

  it("gives a warning when the provider shows more than the stack counted", () => {
    expect(faultsOf(capped("a", 10), [read("a", "count", 1), read("a", "provider", 3)])).toEqual([
      { level: "warning", code: "use-count", at: "a", message: 'The provider shows 3 USD for "a" in the month 2026-11, and the stack counted 1 USD. The count does not have all the use.' },
    ]);
    expect(faultsOf(capped("a", 10), [read("a", "count", 3), read("a", "provider", 1)])).toEqual([]);
    expect(faultsOf(capped("a", 10), [read("a", "provider", 3)])).toEqual([]);
  });

  it("gives a warning for a metered service with no read of the month", () => {
    expect(faultsOf(capped("a", 10), [read("a", "count", 1, "2026-10-31")])).toEqual([{ level: "warning", code: "use-none", at: "a", message: 'No read gives the used amount of "a" in the month 2026-11.' }]);
  });

  it("gives a warning for an old read only when the options give the largest age", () => {
    const reads = [read("a", "count", 1, "2026-11-13"), read("a", "provider", 1, "2026-11-14")];
    expect(faultsOf(capped("a", 10), reads)).toEqual([]);
    expect(faultsOf(capped("a", 10), reads, { readDays: 2 })).toEqual([]);
    expect(faultsOf(capped("a", 10), reads, { readDays: 1 })).toEqual([
      { level: "warning", code: "use-old", at: "a", message: 'The age of the newest read of "a" is 2, in days. The largest age is 1.' },
    ]);
  });

  it("fails when a read shows a cost of the use of a free or fixed service", () => {
    const free: Service = { part: "a", billing: "free" };
    const fixed: Service = { part: "a", billing: "fixed", price: 4 };
    expect(faultsOf(free, [read("a", "provider", 0.5)])).toEqual([
      { level: "error", code: "use-billing", at: "a", message: 'The service "a" has the billing "free", and a read shows a cost of 0.5 USD for its use in the month 2026-11.' },
    ]);
    expect(codesOf(faultsOf(fixed, [read("a", "provider", 2)]))).toEqual(["error use-billing"]);
    expect(faultsOf(fixed, [read("a", "provider", 0)])).toEqual([]);
    expect(faultsOf(fixed, [])).toEqual([]);
    expect(faultsOf(free, [], { readDays: 0 })).toEqual([]);
  });

  it("gives no level and no failure of a limit for a service with no hard limit", () => {
    expect(faultsOf(metered("a", { kind: "alert", amount: 5 }), [read("a", "count", 900)])).toEqual([]);
  });

  it("gives the faults of the reads first, then the faults of the services in their sequence", () => {
    const faults = checkUse(layer(capped("a", 10), capped("b", 10), capped("c", 10)), [read("c", "provider", 11), read("x", "count", 1), read("a", "count", 9), read("a", "provider", 9.5, "2026-11-10")], { today, readDays: 0 });
    expect(faults.map((fault) => `${fault.code} ${fault.at}`)).toEqual(["read-part x", "use-level a", "use-count a", "use-none b", "use-over c"]);
    expect(checkUse(layer(capped("a", 10)), [read("a", "count", 9, "2026-11-10")], { today, readDays: 0 }).map((fault) => fault.code)).toEqual(["use-level", "use-old"]);
  });

  it("refuses options that are not correct", () => {
    expect(() => faultsOf(capped("a", 10), [], { today: "2026-13-01" })).toThrow(RangeError);
    expect(() => faultsOf(capped("a", 10), [], { levels: [0] })).toThrow("The level 0 is not a finite number above 0.");
    expect(() => faultsOf(capped("a", 10), [], { readDays: -1 })).toThrow("The largest age -1 of a read is less than 0 or not finite.");
  });
});

describe("the sample reads", () => {
  it("give the faults that the README shows", () => {
    expect(checkUse(SAMPLE_SPEND, SAMPLE_READS, { today: SAMPLE_TODAY }).map((fault) => `${fault.level} ${fault.code}: ${fault.message}`)).toEqual([
      'warning use-level: The used amount of "call-account" in the month 2026-11 is 5.2 USD: 50 percent of its hard limit of 10 USD, or more.',
      'warning use-count: The provider shows 5.2 USD for "call-account" in the month 2026-11, and the stack counted 4 USD. The count does not have all the use.',
    ]);
  });
});

describe("the gate on generated reads", () => {
  const stack = layer(capped("a", 10), metered("b", { kind: "code", amount: 3, stop: "x" }), metered("c", { kind: "alert", amount: 1 }), { part: "d", billing: "free" });
  const dates = ["2026-11-01", "2026-11-16", "2026-11-17", "2026-10-31", "2026-02-30"];
  const amount = fc.oneof(fc.double({ min: 0, max: 20, noNaN: true }), fc.constantFrom(-1, Number.NaN, 0, 3, 10));
  const oneRead: fc.Arbitrary<UseRead> = fc.record({ part: fc.constantFrom("a", "b", "c", "d", "x"), source: fc.constantFrom(...USE_SOURCES), amount, date: fc.constantFrom(...dates) });

  it("gives known codes, one fault at most for each read, and the same faults in each run", () => {
    fc.assert(
      fc.property(fc.array(oneRead, { maxLength: 12 }), fc.constantFrom(undefined, 0, 5), (reads, readDays) => {
        const faults = checkUse(stack, reads, { today, readDays });
        expect(checkUse(stack, reads, { today, readDays })).toEqual(faults);
        for (const fault of faults) expect(USE_CODES).toContain(fault.code);
        const readFaults = faults.filter((fault) => fault.code.startsWith("read-"));
        const faulty = reads.filter((item) => item.part === "x" || !Number.isFinite(item.amount) || item.amount < 0 || item.date === "2026-11-17" || item.date === "2026-02-30");
        expect(readFaults.length).toBe(faulty.length);
        const levels = new Map(USE_CODES.map((code) => [code, ["use-level", "use-count", "use-none", "use-old"].includes(code) ? "warning" : "error"] as const));
        for (const fault of faults) expect(fault.level).toBe(levels.get(fault.code));
      }),
      { seed: 20261116, numRuns: 200 },
    );
  });
});
