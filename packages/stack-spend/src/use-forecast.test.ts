import { STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkSpend } from "./check.ts";
import { SPEND_SCHEMA, type Limit, type Service, type SpendLayer } from "./layer.ts";
import { RATE_DAYS, type UseOptions, type UseRead, type UseSource } from "./reads.ts";
import { SAMPLE_READS, SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";
import { parseReads, parseSpend } from "./schema.ts";
import { evaluateService } from "./states.ts";
import { checkUse } from "./use-check.ts";
import { BASE_DAY, BASE_GROSS, GROSS_USED, LAST_DAY, LIMIT_DAY, LIMIT_IN_MONTH, MONTH_END, USE_RATE, useForecasts, type UseForecast } from "./use-forecast.ts";
import { daysOf } from "./use-plan.ts";
import { useSpace } from "./use.ts";

const today = "2026-11-16";
const layer = (...services: Service[]): SpendLayer => ({ schema: SPEND_SCHEMA, currency: "USD", kinds: [], proofDays: 90, services });
const metered = (part: string, ...limits: Limit[]): Service => ({ part, billing: "metered", limits });
const capped = (part: string, amount: number, allowance?: number): Service => ({ ...metered(part, { kind: "provider", amount }), ...(allowance === undefined ? {} : { allowance }) });
const read = (part: string, source: UseSource, amount: number, date: string, gross?: number): UseRead => ({ part, source, amount, date, ...(gross === undefined ? {} : { gross }) });
/** A read of the provider of the service `a` on a day of November 2026. */
const on = (day: number, amount: number, gross?: number): UseRead => read("a", "provider", amount, `2026-11-${String(day).padStart(2, "0")}`, gross);
const forecastOf = (service: Service, reads: readonly UseRead[], options: Partial<UseOptions> = {}): UseForecast | undefined => useForecasts(layer(service), reads, { today, ...options })[0];

describe("daysOf", () => {
  it("gives the count of days of a month", () => {
    expect(daysOf("2026-11")).toBe(30);
    expect(daysOf("2026-12")).toBe(31);
    expect(daysOf("2026-02")).toBe(28);
    expect(daysOf("2028-02")).toBe(29);
    expect(daysOf("2100-02")).toBe(28);
    expect(daysOf("2000-02")).toBe(29);
  });
});

describe("the rate of the use of a service", () => {
  it("counts from the start of the month when the month has one read", () => {
    expect(forecastOf(capped("a", 10), [on(10, 2)])).toEqual({ part: "a", gross: 2, from: 0, to: 10, rate: 0.2, end: 6 });
  });

  it("counts from the newest read that is rateDays older than the newest read, or more", () => {
    // The mean of the month is 8 / 15. The rate of the last 7 days is 7 / 7.
    expect(forecastOf(capped("a", 20), [on(8, 1), on(15, 8)])).toEqual({ part: "a", gross: 8, from: 8, to: 15, rate: 1, end: 23, limitDate: "2026-11-27" });
    expect(forecastOf(capped("a", 20), [on(1, 0), on(8, 1), on(15, 8)])).toMatchObject({ from: 8, to: 15, rate: 1 });
    expect(forecastOf(capped("a", 20), [on(2, 1), on(15, 8)])).toMatchObject({ from: 2, to: 15, rate: 7 / 13 });
  });

  it("counts from the start of the month when no read is that old", () => {
    expect(forecastOf(capped("a", 20), [on(12, 6), on(15, 8)])).toMatchObject({ gross: 8, from: 0, to: 15, rate: 8 / 15 });
    expect(RATE_DAYS).toBe(7);
  });

  it("uses the option rateDays", () => {
    expect(forecastOf(capped("a", 20), [on(12, 6), on(15, 8)], { rateDays: 3 })).toMatchObject({ from: 12, to: 15, rate: 2 / 3 });
    expect(forecastOf(capped("a", 20), [on(8, 1), on(15, 8)], { rateDays: 8 })).toMatchObject({ from: 0, to: 15, rate: 8 / 15 });
  });

  it("is 0 when the use did not grow", () => {
    expect(forecastOf(capped("a", 10), [on(8, 4), on(15, 4)])).toEqual({ part: "a", gross: 4, from: 8, to: 15, rate: 0, end: 4 });
    expect(forecastOf(capped("a", 10), [on(15, 0)])).toEqual({ part: "a", gross: 0, from: 0, to: 15, rate: 0, end: 0 });
  });

  it("uses the largest amount of the two sources", () => {
    const reads = [read("a", "count", 4, "2026-11-15"), read("a", "provider", 6, "2026-11-15")];
    expect(forecastOf(capped("a", 20), reads)).toMatchObject({ gross: 6, from: 0, to: 15, rate: 0.4 });
  });

  it("has no value when the month has no read", () => {
    expect(forecastOf(capped("a", 10), [])).toEqual({ part: "a" });
    expect(forecastOf(capped("a", 10), [read("a", "provider", 9, "2026-10-31"), read("a", "provider", 9, "2025-11-10")])).toEqual({ part: "a" });
  });

  it("does not count a read with a fault or a read of a different service", () => {
    const bad = [on(10, -1), read("a", "provider", 3, "2026-11-17"), read("a", "provider", 5, "2026-11-10", 4), read("b", "provider", 9, "2026-11-10")];
    expect(useForecasts(layer(capped("a", 10), capped("b", 10)), bad, { today })).toEqual([{ part: "a" }, { part: "b", gross: 9, from: 0, to: 10, rate: 0.9, end: 27, limitDate: "2026-11-12" }]);
  });

  it("refuses a count of days that is not valid", () => {
    for (const rateDays of [0, 0.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => useForecasts(layer(capped("a", 10)), [], { today, rateDays })).toThrow(RangeError);
      expect(() => checkUse(layer(capped("a", 10)), [], { today, rateDays })).toThrow(RangeError);
    }
    expect(() => useForecasts(layer(capped("a", 10)), [], { today: "2026-13-01" })).toThrow(RangeError);
  });
});

describe("the day on which the cost reaches the hard limit", () => {
  it("is a date of the month of the check", () => {
    expect(forecastOf(capped("a", 10), [on(10, 5)])).toEqual({ part: "a", gross: 5, from: 0, to: 10, rate: 0.5, end: 15, limitDate: "2026-11-20" });
  });

  it("is the first day on which the cost is at the limit, or above it", () => {
    // 10 + (10 - 4) / 0.4 is 25. 10 + (10 - 4.1) / 0.41 is 24.39, so the limit comes on day 25.
    expect(forecastOf(capped("a", 10), [on(10, 4)])).toMatchObject({ limitDate: "2026-11-25" });
    expect(forecastOf(capped("a", 10), [on(10, 4.1)])).toMatchObject({ limitDate: "2026-11-25" });
    expect(forecastOf(capped("a", 10), [on(10, 3.9)])).toMatchObject({ limitDate: "2026-11-26" });
  });

  it("is absent when the cost stays below the limit until the end of the month", () => {
    // 10 + (10 - 3.3) / 0.33 is 30.3: the day after the last day of November.
    expect(forecastOf(capped("a", 10), [on(10, 3.3)])).not.toHaveProperty("limitDate");
    expect(forecastOf(capped("a", 10), [on(10, 10 / 3)])).toMatchObject({ limitDate: "2026-11-30" });
  });

  it("is absent when the cost is at the limit at the newest read, or above it", () => {
    expect(forecastOf(capped("a", 10), [on(10, 10)])).toEqual({ part: "a", gross: 10, from: 0, to: 10, rate: 1, end: 30 });
    expect(forecastOf(capped("a", 10), [on(10, 12)])).not.toHaveProperty("limitDate");
  });

  it("is absent for a service with no hard limit", () => {
    expect(forecastOf(metered("a", { kind: "alert", amount: 5 }), [on(10, 5)])).toEqual({ part: "a", gross: 5, from: 0, to: 10, rate: 0.5, end: 15 });
  });

  it("uses the days of the month of the check", () => {
    const december = [read("a", "provider", 3.3, "2026-12-10")];
    expect(useForecasts(layer(capped("a", 10)), december, { today: "2026-12-10" })[0]).toMatchObject({ limitDate: "2026-12-31" });
    const february = [read("a", "provider", 3.6, "2027-02-10")];
    expect(useForecasts(layer(capped("a", 10)), february, { today: "2027-02-10" })[0]).toMatchObject({ limitDate: "2027-02-28" });
    expect(useForecasts(layer(capped("a", 10)), [read("a", "provider", 3.5, "2027-02-10")], { today: "2027-02-10" })[0]).not.toHaveProperty("limitDate");
  });
});

describe("the allowance of a plan", () => {
  const december = (day: number, amount: number, gross?: number): UseRead => read("a", "provider", amount, `2026-12-${String(day).padStart(2, "0")}`, gross);
  const at = (reads: readonly UseRead[], service: Service = capped("a", 60, 20)): UseForecast | undefined => useForecasts(layer(service), reads, { today: "2026-12-08" })[0];

  it("gives a forecast from the gross amount while the cost is 0", () => {
    // 16 + 2 * 23 - 20 is 42. The limit of 60 comes at a gross amount of 80: on day 40.
    expect(at([december(1, 0, 2), december(8, 0, 16)])).toEqual({ part: "a", gross: 16, from: 1, to: 8, rate: 2, end: 42 });
  });

  it("gives the day on which the cost after the allowance reaches the limit", () => {
    // 22 + 3 * 23 - 20 is 71. 8 + (80 - 22) / 3 is 27.3.
    expect(at([december(1, 0, 1), december(8, 2, 22)])).toEqual({ part: "a", gross: 22, from: 1, to: 8, rate: 3, end: 71, limitDate: "2026-12-28" });
  });

  it("gives 0 for a use that stays below the allowance", () => {
    expect(at([december(8, 0, 4)])).toEqual({ part: "a", gross: 4, from: 0, to: 8, rate: 0.5, end: 0 });
  });

  it("adds the allowance to a read with an amount above 0 and no gross amount", () => {
    expect(at([december(8, 1.5)])).toMatchObject({ gross: 21.5, from: 0, to: 8, rate: 21.5 / 8 });
  });

  it("has no value for a read with the amount 0 and no gross amount", () => {
    expect(at([december(8, 0)])).toEqual({ part: "a" });
    expect(at([december(1, 0), december(8, 1.5)])).toMatchObject({ gross: 21.5, from: 0, to: 8 });
  });

  it("uses the amount of a read of a service with no allowance", () => {
    expect(at([december(8, 0)], capped("a", 60))).toEqual({ part: "a", gross: 0, from: 0, to: 8, rate: 0, end: 0 });
    expect(at([december(8, 4)], capped("a", 60, 0))).toMatchObject({ gross: 4, rate: 0.5, end: 15.5 });
  });

  it("is a field of the format, and the gross amount is a field of a read", () => {
    expect(parseSpend(layer(capped("meter", 60, 20)))).toMatchObject({ ok: true });
    expect(parseSpend(layer({ ...capped("meter", 60), allowance: "20" } as unknown as Service))).toMatchObject({ ok: false });
    expect(parseReads([december(8, 1.5, 21.5)])).toMatchObject({ ok: true });
    expect(parseReads([{ ...december(8, 1.5), gross: "21.5" }])).toMatchObject({ ok: false });
  });

  it("must be 0 or more", () => {
    const stack: Stack = { schema: STACK_SCHEMA, parts: [{ id: "a", kind: "account" }] };
    const faults = (allowance: number): string[] => checkSpend(layer({ ...capped("a", 60, allowance), proof: { date: "2026-12-01", by: "The owner" } }), stack, { today: "2026-12-08" }).map((fault) => `${fault.level} ${fault.code}: ${fault.message}`);
    expect(faults(20)).toEqual([]);
    expect(faults(0)).toEqual([]);
    expect(faults(-1)).toEqual(['error amount: The allowance -1 of "a" is less than 0 or not finite.']);
    expect(faults(Number.POSITIVE_INFINITY)).toEqual(['error amount: The allowance Infinity of "a" is less than 0 or not finite.']);
  });
});

describe("the programs of the forecast", () => {
  it("give the values of a service of the tree", () => {
    const tree = useSpace(layer(capped("a", 20)), [on(8, 1), on(15, 8)], { today });
    const value = (program: Parameters<typeof evaluateService>[0]): unknown => {
      const result = evaluateService(program, tree, "a");
      return result.ok ? result.value : undefined;
    };
    expect([GROSS_USED, LAST_DAY, BASE_DAY, BASE_GROSS, USE_RATE, MONTH_END, LIMIT_DAY, LIMIT_IN_MONTH].map(value)).toEqual([8, 15, 8, 1, 1, 23, 27, true]);
  });

  it("give an error value for a service with no read", () => {
    const tree = useSpace(layer(capped("a", 20)), [], { today });
    for (const program of [GROSS_USED, LAST_DAY, BASE_DAY, BASE_GROSS, USE_RATE, MONTH_END, LIMIT_DAY, LIMIT_IN_MONTH]) expect(evaluateService(program, tree, "a").ok).toBe(false);
  });
});

describe("the forecast and the limit", () => {
  const amounts = fc.array(fc.record({ day: fc.integer({ min: 1, max: 30 }), gross: fc.integer({ min: 0, max: 400 }) }), { minLength: 1, maxLength: 6 });

  it("agrees with the cost of each day at the rate of the reads", () => {
    fc.assert(
      fc.property(amounts, fc.integer({ min: 1, max: 300 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 10 }), (points, limit, allowance, rateDays) => {
        const reads = points.map((point) => on(point.day, Math.max(0, point.gross - allowance), point.gross));
        const forecast = useForecasts(layer(capped("a", limit, allowance)), reads, { today: "2026-11-30", rateDays })[0];
        if (forecast?.gross === undefined || forecast.rate === undefined || forecast.to === undefined || forecast.end === undefined) return false;
        const { gross, rate, to } = forecast;
        // The cost at the end of a day, at the rate of the reads.
        const cost = (day: number): number => gross + rate * (day - to) - allowance;
        const tolerance = 1e-6;
        expect(rate).toBeGreaterThanOrEqual(0);
        expect(forecast.end).toBeCloseTo(Math.max(0, cost(30)), 6);
        if (forecast.limitDate === undefined) {
          // The cost is at the limit at the newest read, or it stays below the limit until the end of the month.
          return cost(to) >= limit - tolerance || cost(30) < limit + tolerance;
        }
        const day = Number(forecast.limitDate.slice(8));
        return forecast.limitDate.startsWith("2026-11-") && day > to && day <= 30 && cost(day) >= limit - tolerance && cost(day - 1) < limit + tolerance;
      }),
      { numRuns: 300 },
    );
  });

  it("does not come later when the newest read shows more use", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 1, max: 29 }), (amount, more, day) => {
        const date = (reads: readonly UseRead[]): string => forecastOf(capped("a", 250), reads)?.limitDate ?? "2026-12-01";
        const less = [on(day, amount)];
        // A date of the form YYYY-MM-DD has the sequence of its text. A cost at the limit has no date: it is not later.
        return amount + more >= 250 || date([on(day, amount + more)]) <= date(less);
      }),
      { numRuns: 300 },
    );
  });
});

