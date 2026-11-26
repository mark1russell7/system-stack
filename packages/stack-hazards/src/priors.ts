import { isRecord } from "@mark1russell7/optional/read";
import { fitTwoLevelGammaRates, pooledRate, pooledRateUpper, type GammaRates, type GroupLaw } from "@mark1russell7/rigor-statistics";
import { intervalFault, type Prior } from "@mark1russell7/system-stack";
import { hazardRegions, type HazardCaseOptions } from "./case.ts";
import type { AreaUnits, HazardList, PoolLaw, PriorTable } from "./hazard.ts";
import type { OutageCount, OutageEvent } from "./outages.ts";

// The yearly priors of the cases: the events in one year in an area, and the share of the events that reach a place.
// The counts come from the events of outages. This module does no fetch.

/** The counts of the events of one area for its prior. */
export interface AreaCount {
  /** The count of the events of the area. */
  readonly events: number;
  /** The sum of the peak share of each event: its largest count of customers out, over the customers of the area, at most 1. */
  readonly share: number;
}

/** A tally of the years in which a source observes each area. */
export interface CoverageTally {
  /** This function adds one count of the source. */
  add(count: OutageCount): void;
  /** This function gives the count of the calendar years (UTC) with one count or more of each area. */
  years(): Map<string, number>;
  /** This function gives the calendar years (UTC) with one count or more of each area, in their order. A holdout over time splits them. */
  calendar(): Map<string, number[]>;
}

/**
 * This function gives a tally of the years of each area. A source can list an area only when it has customers out.
 * Then the source observes the area in each year with one count.
 * The first year in which the source observes an area counts as a full year. Thus a rate from the tally is a lower bound.
 */
export function coverageTally(): CoverageTally {
  const seen = new Map<string, Set<number>>();
  return {
    add(count) {
      const years = seen.get(count.area) ?? new Set<number>();
      years.add(new Date(count.time * 1000).getUTCFullYear());
      seen.set(count.area, years);
    },
    years: () => new Map([...seen].map(([area, years]) => [area, years.size])),
    calendar: () => new Map([...seen].map(([area, years]) => [area, [...years].sort((a, b) => a - b)])),
  };
}

/** This function gives the counts of the events of each area with customers, by the code of the area in its order. An area with no customers has no count. */
export function areaCounts(events: readonly OutageEvent[], customers: ReadonlyMap<string, number>): Record<string, AreaCount> {
  const counts = new Map<string, { events: number; share: number }>();
  for (const event of events) {
    const total = customers.get(event.area);
    if (total === undefined || !(total > 0)) continue;
    const count = counts.get(event.area) ?? { events: 0, share: 0 };
    count.events += 1;
    count.share += Math.min(1, event.peak / total);
    counts.set(event.area, count);
  }
  return Object.fromEntries([...counts.keys()].sort().map((area) => [area, counts.get(area) ?? { events: 0, share: 0 }]));
}

/** The observation of the areas: the years and the customers of each area. An area with no year or no customers is not observed. */
export interface Observation {
  readonly years: Readonly<Record<string, number>>;
  readonly customers: Readonly<Record<string, number>>;
}

/** This function gives the codes of the regions with one observed area or more, in their order. */
export function observedRegions(observation: Observation, region: (area: string) => string): string[] {
  return [...new Set(observedAreas(observation).map(region))].sort();
}

/**
 * This function gives the rates of each region with one event or more: `[perYear, reach]`.
 * - `perYear` is the sum over the observed areas of the region of the events of the area over its years.
 * - `reach` is the mean share of the customers of the region that one event reaches. Thus `perYear * reach` is the expected events at one customer in one year.
 * With `region` the identity, each area is a region, and `reach` is the mean peak share of its events.
 */
