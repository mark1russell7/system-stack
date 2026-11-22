import { describe, expect, it } from "vitest";
import { outageReader, type OutageCount, type OutageOptions, type OutageRuns } from "./outages.ts";

// Made-up areas: "A" with 1000 customers (a threshold of 10), and "Z" with 10000 customers (a threshold of 100).
// "Z" has 1 customer out at each time, so that the collection has each time. It has no event.
const OPTIONS: OutageOptions = {
  customers: new Map([
    ["A", 1000],
    ["Z", 10_000],
  ]),
};
const at = (step: number): number => 1_600_000_000 + step * 900;
const steps = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** This function gives the counts of "Z" at each step of `times`, and the counts of "A" from `a` (a step and a count). */
function counts(times: readonly number[], a: readonly (readonly [number, number])[]): OutageCount[] {
  return [...times.map((step) => ({ area: "Z", out: 1, time: at(step) })), ...a.map(([step, out]) => ({ area: "A", out, time: at(step) }))];
}

function read(list: readonly OutageCount[], options: OutageOptions = OPTIONS): OutageRuns {
  const reader = outageReader(options);
  for (const count of list) reader.add(count);
  return reader.finish();
}

describe("outageReader", () => {
  it("gives an observed event when the area has no count at a time of the collection", () => {
    const { events, tally } = read(
      counts(steps(0, 10), [
        [2, 50],
        [3, 80],
        [4, 50],
        [5, 20],
      ]),
    );
    expect(events).toEqual([{ area: "A", start: at(2), seconds: 4 * 900, peak: 80, censored: false }]);
    expect(tally).toEqual({ counts: 15, times: 11, repeats: 0, unknown: 0, missing: 0, truncated: 0 });
  });

  it("censors a run at a line with no count, and does not give a run at the next time of the area", () => {
    const a = (step: number, out: number | undefined): OutageCount => ({ area: "A", out, time: at(step) });
    // "A" is out at the steps 2 to 4, has no count at 5 and is out at 6 and 7. A count under the threshold at 8 gives a known start at 9.
    const list = [...counts(steps(0, 12), []), a(2, 50), a(3, 50), a(4, 50), a(5, undefined), a(6, 50), a(7, 50), a(8, 0), a(9, 50), a(10, 50)];
    const { events, tally } = read(list);
    expect(events).toEqual([
      { area: "A", start: at(2), seconds: 3 * 900, peak: 50, censored: true },
      { area: "A", start: at(9), seconds: 2 * 900, peak: 50, censored: false },
    ]);
    expect(tally).toEqual({ counts: 21, times: 13, repeats: 0, unknown: 0, missing: 1, truncated: 1 });
    expect(read([...list].sort((left, right) => left.time - right.time)).events).toEqual(events);
    // A time of the collection with no line of "A" after the line with no count gives a known start again.
    const later = read([...counts(steps(0, 10), []), a(2, 50), a(3, 50), a(4, undefined), a(6, 50), a(7, 50)]);
    expect(later.events.map((event) => [event.start, event.censored])).toEqual([
      [at(2), true],
      [at(6), false],
    ]);
    expect(later.tally.truncated).toBe(0);
  });

  it("censors an event at a gap of the collection and at the end of the data", () => {
    const gap = read(
      counts(
        [...steps(0, 5), ...steps(8, 10)],
        [
          [3, 50],
          [4, 50],
          [5, 50],
        ],
      ),
    );
    expect(gap.events).toEqual([{ area: "A", start: at(3), seconds: 3 * 900, peak: 50, censored: true }]);
    const end = read(
      counts(steps(0, 10), [
        [9, 50],
        [10, 50],
      ]),
    );
    expect(end.events).toEqual([{ area: "A", start: at(9), seconds: 2 * 900, peak: 50, censored: true }]);
  });

  it("does not give a run that starts at the start of the data or after a gap: its start is not known", () => {
    const start = read(
      counts(steps(0, 10), [
        [0, 50],
        [1, 50],
      ]),
    );
    expect(start.events).toEqual([]);
    expect(start.tally.truncated).toBe(1);
    const afterGap = read(
      counts(
        [...steps(0, 3), ...steps(6, 10)],
        [
          [6, 50],
          [7, 50],
        ],
      ),
    );
    expect(afterGap.events).toEqual([]);
    expect(afterGap.tally.truncated).toBe(1);
  });

  it("ends a run at a count under the threshold, the larger of the lowest threshold and the share", () => {
    const { events } = read(
      counts(steps(0, 10), [
        [2, 50],
        [3, 9],
        [4, 10],
      ]),
    );
    expect(events.map((event) => [event.start, event.seconds, event.censored])).toEqual([
      [at(2), 900, false],
      [at(4), 900, false],
    ]);
    expect(read(counts(steps(0, 10), [[2, 50]]), { ...OPTIONS, least: 60 }).events).toEqual([]);
    expect(read(counts(steps(0, 10), [[2, 9]]), { ...OPTIONS, share: 0, least: 5 }).events).toHaveLength(1);
  });

  it("gives the same events in the order of the areas and in the order of the times", () => {
    const list = [
      ...counts(steps(0, 20), [
        [2, 50],
        [3, 50],
        [7, 50],
        [12, 50],
        [13, 50],
        [14, 50],
      ]),
      ...[4, 5, 6, 15, 16].map((step) => ({ area: "B", out: 200, time: at(step) })),
    ];
    const options: OutageOptions = { customers: new Map([...OPTIONS.customers, ["B", 500]]) };
    const byTime = [...list].sort((a, b) => a.time - b.time || a.area.localeCompare(b.area));
    expect(read(list, options)).toEqual(read(byTime, options));
    expect(read(list, options).events.map((event) => event.area)).toEqual(["A", "B", "A", "A", "B"]);
  });

  it("does not use a count of an area with no customers, or a count at a time that is not after the last time of its area", () => {
    const list = [
      ...counts(steps(0, 10), [
        [2, 50],
        [3, 50],
        [3, 70],
      ]),
      { area: "Q", out: 500, time: at(4) },
    ];
    const { events, tally } = read(list);
    expect(events).toEqual([{ area: "A", start: at(2), seconds: 1800, peak: 50, censored: false }]);
    expect([tally.repeats, tally.unknown]).toEqual([1, 1]);
    expect(read(list, { ...OPTIONS, share: 0 }).tally.unknown).toBe(0);
  });

  it("refuses a wrong option, a count that is not finite and a count after the finish", () => {
    expect(() => outageReader({ ...OPTIONS, share: 2 })).toThrow(RangeError);
    expect(() => outageReader({ ...OPTIONS, least: 0 })).toThrow(RangeError);
    expect(() => outageReader({ ...OPTIONS, interval: 0 })).toThrow(RangeError);
    const reader = outageReader(OPTIONS);
    expect(() => reader.add({ area: "A", out: Number.NaN, time: 0 })).toThrow(RangeError);
    reader.finish();
    expect(() => reader.add({ area: "A", out: 1, time: 0 })).toThrow(Error);
  });
});
