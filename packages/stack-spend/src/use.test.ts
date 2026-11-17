import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { SPEND_SCHEMA, type Limit, type Service, type SpendLayer } from "./layer.ts";
import { USE_LEVELS, USE_SOURCES, type UseOptions, type UseRead, type UseSource } from "./reads.ts";
import { SAMPLE_READS, SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";
import { evaluateService } from "./states.ts";
import { COUNT_USED, LEVEL_TOLERANCE, PROVIDER_USED, READ_AGE, USE_LEVEL, USE_OVER, USE_SHARE, USED, useSpace, useStates, type UseState } from "./use.ts";

const today = "2026-11-16";
const layer = (...services: Service[]): SpendLayer => ({ schema: SPEND_SCHEMA, currency: "USD", kinds: [], proofDays: 90, services });
const metered = (part: string, ...limits: Limit[]): Service => ({ part, billing: "metered", limits });
const capped = (part: string, amount: number): Service => metered(part, { kind: "provider", amount });
const read = (part: string, source: UseSource, amount: number, date: string = today): UseRead => ({ part, source, amount, date });
const stateOf = (service: Service, reads: readonly UseRead[], options: Partial<UseOptions> = {}): UseState | undefined => useStates(layer(service), reads, { today, ...options })[0];

describe("the used amount of a service", () => {
  it("is the larger of the count of the stack and the amount of the provider", () => {
    expect(stateOf(capped("a", 10), [read("a", "count", 4), read("a", "provider", 7)])).toMatchObject({ count: 4, provider: 7, used: 7 });
    expect(stateOf(capped("a", 10), [read("a", "count", 7), read("a", "provider", 4)])).toMatchObject({ count: 7, provider: 4, used: 7 });
  });

  it("is the amount of one source when the other source has no read", () => {
    expect(stateOf(capped("a", 10), [read("a", "count", 4)])).toEqual({ part: "a", billing: "metered", count: 4, used: 4, limit: 10, share: 0.4, over: false, age: 0 });
    expect(stateOf(capped("a", 10), [read("a", "provider", 3)])).toEqual({ part: "a", billing: "metered", provider: 3, used: 3, limit: 10, share: 0.3, over: false, age: 0 });
  });

  it("has no value when the month has no read", () => {
    expect(stateOf(capped("a", 10), [])).toEqual({ part: "a", billing: "metered", limit: 10 });
  });

  it("does not count a read of a different month", () => {
    const reads = [read("a", "provider", 90, "2026-10-31"), read("a", "count", 80, "2025-11-16"), read("a", "count", 2, "2026-11-01")];
    expect(stateOf(capped("a", 10), reads)).toMatchObject({ count: 2, used: 2, age: 15 });
    expect(stateOf(capped("a", 10), reads)).not.toHaveProperty("provider");
    expect(stateOf(capped("a", 10), reads.slice(0, 2))).toEqual({ part: "a", billing: "metered", limit: 10 });
  });

  it("does not count a read of a different service", () => {
    const states = useStates(layer(capped("a", 10), capped("b", 10)), [read("b", "count", 6)], { today });
    expect(states).toEqual([
      { part: "a", billing: "metered", limit: 10 },
      { part: "b", billing: "metered", count: 6, used: 6, limit: 10, share: 0.6, level: 0.5, over: false, age: 0 },
    ]);
  });

  it("keeps the largest read of a source, because the cost of a month does not go down", () => {
    const reads = [read("a", "provider", 6, "2026-11-10"), read("a", "provider", 5, "2026-11-12")];
    expect(stateOf(capped("a", 10), reads)).toMatchObject({ provider: 6, used: 6, age: 4 });
  });

  it("does not count a read with a fault", () => {
    const faulty = [
      read("a", "count", Number.NaN),
      read("a", "count", -1),
      read("a", "count", Number.POSITIVE_INFINITY),
      read("a", "provider", 50, "2026-11-17"),
      read("a", "provider", 50, "2026-11-31"),
      read("a", "provider", 50, "16.11.2026"),
      read("x", "provider", 50),
    ];
    expect(stateOf(capped("a", 10), faulty)).toEqual({ part: "a", billing: "metered", limit: 10 });
    expect(stateOf(capped("a", 10), [...faulty, read("a", "count", 1)])).toMatchObject({ used: 1 });
  });

  it("uses the first record of a part", () => {
    const states = useStates(layer(capped("a", 10), capped("a", 2)), [read("a", "count", 4)], { today });
    expect(states).toEqual([{ part: "a", billing: "metered", count: 4, used: 4, limit: 10, share: 0.4, over: false, age: 0 }]);
  });

  it("gives the used amount of a service with a different billing too", () => {
    const fixed: Service = { part: "a", billing: "fixed", price: 4 };
    expect(stateOf(fixed, [read("a", "provider", 3)])).toEqual({ part: "a", billing: "fixed", provider: 3, used: 3, age: 0 });
  });
});

describe("the share and the level of a used amount", () => {
  const levelOf = (limit: number, amount: number, options: Partial<UseOptions> = {}): number | undefined => stateOf(capped("a", limit), [read("a", "count", amount)], options)?.level;

  it("has the default levels 50, 80 and 100 percent", () => {
    expect(USE_LEVELS).toEqual([0.5, 0.8, 1]);
    expect(levelOf(10, 4.9)).toBeUndefined();
    expect(levelOf(10, 5)).toBe(0.5);
    expect(levelOf(10, 7.9)).toBe(0.5);
    expect(levelOf(10, 8)).toBe(0.8);
    expect(levelOf(10, 9.9)).toBe(0.8);
    expect(levelOf(10, 10)).toBe(1);
    expect(levelOf(10, 25)).toBe(1);
  });

  it("gives the share as the used amount divided by the hard limit", () => {
    expect(stateOf(capped("a", 8), [read("a", "count", 2)])).toMatchObject({ share: 0.25 });
  });

  it("reaches a level when the rounding of the division gives a little less", () => {
    expect(2.4 / 3).toBeLessThan(0.8);
    expect(levelOf(3, 2.4)).toBe(0.8);
    expect(LEVEL_TOLERANCE).toBeLessThan(1e-6);
  });

  it("takes the levels of the options, in each sequence", () => {
    expect(levelOf(10, 3, { levels: [0.25] })).toBe(0.25);
    expect(levelOf(10, 9, { levels: [1, 0.3, 0.6] })).toBe(0.6);
    expect(levelOf(10, 9, { levels: [] })).toBeUndefined();
  });

  it("tells that a used amount is over only when it is more than the hard limit", () => {
    expect(stateOf(capped("a", 10), [read("a", "count", 10)])).toMatchObject({ share: 1, level: 1, over: false });
    expect(stateOf(capped("a", 10), [read("a", "count", 10.01)])).toMatchObject({ level: 1, over: true });
  });

  it("has no share and no level for a service with no hard limit", () => {
    expect(stateOf(metered("a", { kind: "alert", amount: 5 }), [read("a", "count", 9)])).toEqual({ part: "a", billing: "metered", count: 9, used: 9, age: 0 });
  });

  it("has no share for a hard limit of 0, and each cost is over it", () => {
    expect(stateOf(capped("a", 0), [read("a", "count", 0)])).toEqual({ part: "a", billing: "metered", count: 0, used: 0, limit: 0, over: false, age: 0 });
    expect(stateOf(capped("a", 0), [read("a", "count", 1)])).toEqual({ part: "a", billing: "metered", count: 1, used: 1, limit: 0, over: true, age: 0 });
  });

  it("uses the smallest hard limit of the service", () => {
    const service = metered("a", { kind: "prepaid", amount: 20 }, { kind: "code", amount: 10, stop: "x" }, { kind: "alert", amount: 1 });
    expect(stateOf(service, [read("a", "count", 8)])).toMatchObject({ limit: 10, share: 0.8, level: 0.8 });
  });
});

describe("the age of the reads", () => {
  it("is the age of the newest read of the month, in days", () => {
    const reads = [read("a", "count", 1, "2026-11-10"), read("a", "provider", 1, "2026-11-14"), read("a", "provider", 1, "2026-10-31")];
    expect(stateOf(capped("a", 10), reads)).toMatchObject({ age: 2 });
  });
});

describe("the options", () => {
  const run = (options: UseOptions): unknown => useStates(layer(capped("a", 10)), [], options);

  it("refuses a date of the check that is not a date", () => {
    expect(() => run({ today: "2026-11-31" })).toThrow(RangeError);
    expect(() => run({ today: "today" })).toThrow('The date "today" is not a date of the form YYYY-MM-DD.');
  });

  it("refuses a level that is not a finite number above 0", () => {
    for (const level of [0, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => run({ today, levels: [0.5, level] })).toThrow(RangeError);
  });

  it("refuses a largest age that is less than 0 or not finite", () => {
    for (const readDays of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => run({ today, readDays })).toThrow(RangeError);
    expect(run({ today, readDays: 0 })).toEqual([{ part: "a", billing: "metered", limit: 10 }]);
  });
});

describe("the programs on the tree of the reads", () => {
  const tree = useSpace(layer(capped("a", 10), capped("b", 4)), [read("a", "count", 4, "2026-11-15"), read("a", "provider", 7), read("a", "provider", 99, "2026-10-01")], { today });
  const at = (program: Parameters<typeof evaluateService>[0], part: string): unknown => evaluateService(program, tree, part);

  it("evaluates each program at a service", () => {
    expect(at(COUNT_USED, "a")).toEqual({ ok: true, value: 4 });
    expect(at(PROVIDER_USED, "a")).toEqual({ ok: true, value: 7 });
    expect(at(USED, "a")).toEqual({ ok: true, value: 7 });
    expect(at(USE_SHARE, "a")).toEqual({ ok: true, value: 0.7 });
    expect(at(USE_LEVEL, "a")).toEqual({ ok: true, value: 0.5 });
    expect(at(USE_OVER, "a")).toEqual({ ok: true, value: false });
    expect(at(READ_AGE, "a")).toEqual({ ok: true, value: 0 });
  });

  it("gives an error value at a service with no read of the month", () => {
    for (const program of [COUNT_USED, PROVIDER_USED, USED, USE_SHARE, USE_LEVEL, USE_OVER, READ_AGE]) expect(at(program, "b")).toMatchObject({ ok: false });
  });

  it("gives the level 0 for a share below each level", () => {
    const low = useSpace(layer(capped("a", 10)), [read("a", "count", 1)], { today });
    expect(evaluateService(USE_LEVEL, low, "a")).toEqual({ ok: true, value: 0 });
  });
});

describe("the sample reads", () => {
  it("give the states that the README shows", () => {
    expect(useStates(SAMPLE_SPEND, SAMPLE_READS, { today: SAMPLE_TODAY })).toEqual([
      { part: "cloud-account", billing: "metered", provider: 0, used: 0, age: 1 },
      { part: "push-account", billing: "fixed" },
      { part: "call-account", billing: "metered", count: 4, provider: 5.2, used: 5.2, limit: 10, share: 0.52, level: 0.5, over: false, age: 0 },
    ]);
  });
});

describe("the used amounts of generated reads", () => {
  const services = [capped("a", 10), metered("b", { kind: "code", amount: 3, stop: "x" }), metered("c", { kind: "alert", amount: 1 })];
  const stack = layer(...services);
  const limits: Readonly<Record<string, number | undefined>> = { a: 10, b: 3, c: undefined };
  const dates = ["2026-11-01", "2026-11-09", "2026-11-16", "2026-11-17", "2026-10-31", "2025-11-16", "2026-02-30", "no date"];
  const amount = fc.oneof(fc.double({ min: 0, max: 20, noNaN: true }), fc.integer({ min: 0, max: 20 }), fc.constantFrom(-1, Number.NaN, Number.POSITIVE_INFINITY, 2.4, 0));
  const oneRead: fc.Arbitrary<UseRead> = fc.record({ part: fc.constantFrom("a", "b", "c", "x"), source: fc.constantFrom(...USE_SOURCES), amount, date: fc.constantFrom(...dates) });
  const manyReads = fc.array(oneRead, { maxLength: 12 });
  const options = { seed: 20261116, numRuns: 200 };

  /** This function is the plain statement of the rule, for the comparison with the programs. */
  const expected = (reads: readonly UseRead[], part: string, source?: UseSource): number | undefined => {
    const amounts = reads
      .filter((item) => item.part === part && (source === undefined || item.source === source))
      .filter((item) => Number.isFinite(item.amount) && item.amount >= 0 && ["2026-11-01", "2026-11-09", "2026-11-16"].includes(item.date))
      .map((item) => item.amount);
    return amounts.length === 0 ? undefined : Math.max(...amounts);
  };

  it("give the largest correct read of the month, for each source and for the two sources together", () => {
    fc.assert(
      fc.property(manyReads, (reads) => {
        for (const state of useStates(stack, reads, { today })) {
          expect(state.count).toBe(expected(reads, state.part, "count"));
          expect(state.provider).toBe(expected(reads, state.part, "provider"));
          expect(state.used).toBe(expected(reads, state.part));
          if (state.count !== undefined || state.provider !== undefined) expect(state.used).toBe(Math.max(state.count ?? 0, state.provider ?? 0));
        }
      }),
      options,
    );
  });

  it("give the same states in each sequence of the reads", () => {
    fc.assert(
      fc.property(manyReads, (reads) => {
        expect(useStates(stack, [...reads].reverse(), { today })).toEqual(useStates(stack, reads, { today }));
      }),
      options,
    );
  });

  it("do not give a smaller used amount after one more read", () => {
    fc.assert(
      fc.property(manyReads, oneRead, (reads, more) => {
        const before = useStates(stack, reads, { today });
        const after = useStates(stack, [...reads, more], { today });
        before.forEach((state, index) => {
          if (state.used !== undefined) expect(after[index]?.used).toBeGreaterThanOrEqual(state.used);
        });
      }),
      options,
    );
  });

  it("give a share, a level and the test of the limit that agree with the used amount", () => {
    fc.assert(
      fc.property(manyReads, (reads) => {
        for (const state of useStates(stack, reads, { today })) {
          const limit = limits[state.part];
          expect(state.limit).toBe(limit);
          if (state.used === undefined || limit === undefined) {
            expect(state.share).toBeUndefined();
            expect(state.level).toBeUndefined();
            expect(state.over).toBeUndefined();
            continue;
          }
          expect(state.share).toBe(state.used / limit);
          expect(state.over).toBe(state.used > limit);
          const reached = USE_LEVELS.filter((level) => level <= state.used! / limit + LEVEL_TOLERANCE);
          expect(state.level).toBe(reached.length === 0 ? undefined : Math.max(...reached));
        }
      }),
      options,
    );
  });
});