export function regionRates(counts: Readonly<Record<string, AreaCount>>, observation: Observation, region: (area: string) => string): Record<string, readonly [number, number]> {
  const sums = new Map<string, { perYear: number; hits: number; customers: number }>();
  for (const area of observedAreas(observation)) {
    const years = observation.years[area] ?? 0;
    const customers = observation.customers[area] ?? 0;
    const count = counts[area] ?? { events: 0, share: 0 };
    const code = region(area);
    const sum = sums.get(code) ?? { perYear: 0, hits: 0, customers: 0 };
    sum.perYear += count.events / years;
    sum.hits += (count.share * customers) / years;
    sum.customers += customers;
    sums.set(code, sum);
  }
  const rates: Record<string, readonly [number, number]> = {};
  for (const code of [...sums.keys()].sort()) {
    const { perYear, hits, customers } = sums.get(code) ?? { perYear: 0, hits: 0, customers: 0 };
    if (perYear > 0) rates[code] = [perYear, Math.min(1, hits / (perYear * customers))];
  }
  return rates;
}

/**
 * This function gives the observation of the regions: each region with one observed area or more is an area of its own.
 * - The years of a region are the plain mean of the years of its observed areas. Thus the events of a region over its years are its events in one year.
 * - The customers of a region are the sum of the customers of its observed areas.
 * Give the result and `regionCounts` to `pooledRates` to pool the regions, for example the states toward the nation.
 */
export function regionObservation(observation: Observation, region: (area: string) => string): Observation {
  const sums = new Map<string, { years: number; customers: number; areas: number }>();
  for (const area of observedAreas(observation)) {
    const code = region(area);
    const sum = sums.get(code) ?? { years: 0, customers: 0, areas: 0 };
    sum.years += observation.years[area] ?? 0;
    sum.customers += observation.customers[area] ?? 0;
    sum.areas += 1;
    sums.set(code, sum);
  }
  const codes = [...sums.keys()].sort();
  const sumOf = (code: string): { years: number; customers: number; areas: number } => sums.get(code) ?? { years: 0, customers: 0, areas: 1 };
  return {
    years: Object.fromEntries(codes.map((code) => [code, sumOf(code).years / sumOf(code).areas])),
    customers: Object.fromEntries(codes.map((code) => [code, sumOf(code).customers])),
  };
}

/**
 * This function gives the counts of the events of each region with one observed area or more, in the order of the codes.
 * - `events` of a region is the sum of the events of its observed areas.
 * - `share` of a region is the sum of the peak share of each event over the customers of the region.
 *   One event reaches its share of its area, times the customers of the area over the customers of the region.
 */
export function regionCounts(counts: Readonly<Record<string, AreaCount>>, observation: Observation, region: (area: string) => string): Record<string, AreaCount> {
  const regions = regionObservation(observation, region);
  const sums = new Map<string, { events: number; share: number }>();
  for (const area of observedAreas(observation)) {
    const code = region(area);
    const count = counts[area] ?? { events: 0, share: 0 };
    const sum = sums.get(code) ?? { events: 0, share: 0 };
    sum.events += count.events;
    sum.share += (count.share * (observation.customers[area] ?? 0)) / (regions.customers[code] ?? 1);
    sums.set(code, sum);
  }
  return Object.fromEntries([...sums.keys()].sort().map((code) => [code, sums.get(code) ?? { events: 0, share: 0 }]));
}

/** The pooled rates of the areas, and the law of each group. */
export interface PooledRates {
  /** The rates `[perYear, reach]` of each area with a pooled rate of more than 0, by the code of the area in its order. */
  readonly rates: Record<string, readonly [number, number]>;
  /** The law of each group with one observed area or more, by the code of the group in its order. */
  readonly laws: Record<string, PoolLaw>;
}