describe("the gate of the forecast", () => {
  const faults = (service: Service, reads: readonly UseRead[], options: Partial<UseOptions> = {}): string[] =>
    checkUse(layer(service), reads, { today, ...options }).map((fault) => `${fault.level} ${fault.code}: ${fault.message}`);

  it("gives a warning when the cost reaches the hard limit before the month ends", () => {
    expect(faults(capped("a", 10), [on(10, 4)])).toEqual(['warning use-forecast: The reads of "a" show a use of 0.4 USD for each day. At that rate, the cost reaches the hard limit of 10 USD on 2026-11-25, and the service stops.']);
  });

  it("tells when an old read gives a date before the check", () => {
    // 10 + (10 - 9) / 0.9 is 11.1, and the check is on day 16.
    expect(faults(capped("a", 10), [on(10, 9)])).toEqual([
      'warning use-level: The used amount of "a" in the month 2026-11 is 9 USD: 80 percent of its hard limit of 10 USD, or more.',
      'warning use-forecast: The reads of "a" show a use of 0.9 USD for each day. At that rate, the cost reached the hard limit of 10 USD on 2026-11-12, before the date of the check. Make a new read.',
    ]);
    expect(faults(capped("a", 10), [on(16, 9.5)])[1]).toContain("the cost reaches the hard limit of 10 USD on 2026-11-17, and the service stops.");
  });

  it("gives the warning with the level of the used amount", () => {
    expect(faults(capped("a", 10), [on(10, 5)]).map((fault) => fault.split(":")[0])).toEqual(["warning use-level", "warning use-forecast"]);
  });

  it("gives the rate with three digits", () => {
    // The rate is 7 / 13. 15 + (12 - 8) / (7 / 13) is 22.4.
    expect(faults(capped("a", 12), [on(2, 1), on(15, 8)])[1]).toContain('The reads of "a" show a use of 0.538 USD for each day. At that rate, the cost reaches the hard limit of 12 USD on 2026-11-23');
  });

  it("gives no warning when the cost stays below the limit", () => {
    expect(faults(capped("a", 10), [on(10, 3.3)])).toEqual([]);
    expect(faults(capped("a", 10), [on(8, 4), on(15, 4)])).toEqual([]);
  });

  it("gives no warning when the cost is at the limit, or above it", () => {
    expect(faults(capped("a", 10), [on(10, 10)]).map((fault) => fault.split(":")[0])).toEqual(["warning use-level"]);
    expect(faults(capped("a", 10), [on(10, 12)]).map((fault) => fault.split(":")[0])).toEqual(["error use-over"]);
  });

  it("gives the warning while the cost is 0 below an allowance", () => {
    const reads = [read("a", "provider", 0, "2026-12-01", 0.5), read("a", "provider", 0, "2026-12-08", 18)];
    // The rate is 17.5 / 7. The limit comes at a gross amount of 60: 8 + (60 - 18) / 2.5 is 24.8.
    expect(faults(capped("a", 40, 20), reads, { today: "2026-12-08" })).toEqual([
      'warning use-forecast: The reads of "a" show a use of 2.5 USD for each day. At that rate, the cost reaches the hard limit of 40 USD on 2026-12-25, and the service stops.',
    ]);
    expect(faults(capped("a", 40, 20), [read("a", "provider", 0, "2026-12-08", 12)], { today: "2026-12-08" })).toEqual([]);
  });

  it("gives an error for a gross amount that is less than the amount", () => {
    expect(faults(capped("a", 10), [on(10, 5, 4)])).toEqual(['error read-amount: The amount 5 of a read of "a" is less than 0 or not finite. Or its gross amount 4 is less than its amount or not finite.', 'warning use-none: No read gives the used amount of "a" in the month 2026-11.']);
    expect(faults(capped("a", 10), [on(10, 5, Number.NaN)]).map((fault) => fault.split(":")[0])).toEqual(["error read-amount", "warning use-none"]);
  });

  it("gives no new fault for the sample", () => {
    expect(checkUse(SAMPLE_SPEND, SAMPLE_READS, { today: SAMPLE_TODAY }).map((fault) => fault.code)).toEqual(["use-level", "use-count"]);
    expect(useForecasts(SAMPLE_SPEND, SAMPLE_READS, { today: SAMPLE_TODAY })).toEqual([
      { part: "cloud-account", gross: 0, from: 0, to: 15, rate: 0, end: 0 },
      { part: "push-account" },
      { part: "call-account", gross: 5.2, from: 0, to: 16, rate: 0.325, end: 9.75 },
    ]);
  });
});
