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

/** This function adds a line of "A" with no count at each of `missed`, and sorts the counts by their times. */
function withMiss(list: readonly OutageCount[], ...missed: number[]): OutageCount[] {
  return [...list, ...missed.map((step) => ({ area: "A", out: undefined, time: at(step) }))].sort((x, y) => x.time - y.time);
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
    expect(tally).toEqual({ counts: 15, times: 11, repeats: 0, unknown: 0, missing: 0, truncated: 0, joined: 0 });
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
    expect(tally).toEqual({ counts: 21, times: 13, repeats: 0, unknown: 0, missing: 1, truncated: 1, joined: 0 });
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

  it("joins the near runs of an area into one event with the option join, also across a gap or a line with no count", () => {
    // Three runs of "A": steps 2-3, steps 5-6 and steps 10-11. A count under the threshold is between them.
    const a = [[2, 50], [3, 50], [4, 5], [5, 90], [6, 90], [7, 5], [10, 40], [11, 40], [12, 5]] as const;
    const third = { area: "A", start: at(10), seconds: 2 * 900, peak: 40, censored: false };
    const whole = { area: "A", start: at(2), seconds: 10 * 900, peak: 90, censored: false };
    expect(read(counts(steps(0, 20), a)).events).toHaveLength(3);
    // A join time of two intervals joins the first two runs. The third run starts four intervals after the second run.
    const near = read(counts(steps(0, 20), a), { ...OPTIONS, join: 2 * 900 });
    expect(near.events).toEqual([{ area: "A", start: at(2), seconds: 5 * 900, peak: 90, censored: false }, third]);
    expect(near.tally.joined).toBe(1);
    expect(read(counts(steps(0, 20), a), { ...OPTIONS, join: 4 * 900 }).events).toEqual([whole]);
    // The collection has no time at step 4. The gap is inside the event, and the start of the first run is known.
    const gap = read(counts(steps(0, 20).filter((step) => step !== 4), a.filter(([step]) => step !== 4)), { ...OPTIONS, join: 4 * 900 });
    expect(gap.events).toEqual([whole]);
    expect(gap.tally).toMatchObject({ truncated: 0, joined: 2 });
    // A line with no count at step 4 stops the first run, and the second run has no known start. The line is inside the event.
    const stopped = read(withMiss(counts(steps(0, 20), a.filter(([step]) => step !== 4)), 4), { ...OPTIONS, join: 2 * 900 });
    expect(stopped.events).toEqual([{ area: "A", start: at(2), seconds: 5 * 900, peak: 90, censored: false }, third]);
    expect(stopped.tally).toMatchObject({ truncated: 0, joined: 1 });
    expect(() => outageReader({ ...OPTIONS, join: -1 })).toThrow(RangeError);
    expect(() => outageReader({ ...OPTIONS, join: Number.NaN })).toThrow(RangeError);
  });

  it("observes the end of an event only when the collection observes the area for the join time after it", () => {
    // The run of "A" is at steps 2-3, and the join time is 8 intervals. Each result is the start, the intervals and the censored flag.
    const join = { ...OPTIONS, join: 8 * 900 };
    const short = (list: readonly OutageCount[], options: OutageOptions = join): [number, number, boolean][] =>
      read(list, options).events.map((event) => [(event.start - at(0)) / 900, event.seconds / 900, event.censored]);
    const run = [[2, 50], [3, 50], [4, 5]] as const;
    // The data end 2 steps after the run, so a later run within the join time is possible.
    expect(short(counts(steps(0, 5), run))).toEqual([[2, 2, true]]);
    expect(short(counts(steps(0, 5), run), OPTIONS)).toEqual([[2, 2, false]]);
    // A gap of the collection at step 5, and a run at step 9: the two runs are 6 steps apart, so they are one event.
    expect(short(counts(steps(0, 20).filter((step) => step !== 5), [...run, [9, 50], [10, 5]]))).toEqual([[2, 8, false]]);
    // A gap of the collection in the join time after the last run censors the event.
    expect(short(counts(steps(0, 20).filter((step) => step !== 8), run))).toEqual([[2, 2, true]]);
    // A low count at step 4, no count at step 5 and a run at steps 6-7 with no known start: one event.
    expect(short(withMiss(counts(steps(0, 20), [...run, [6, 50], [7, 50], [8, 5]]), 5))).toEqual([[2, 6, false]]);
    // No count at step 4, a low count at step 5 and a run at steps 6-7: one event.
    expect(short(withMiss(counts(steps(0, 20), [[2, 50], [3, 50], [5, 5], [6, 50], [7, 50], [8, 5]]), 4))).toEqual([[2, 6, false]]);
    // A line with no count in the join time after the last run censors the event. With no join time, it is after the end.
    const late = withMiss(counts(steps(0, 20), run), 8);
    expect(short(late)).toEqual([[2, 2, true]]);
    expect(short(late, OPTIONS)).toEqual([[2, 2, false]]);
    expect(short(withMiss(counts(steps(0, 20), run), 12))).toEqual([[2, 2, false]]);
  });

  it("gives the events of each join time from one read", () => {
    const a = [[2, 50], [3, 50], [4, 5], [5, 90], [6, 90], [7, 5], [10, 40], [11, 40], [12, 5]] as const;
    const reader = outageReader(OPTIONS);
    for (const count of counts(steps(0, 20), a)) reader.add(count);
    const each = reader.finishEach([4 * 900, 0, 2 * 900]);
    expect(each).toEqual([4 * 900, 0, 2 * 900].map((join) => read(counts(steps(0, 20), a), { ...OPTIONS, join })));
    expect(each.map((runs) => runs.events.length)).toEqual([1, 3, 2]);
    expect(() => reader.finishEach([0])).toThrow(Error);
    expect(() => outageReader(OPTIONS).finishEach([-1])).toThrow(RangeError);
  });
});