/**
 * This function gives a pooled rate of each area toward the areas of its group, for example a county toward the counties of its state.
 *
 * - The fit is the two-level gamma-Poisson fit of the events of the observed areas in their years (`fitTwoLevelGammaRates` of `rigor-statistics`).
 * - Each group gets the gamma law of the rates of its areas. `perYear` of an area is the mean of its rate after its count.
 *   An area with few years gets a rate near the mean of its group.
 * - `reach` of an area with events is the mean peak share of its events, as in `regionRates`. An area with no event gets the plain mean of the reach of the areas of its group with events.
 *   The plain mean gives each area one weight. A mean over the events gives more weight to the areas with many events, and their events reach a smaller share.
 * - A group with no event gets the shape `Infinity` and its pooled mean toward all groups. That fit has the events of each group in the years of its areas.
 *   Thus its areas get a rate of more than 0, and a later event of the group does not have the chance 0. Its areas get the plain mean of the reach of all areas with events.
 * - When no group has an event, no area gets a rate, as an area with no event gets from `regionRates`.
 *
 * @param counts - The counts of the events of each area in one case
 * @param observation - The years and the customers of each area
 * @param group - This function gives the code of the group of an area, for example `eagleRegion`
 */
export function pooledRates(counts: Readonly<Record<string, AreaCount>>, observation: Observation, group: (area: string) => string): PooledRates {
  const areas = observedAreas(observation);
  if (areas.length === 0) return { rates: {}, laws: {} };
  const fit = fitTwoLevelGammaRates(areas.map((area) => ({ count: counts[area]?.events ?? 0, exposure: observation.years[area] ?? 0, group: group(area) })));
  // The reach of each area with events: the mean peak share of its events. The plain mean of the reach of all areas is for a group with no event.
  const reachOf = (area: string): number | undefined => {
    const count = counts[area];
    return count !== undefined && count.events > 0 ? count.share / count.events : undefined;
  };
  const plainMean = (list: readonly string[]): number => {
    const reaches = list.map(reachOf).filter((reach) => reach !== undefined);
    return reaches.length > 0 ? reaches.reduce((sum, reach) => sum + reach, 0) / reaches.length : 0;
  };
  const members = new Map<string, string[]>();
  for (const area of areas) {
    const list = members.get(group(area)) ?? [];
    list.push(area);
    members.set(group(area), list);
  }
  const codes = [...members.keys()].sort();
  const allReach = plainMean(codes.flatMap((code) => members.get(code) ?? []));
  const laws: Record<string, PoolLaw> = {};
  const reaches = new Map<string, number>();
  for (const code of codes) {
    const law = fit.laws[code] as GroupLaw;
    laws[code] = { shape: law.shape, mean: law.mean, areas: law.units, events: law.count, from: law.from === "group" ? "group" : "nation" };
    reaches.set(code, law.count > 0 ? plainMean(members.get(code) ?? []) : allReach);
  }
  const rates: Record<string, readonly [number, number]> = {};
  areas.forEach((area, index) => {
    const perYear = fit.rates[index] ?? 0;
    if (perYear > 0) rates[area] = [perYear, Math.min(1, reachOf(area) ?? reaches.get(group(area)) ?? 0)];
  });
  return { rates, laws };
}

/** The areas with no event in any case, and the observation without them (`withoutSilentAreas`). */
export interface SilentAreas {
  /** The observation without the silent areas. */
  readonly observation: Observation;
  /** The codes of the observed areas with no event in any case, in their order. */
  readonly silent: readonly string[];
  /**
   * The count of the observed areas with no event in any case that the laws expect. It is the sum over the observed areas of the chance of no event in each case in its years.
   * The chance of each case is the chance of 0 under the gamma-Poisson law of the group of the area in `pooledRates`.
   */
  readonly expected: number;
}

/**
 * This function gives the observation without the silent areas: the observed areas with no event in any case.
 * A source that lists an area can still miss its events, for example when it has the counts of one small utility of a county.
 * Then the area has years and customers but no event. A pooled rate toward its group then makes a low rate from a gap in the source.
 * When the laws expect few silent areas (`expected`) and the source has many, most silent areas are gaps. No test of one area can tell a gap from a low rate.
 * Thus a silent area is not observed: it is no read, and a table of a larger region gives its prior.
 *
 * @param counts - The counts of the events of each area, by the code of the case
 * @param observation - The years and the customers of each area
 * @param group - This function gives the code of the group of an area, for example `eagleRegion`
 */
