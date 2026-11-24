// The events of outages from the counts of the customers out of power over time. This module does no fetch.
// A source gives the count of an area at each time of its collection. The order of the areas is free, so a file in the order of the areas
// and a file in the order of the times give the same events. An event is a run of the times of an area with a count at or above a threshold.

/** One count of a source of outages: the customers out of power in an area at one time of the collection. */
export interface OutageCount {
  /** The code of the area, for example the FIPS code of a county. */
  readonly area: string;
  /**
   * The count of the customers out of power. It is `undefined` when the source has a line of the area at the time with no count.
   * Then the observation of the area stops at that time. An open run is censored, and a run at the next time has no known start.
   */
  readonly out: number | undefined;
  /** The time of the collection, in seconds from 1970-01-01T00:00:00Z. */
  readonly time: number;
}

/** An event of an area: a run of the times of the collection with a count at or above the threshold of the area. */
export interface OutageEvent {
  readonly area: string;
  /** The first time of the run, in seconds from 1970-01-01T00:00:00Z. */
  readonly start: number;
  /** The duration in seconds: the last time of the run, less the first time, plus one interval of the collection. */
  readonly seconds: number;
  /** The largest count of the run. */
  readonly peak: number;
  /** When `censored` is true, a gap of the collection, a line with no count or the end of the data stopped the observation. Then `seconds` is a lower bound. */
  readonly censored: boolean;
}

/** The options of a read of outage counts. */
export interface OutageOptions {
  /** The customers of each area, by the code of the area. */
  readonly customers: ReadonlyMap<string, number>;
  /** The threshold of an area as a share of its customers. The default is 0.01. With 0, the threshold is `least` and needs no customers. */
  readonly share?: number | undefined;
  /** The lowest threshold, as a count of customers. The default is 1. */
  readonly least?: number | undefined;
  /** The interval of the collection in seconds. The default is 900, 15 minutes. A step of more than 1.5 intervals is a gap. */
  readonly interval?: number | undefined;
  /**
   * The join time in seconds. It is the longest step from the end of a run to the start of the next run of its area in one event.
   * The default is 0: each run is an event.
   * One outage that moves across the threshold gives many short runs. With a join time, those runs are one event.
   * On a regular collection, two runs of one area are 2 intervals or more apart. Thus a join time under 2 intervals joins no run.
   */
  readonly join?: number | undefined;
}

/** The counts of a read. */
export interface OutageTally {
  /** The counts that the reader took. */
  readonly counts: number;
  /** The times of the collection: each time with one count or more. */
  readonly times: number;
  /** The counts with a time that is not after the last time of their area. The reader does not use them. */
  readonly repeats: number;
  /** The counts of an area with no count of customers. The reader does not use them. */
  readonly unknown: number;
  /** The lines of an area at a time with no count (`out` is `undefined`). The observation of the area stops at each of them. */
  readonly missing: number;
  /** The runs that start at the start of the data, after a gap or after a line with no count. Their start is not known, so they are not events. */
  readonly truncated: number;
  /** The runs that the option `join` adds to the run before them. They are not events of their own. */
  readonly joined: number;
}

/** The result of a read: the events, from the earliest start, and the tally. */
export interface OutageRuns {
  readonly events: readonly OutageEvent[];
  readonly tally: OutageTally;
}

/** A reader of outage counts. It keeps only the open run of each area, the runs and the set of the times of the collection. */
export interface OutageReader {
  /** This function adds one count. The times of each area must increase. */
  add(count: OutageCount): void;
  /** This function gives the events and the tally. After it, the reader takes no count. */
  finish(): OutageRuns;
  /**
   * This function gives the events and the tally for each join time, in the order of the join times. After it, the reader takes no count.
   * The runs do not change with the join time, so one read gives the events of many join times.
   *
   * @throws RangeError when a join time is not a finite number of 0 or more
   */
  finishEach(joins: readonly number[]): OutageRuns[];
}

interface Run {
  readonly area: string;
  readonly start: number;
  last: number;
  peak: number;
  /** The time of the first line with no count of the area after the run. */
  miss: number | undefined;
  /** The run starts at the next time of its area after a line with no count, so its start is not known. */
  blind: boolean;
}

interface AreaState {
  readonly limit: number | undefined;
  last: number;
  run: Run | undefined;
  /** The last run of the area that ended, until a line with no count gives its time `miss`. */
  ended: Run | undefined;
  /** The last line of the area has no count. */
  missed: boolean;
}

/** This function gives the index of the first value of `sorted` that is not less than `value`. */
function lowerBound(sorted: Float64Array, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sorted[middle] ?? Number.POSITIVE_INFINITY) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * This function gives a reader of outage counts.
 *
 * - The threshold of an area is the larger of `least` and `share` times its customers, up to the next whole number.
 * - A run ends at a count under the threshold, or at a time of the collection with no count of the area.
 * - A line with no count stops the observation of its area. A run at the next time of the area has no known start.
 * - With the option `join`, a run that starts within the join time after the end of the run before it is part of that run.
 *   The event has the start of the first run, the end of the last run and the largest peak.
 *   A gap of the collection or a line with no count between the runs is inside the event. Then the peak is a lower limit.
 * - The start of an event is known when the collection has a time within 1.5 intervals before the event. Else the event is truncated.
 *   A run after a line with no count also has no known start.
 * - The end of an event is observed when the collection continues after the event for the join time and one more time at least.
 *   Each step of the collection to that time is 1.5 intervals or less, and the area has no line with no count up to it.
 *   Else the event is censored. With a join time of 0, the collection has a time within 1.5 intervals after the event.
 *
 * @param options - The customers of each area and the threshold
 * @returns The reader
 */