export function withoutSilentAreas(counts: Readonly<Record<string, Readonly<Record<string, AreaCount>>>>, observation: Observation, group: (area: string) => string): SilentAreas {
  const cases = Object.keys(counts).sort();
  const laws = cases.map((name) => pooledRates(counts[name] ?? {}, observation, group).laws);
  const areas = observedAreas(observation);
  const silent = areas.filter((area) => cases.every((name) => (counts[name]?.[area]?.events ?? 0) === 0));
  const expected = areas.reduce((sum, area) => {
    const years = observation.years[area] ?? 0;
    // The log of the chance of 0 events in the years: the gamma-Poisson law, or the Poisson law when the shape is Infinity.
    const log = laws.reduce((total, law) => {
      const { shape, mean } = law[group(area)] ?? { shape: Number.POSITIVE_INFINITY, mean: 0 };
      return total + (Number.isFinite(shape) ? shape * Math.log(shape / (shape + mean * years)) : -mean * years);
    }, 0);
    return sum + Math.exp(log);
  }, 0);
  const out = new Set(silent);
  const keep = (record: Readonly<Record<string, number>>): Record<string, number> => Object.fromEntries(Object.entries(record).filter(([area]) => !out.has(area)));
  return { observation: { years: keep(observation.years), customers: keep(observation.customers) }, silent, expected };
}

/** The options of `hazardPriors`. */
export interface HazardPriorOptions extends Pick<HazardCaseOptions, "region"> {
  /**
   * The place of each prior, for example the place that `yearShortfall` of stack-endurance reads.
   * The default is the region of the table that gives the prior.
   */
  readonly place?: string | undefined;
}

/**
 * A prior of `hazardPriors`: the record `Prior` of the core, and the region of the table that gives its rate.
 * A page can thus tell "the rate of your state, not of your county" with one call, also with the option `place`.
 */
export interface HazardPrior extends Prior {
  /** The scheme and the code of the region of the table that gives the rate, for example `us-state-fips:01` after a fall back from a county. */
  readonly region: string;
}

/**
 * This function gives the yearly prior of each case of a list at the region of the user.
 * Each prior is a record `Prior` of the core with the field `region`.
 * For each case, the first region of the option with a table of the case in its scheme gives the prior. A region that the table observes with no event of the case has a prior of 0.
 * A case with no table for a region of the option has no prior. That is no read, not a prior of 0.
 * The place of a prior is the option `place`. With no option, it is the scheme and the code of its region, for example `us-county-fips:37183`.
 * After a fall back to a larger region, that default is the larger region, not the place of the user. Thus a caller that finds a prior by its place gives the option.
 * The field `region` is always the scheme and the code of the region that gives the rate, also with the option `place`.
 * Do not add the priors of the storm cases: an outage in two storm cases counts in each case. The method of the table tells the overlap.
 * The function is pure.
 *
 * @throws RangeError when the option `place` is empty or has a space at an end
 */
export function hazardPriors(list: HazardList, options: HazardPriorOptions = {}): HazardPrior[] {
  const { place } = options;
  if (place !== undefined && (place === "" || place !== place.trim())) throw new RangeError(`The place "${place}" is empty or has a space at an end.`);
  const regions = hazardRegions(options.region);
  const tables = list.priors ?? [];
  const priors: HazardPrior[] = [];
  for (const hazard of list.hazards) {
    for (const region of regions) {
      const table = tables.find((item) => item.scheme === region.scheme && item.rates[hazard.case] !== undefined && item.codes.includes(region.code));
      if (table === undefined) continue;
      const [perYear, reach] = table.rates[hazard.case]?.[region.code] ?? [0, 0];
      const source = list.sources[table.source]?.url ?? table.source;
      const code = `${region.scheme}:${region.code}`;
      const ends = table.intervals?.rates[hazard.case]?.[region.code];
      const interval = ends === undefined || table.intervals === undefined ? undefined : { level: table.intervals.level, low: ends[0], high: ends[1] };
      priors.push({ case: hazard.case, place: place ?? code, region: code, perYear, reach, source, asOf: table.asOf, ...(interval === undefined ? {} : { interval }) });
      break;
    }
  }
  return priors;
}

/** This function gives the areas with one year or more and customers above 0, in their order. */
/** This function gives the counts of the observed areas in each case. An area with no count of a case has 0 events of the case. */
export function areaUnits(counts: Readonly<Record<string, Readonly<Record<string, AreaCount>>>>, observation: Observation): AreaUnits {
  const codes = observedAreas(observation);
  return {
    codes,
    years: codes.map((code) => observation.years[code] ?? 0),
    events: Object.fromEntries(Object.entries(counts).map(([name, entry]) => [name, codes.map((code) => entry[code]?.events ?? 0)])),
  };
}

/**
 * This function gives the counts of the regions. The events of a region are the sum of the events of its areas. Its years are the plain mean of the years of its areas.
 * These are the events of `regionCounts` and the years of `regionObservation`. Thus `upperRates` of the regions gives the bounds of the pooled rates of the regions.
 */
export function regionUnits(units: AreaUnits, region: (area: string) => string): AreaUnits {
  const members = new Map<string, number[]>();
  units.codes.forEach((code, at) => {
    const list = members.get(region(code)) ?? [];
    list.push(at);
    members.set(region(code), list);
  });
  const codes = [...members.keys()].sort();
  const lists = codes.map((code) => members.get(code) ?? []);
  const sum = (values: readonly number[], list: readonly number[]): number => list.reduce((total, at) => total + (values[at] ?? 0), 0);
  return {
    codes,
    years: lists.map((list) => sum(units.years, list) / list.length),
    events: Object.fromEntries(Object.entries(units.events).map(([name, values]) => [name, lists.map((list) => sum(values, list))])),
  };
}

/** This function gives the gamma law of the rates of the group of an area in a case, or undefined when there is none. */
export type LawOf = (name: string, area: string) => GammaRates | undefined;

/**
 * This function gives an upper bound of the pooled rate of each area in each case.
 * - The bound is the quantile `level` of the gamma law of the rate of the area after its events in its years (`pooledRateUpper`).
 * - The mean of the same law is the pooled rate of the area. A worst-case plan uses the bound, and a plan of the expected events uses the mean.
 * - A law with a rounded shape and mean gives a bound with about the same digits.
 *
 * @throws RangeError when an area has no law in a case, or when the level is not in (0, 1)
 */
export function upperRates(units: AreaUnits, lawOf: LawOf, level = 0.95): Record<string, Record<string, number>> {
  const bounds: Record<string, Record<string, number>> = {};
  for (const [name, events] of Object.entries(units.events)) {
    const entry: Record<string, number> = {};
    units.codes.forEach((code, at) => {
      const law = lawOf(name, code);
      if (law === undefined) throw new RangeError(`upperRates: the area ${code} has no law in the case ${name}.`);
      entry[code] = pooledRateUpper({ count: events[at] ?? 0, exposure: units.years[at] ?? 0 }, law, level);
    });
    bounds[name] = entry;
  }
  return bounds;
}

/**
 * This function gives the interval of the pooled rate of each area in each case at a level. Since 0.7.11.
 * - The ends are the quantiles `(1 - level) / 2` and `(1 + level) / 2` of the gamma law of the rate of the area after its events in its years (`pooledRateUpper`).
 * - The law is skewed, so its mean, the pooled rate, can be above the high end when the shape is small.
 * - A law with the shape `Infinity` or the mean 0 gives an interval of one point at its mean.
 *
 * @throws RangeError when an area has no law in a case, or when the level is not in (0, 1)
 */