export function outageReader(options: OutageOptions): OutageReader {
  const share = options.share ?? 0.01;
  const least = options.least ?? 1;
  const interval = options.interval ?? 900;
  if (!(share >= 0 && share <= 1)) throw new RangeError("outageReader: the share is not from 0 to 1.");
  if (!(Number.isFinite(least) && least >= 1)) throw new RangeError("outageReader: the lowest threshold is not a finite number of 1 or more.");
  if (!(Number.isFinite(interval) && interval > 0)) throw new RangeError("outageReader: the interval is not a finite number of more than 0.");
  const join = options.join ?? 0;
  if (!(Number.isFinite(join) && join >= 0)) throw new RangeError("outageReader: the join time is not a finite number of 0 or more.");
  const gap = 1.5 * interval;
  const areas = new Map<string, AreaState>();
  const times = new Set<number>();
  const runs: Run[] = [];
  let counts = 0;
  let repeats = 0;
  let unknown = 0;
  let missing = 0;
  let finished = false;

  const stateOf = (area: string): AreaState => {
    let state = areas.get(area);
    if (state === undefined) {
      const customers = options.customers.get(area);
      const limit = share === 0 ? least : customers === undefined ? undefined : Math.max(least, Math.ceil(share * customers));
      state = { limit, last: Number.NEGATIVE_INFINITY, run: undefined, ended: undefined, missed: false };
      areas.set(area, state);
    }
    return state;
  };

  // The events of one join time. The runs of each area are in the order of their times, so the chain of an area is the last chain of that area.
  const chains = (each: number, sorted: Float64Array): OutageRuns => {
    const events: OutageEvent[] = [];
    let truncated = 0;
    let joined = 0;
    const close = (chain: Run): void => {
      const before = sorted[lowerBound(sorted, chain.start) - 1];
      if (chain.blind || before === undefined || chain.start - before > gap) {
        truncated += 1;
        return;
      }
      // The end is observed when the collection has no gap from the last time to the first time at the join time after it, or later.
      const at = lowerBound(sorted, chain.last);
      const end = Math.max(at + 1, lowerBound(sorted, chain.last + each));
      let censored = end >= sorted.length || (chain.miss !== undefined && chain.miss <= (sorted[end] ?? Number.POSITIVE_INFINITY));
      for (let index = at; !censored && index < end; index += 1) censored = (sorted[index + 1] ?? 0) - (sorted[index] ?? 0) > gap;
      events.push({ area: chain.area, start: chain.start, seconds: chain.last - chain.start + interval, peak: chain.peak, censored });
    };
    const open = new Map<string, Run>();
    for (const run of runs) {
      const chain = open.get(run.area);
      if (chain !== undefined && run.start - chain.last <= each) {
        chain.last = run.last;
        chain.peak = Math.max(chain.peak, run.peak);
        chain.miss = run.miss;
        joined += 1;
        continue;
      }
      if (chain !== undefined) close(chain);
      open.set(run.area, { ...run });
    }
    for (const chain of open.values()) close(chain);
    events.sort((a, b) => a.start - b.start || (a.area < b.area ? -1 : a.area > b.area ? 1 : 0));
    return { events, tally: { counts, times: sorted.length, repeats, unknown, missing, truncated, joined } };
  };

  const finishEach = (joins: readonly number[]): OutageRuns[] => {
    if (!joins.every((each) => Number.isFinite(each) && each >= 0)) throw new RangeError("outageReader: a join time is not a finite number of 0 or more.");
    if (finished) throw new Error("outageReader: the read is finished.");
    finished = true;
    for (const state of areas.values()) if (state.run !== undefined) runs.push(state.run);
    const sorted = Float64Array.from(times).sort();
    return joins.map((each) => chains(each, sorted));
  };

  return {
    add(count: OutageCount): void {
      if (finished) throw new Error("outageReader: the read is finished.");
      const { area, out, time } = count;
      if (!((out === undefined || (Number.isFinite(out) && out >= 0)) && Number.isFinite(time))) throw new RangeError("outageReader: a count or a time is not a finite number.");
      if (out !== undefined) counts += 1;
      times.add(time);
      const state = stateOf(area);
      if (state.limit === undefined) {
        unknown += 1;
        return;
      }
      if (time <= state.last) {
        repeats += 1;
        return;
      }
      const previous = state.last;
      state.last = time;
      const run = state.run;
      if (out === undefined) {
        missing += 1;
        if (run !== undefined) {
          run.miss = time;
          runs.push(run);
          state.run = undefined;
          state.ended = run;
        } else if (state.ended !== undefined && state.ended.miss === undefined) state.ended.miss = time;
        state.missed = true;
        return;
      }
      const inside = out >= state.limit;
      const blind = state.missed && time - previous <= gap;
      state.missed = false;
      if (run !== undefined && inside && time - run.last <= gap) {
        run.last = time;
        run.peak = Math.max(run.peak, out);
        return;
      }
      if (run !== undefined) {
        runs.push(run);
        state.ended = run;
      }
      state.run = inside ? { area, start: time, last: time, peak: out, miss: undefined, blind } : undefined;
    },

    finish(): OutageRuns {
      const [result] = finishEach([join]);
      if (result === undefined) throw new Error("outageReader: no result.");
      return result;
    },

    finishEach,
  };
}