export function rateIntervals(units: AreaUnits, lawOf: LawOf, level = 0.95): Record<string, Record<string, readonly [number, number]>> {
  if (!(level > 0 && level < 1)) throw new RangeError(`rateIntervals: the level is ${String(level)}. It must be in (0, 1).`);
  const intervals: Record<string, Record<string, readonly [number, number]>> = {};
  for (const [name, events] of Object.entries(units.events)) {
    const entry: Record<string, readonly [number, number]> = {};
    units.codes.forEach((code, at) => {
      const law = lawOf(name, code);
      if (law === undefined) throw new RangeError(`rateIntervals: the area ${code} has no law in the case ${name}.`);
      const unit = { count: events[at] ?? 0, exposure: units.years[at] ?? 0 };
      entry[code] = [pooledRateUpper(unit, law, (1 - level) / 2), pooledRateUpper(unit, law, (1 + level) / 2)];
    });
    intervals[name] = entry;
  }
  return intervals;
}

/**
 * The most events at one customer in one year (perYear * reach) that a region of a table can have in one case: one a
 * month. For the United States as a whole, the utilities report one or two interruptions a year at a customer to EIA.
 * The method of the table is not reliable above the limit. An example of a fault is one outage that crosses the line
 * of an event many times. A true rate can also be above the limit, for example in Puerto Rico. Such a region is not
 * in the table, so its prior is no read. The measures are not the same. EIA counts each interruption of more than 5
 * minutes at a customer. The table counts the events of a county at 1% or more of its customers. So the comparison
 * holds only for the order of the number.
 */
export const PRIOR_LIMIT = 12;

/** The input of `pooledTable`: the counts, the laws and the reach of the areas of one fit, and the head of the table. */
export interface PooledTableInput {
  /** The source, the date, the scheme and the method of the table. */
  readonly head: Omit<PriorTable, "codes" | "rates" | "intervals">;
  /** The years of each observed area and its events in each case. */
  readonly units: AreaUnits;
  /** The law of each group in each case, by the code of the case and the code of the group. */
  readonly laws: Readonly<Record<string, Readonly<Record<string, GammaRates>>>>;
  /**
   * The reach of each area in each case: the mean peak share of its events, in the order of `units.codes`.
   * The value of an area with no event in the case is not read, so it is 0.
   */
  readonly reach: Readonly<Record<string, readonly number[]>>;
  /** This function gives the code of the group of an area, for example `eagleRegion`. */
  readonly group: (area: string) => string;
  /** The most events at one customer in one year in one case (`PRIOR_LIMIT`). An area above it in a case is not in the table. */
  readonly limit: number;
  /** The level of the intervals of the rates (`rateIntervals`), for example `PRIOR_LEVEL`. With no level, the table has no intervals. Since 0.7.11. */
  readonly level?: number | undefined;
}

/** The level of the intervals of the rates of the tables of the package: 0.95. Since 0.7.11. */
export const PRIOR_LEVEL = 0.95;

/**
 * This function gives the table of the pooled rates of the areas from their counts, the laws of their groups and their reach.
 * Thus a module keeps only the counts, the laws and the reach, and its table cannot differ from them.
 *
 * - `perYear` of an area is `pooledRate` of its events in its years under the law of its group. An area with a rate of 0 has no rate in the table.
 * - `reach` of an area with events is its reach. An area with no event gets the plain mean of the reach of the areas of its group with events.
 *   In a group with no event, it gets the plain mean of the reach of all areas with events in the case. These are the rules of `pooledRates`.
 * - An area with `perYear * reach` above the limit in a case is not in the table: its code and its rates go.
 * - With a level, each rate of the table has its interval from `rateIntervals` with the same law.
 *
 * @throws RangeError when an area has no law in a case, or when the reach of a case does not have one value for each area
 * @throws RangeError when the level is not in (0, 1)
 */
export function pooledTable(input: PooledTableInput): PriorTable {
  const { units, group } = input;
  const all: Record<string, Record<string, readonly [number, number]>> = {};
  for (const [name, events] of Object.entries(units.events)) {
    const reach = input.reach[name];
    if (reach === undefined || reach.length !== units.codes.length) throw new RangeError(`pooledTable: the reach of the case ${name} does not have one value for each of the ${String(units.codes.length)} areas.`);
    const sums = new Map<string, { sum: number; areas: number }>();
    let allSum = 0;
    let allAreas = 0;
    units.codes.forEach((code, at) => {
      if ((events[at] ?? 0) === 0) return;
      const entry = sums.get(group(code)) ?? { sum: 0, areas: 0 };
      sums.set(group(code), { sum: entry.sum + (reach[at] ?? 0), areas: entry.areas + 1 });
      allSum += reach[at] ?? 0;
      allAreas += 1;
    });
    const allReach = allAreas > 0 ? allSum / allAreas : 0;
    const entry: Record<string, readonly [number, number]> = {};
    units.codes.forEach((code, at) => {
      const law = input.laws[name]?.[group(code)];
      if (law === undefined) throw new RangeError(`pooledTable: the area ${code} has no law in the case ${name}.`);
      const count = events[at] ?? 0;
      const perYear = pooledRate({ count, exposure: units.years[at] ?? 0 }, law);
      if (perYear <= 0) return;
      const groupSum = sums.get(group(code));
      const areaReach = count > 0 ? (reach[at] ?? 0) : groupSum === undefined ? allReach : groupSum.sum / groupSum.areas;
      entry[code] = [perYear, Math.min(1, areaReach)];
    });
    all[name] = entry;
  }
  const over = new Set(units.codes.filter((code) => Object.values(all).some((entry) => { const rate = entry[code]; return rate !== undefined && rate[0] * rate[1] > input.limit; })));
  const rates = Object.fromEntries(Object.entries(all).map(([name, entry]) => [name, Object.fromEntries(Object.entries(entry).filter(([code]) => !over.has(code)))]));
  const table: PriorTable = { ...input.head, codes: units.codes.filter((code) => !over.has(code)), rates };
  if (input.level === undefined) return table;
  const ends = rateIntervals(units, (name, area) => input.laws[name]?.[group(area)], input.level);
  // rateIntervals gives each area of each case, so each kept rate has its interval.
  const intervals: Record<string, Record<string, readonly [number, number]>> = {};
  for (const [name, entry] of Object.entries(rates)) {
    const kept: Record<string, readonly [number, number]> = {};
    for (const code of Object.keys(entry)) {
      const pair = ends[name]?.[code];
      if (pair !== undefined) kept[code] = pair;
    }
    intervals[name] = kept;
  }
  return { ...table, intervals: { level: input.level, rates: intervals } };
}

function observedAreas(observation: Observation): string[] {
  return Object.keys(observation.years)
    .filter((area) => (observation.years[area] ?? 0) > 0 && (observation.customers[area] ?? 0) > 0)
    .sort();
}

/**
 * This function gives the faults of a table of priors as the ends of sentences. The codes of the cases are the codes of the list.
 * It examines the shape of each rate, so a table from JSON with a bad shape gives a fault and not an error.
 */
export function priorTableFaults(table: PriorTable, cases: ReadonlySet<string>): string[] {
  const faults: string[] = [];
  if (table.method.trim() === "") faults.push("has no method");
  if (table.scheme.trim() === "" || table.scheme !== table.scheme.trim()) faults.push("has a scheme that is empty or has a space at an end");
  const codes = new Set<string>();
  for (const code of table.codes) {
    if (codes.has(code)) faults.push(`has the region "${code}" two times in its codes`);
    codes.add(code);
  }
  for (const [code, rates] of Object.entries(table.rates)) {
    if (!cases.has(code)) faults.push(`has the case "${code}", which is not a case of the list`);
    if (!isRecord(rates)) {
      faults.push(`has rates of "${code}" that are not a record of regions`);
      continue;
    }
    for (const [region, rate] of Object.entries(rates)) {
      if (!codes.has(region)) faults.push(`has a rate of "${code}" for the region "${region}", which is not in its codes`);
      const pair: unknown = rate;
      const [perYear, reach]: readonly unknown[] = Array.isArray(pair) && pair.length === 2 ? pair : [];
      if (!(typeof perYear === "number" && Number.isFinite(perYear) && perYear >= 0 && typeof reach === "number" && reach >= 0 && reach <= 1))
        faults.push(`has a rate of "${code}" in "${region}" that is not a pair of a count of 0 or more and a share from 0 to 1`);
    }
  }
  if (table.intervals !== undefined) faults.push(...intervalFaults(table));
  return faults;
}

/**
 * This function gives the faults of the intervals of a table as the ends of sentences.
 * The faults are a bad level, an interval of no rate, a bad pair and a low end above the rate.
 * The mean of a skewed law can be above the high end, so a rate above the high end is not a fault.
 */
function intervalFaults(table: PriorTable): string[] {
  const intervals: unknown = table.intervals;
  const rates = isRecord(intervals) ? intervals["rates"] : undefined;
  if (!isRecord(intervals) || !isRecord(rates)) return ["has intervals that are not a level and a record of cases"];
  const faults: string[] = [];
  const level = intervals["level"];
  if (!(typeof level === "number" && level > 0 && level < 1)) faults.push("has intervals with a level that is not in (0, 1)");
  for (const [code, entry] of Object.entries(rates)) {
    if (!isRecord(entry)) {
      faults.push(`has intervals of "${code}" that are not a record of regions`);
      continue;
    }
    for (const [region, pair] of Object.entries(entry)) {
      const rate = table.rates[code]?.[region];
      if (rate === undefined) faults.push(`has an interval of "${code}" in "${region}", which has no rate`);
      const [low, high]: readonly unknown[] = Array.isArray(pair) && pair.length === 2 ? pair : [];
      if (!(typeof low === "number" && typeof high === "number" && intervalFault({ level: 0.5, low, high }) === undefined))
        faults.push(`has an interval of "${code}" in "${region}" that is not a pair of finite counts with 0 <= low <= high`);
      else if (rate !== undefined && low > rate[0]) faults.push(`has an interval of "${code}" in "${region}" with a low end above the rate`);
    }
  }
  return faults;
}

/**
 * This function gives the overlaps of the tables of priors as the ends of sentences, one for each pair of tables.
 * Two tables overlap when they have the same scheme, a case of the two and a region in the codes of the two.
 * `hazardPriors` takes the first table, so the later table of an overlap gives no prior there.
 */
export function priorTableOverlaps(tables: readonly PriorTable[]): string[] {
  const first = new Map<string, number>();
  const overlaps = new Map<string, { readonly example: string; count: number }>();
  for (const [index, table] of tables.entries()) {
    const rateCases = Object.keys(table.rates);
    for (const region of new Set(table.codes)) {
      for (const name of rateCases) {
        const key = JSON.stringify([table.scheme, name, region]);
        const earlier = first.get(key);
        if (earlier === undefined) {
          first.set(key, index);
          continue;
        }
        const pair = `"priors.${String(earlier)}" and "priors.${String(index)}"`;
        const found = overlaps.get(pair);
        if (found === undefined) overlaps.set(pair, { example: `the case "${name}" in the region "${region}" of the scheme "${table.scheme}"`, count: 1 });
        else found.count += 1;
      }
    }
  }
  return [...overlaps].map(([pair, { example, count }]) => `${pair} both give ${example}, and ${String(count)} pair${count === 1 ? "" : "s"} of a case and a region in all. Only the first table gives a prior there`);
}
