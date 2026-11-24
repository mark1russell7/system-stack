import { fitGammaRates, pooledRate } from "@mark1russell7/rigor-statistics";
import type { Prior } from "@mark1russell7/system-stack";
import { hazardRegions, type HazardCaseOptions } from "./case.ts";
import type { HazardList, PoolLaw, PriorTable } from "./hazard.ts";
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
 * - The fit of each group is the gamma-Poisson law of the events of its observed areas in their years (`fitGammaRates`).
 * - `perYear` of an area is the mean of its rate after its count (`pooledRate`). An area with few years gets a rate near the mean of its group.
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
  const members = new Map<string, string[]>();
  for (const area of observedAreas(observation)) {
    const code = group(area);
    members.set(code, [...(members.get(code) ?? []), area]);
  }
  const rates: Record<string, readonly [number, number]> = {};
  const laws: Record<string, PoolLaw> = {};
  const codes = [...members.keys()].sort();
  const unitsOf = (code: string): { count: number; exposure: number }[] =>
    (members.get(code) ?? []).map((area) => ({ count: counts[area]?.events ?? 0, exposure: observation.years[area] ?? 0 }));
  // The groups as units of one fit: the events of each group in the years of its areas. It gives the mean of a group with no event.
  const groups = codes.map((code) => unitsOf(code).reduce((sum, unit) => ({ count: sum.count + unit.count, exposure: sum.exposure + unit.exposure }), { count: 0, exposure: 0 }));
  const nation = groups.length > 0 ? fitGammaRates(groups) : { shape: Number.POSITIVE_INFINITY, mean: 0 };
  // The reach of each area with events: the mean peak share of its events. The plain mean of the reach of all areas is for a group with no event.
  const reachOf = (area: string): number | undefined => {
    const count = counts[area];
    return count !== undefined && count.events > 0 ? count.share / count.events : undefined;
  };
  const plainMean = (areas: readonly string[]): number => {
    const reaches = areas.map(reachOf).filter((reach) => reach !== undefined);
    return reaches.length > 0 ? reaches.reduce((sum, reach) => sum + reach, 0) / reaches.length : 0;
  };
  const allReach = plainMean(codes.flatMap((code) => members.get(code) ?? []));
  codes.forEach((code, position) => {
    const areas = members.get(code) ?? [];
    const units = unitsOf(code);
    const events = units.reduce((sum, unit) => sum + unit.count, 0);
    const law = events > 0 ? fitGammaRates(units) : { shape: Number.POSITIVE_INFINITY, mean: pooledRate(groups[position] as { count: number; exposure: number }, nation) };
    const groupReach = events > 0 ? plainMean(areas) : allReach;
    laws[code] = { shape: law.shape, mean: law.mean, areas: areas.length, events, from: events > 0 ? "group" : "nation" };
    areas.forEach((area, index) => {
      const perYear = pooledRate(units[index] as { count: number; exposure: number }, law);
      if (!(perYear > 0)) return;
      rates[area] = [perYear, Math.min(1, reachOf(area) ?? groupReach)];
    });
  });
  return { rates: Object.fromEntries(Object.keys(rates).sort().map((area) => [area, rates[area] as readonly [number, number]])), laws };
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
 * This function gives the yearly prior of each case of a list at the region of the user, as the records `Prior` of the core.
 * For each case, the first region of the option with a table of the case in its scheme gives the prior. A region that the table observes with no event of the case has a prior of 0.
 * A case with no table for a region of the option has no prior. That is no read, not a prior of 0.
 * The place of a prior is the option `place`. With no option, it is the scheme and the code of its region, for example `us-county-fips:37183`.
 * After a fall back to a larger region, that default is the larger region, not the place of the user. Thus a caller that finds a prior by its place gives the option.
 * The function is pure.
 *
 * @throws RangeError when the option `place` is empty or has a space at an end
 */
export function hazardPriors(list: HazardList, options: HazardPriorOptions = {}): Prior[] {
  const { place } = options;
  if (place !== undefined && (place === "" || place !== place.trim())) throw new RangeError(`The place "${place}" is empty or has a space at an end.`);
  const regions = hazardRegions(options.region);
  const tables = list.priors ?? [];
  const priors: Prior[] = [];
  for (const hazard of list.hazards) {
    for (const region of regions) {
      const table = tables.find((item) => item.scheme === region.scheme && item.rates[hazard.case] !== undefined && item.codes.includes(region.code));
      if (table === undefined) continue;
      const [perYear, reach] = table.rates[hazard.case]?.[region.code] ?? [0, 0];
      const source = list.sources[table.source]?.url ?? table.source;
      priors.push({ case: hazard.case, place: place ?? `${region.scheme}:${region.code}`, perYear, reach, source, asOf: table.asOf });
      break;
    }
  }
  return priors;
}

/** This function gives the areas with one year or more and customers above 0, in their order. */
function observedAreas(observation: Observation): string[] {
  return Object.keys(observation.years)
    .filter((area) => (observation.years[area] ?? 0) > 0 && (observation.customers[area] ?? 0) > 0)
    .sort();
}

/** This function gives the faults of a table of priors as the ends of sentences. The codes of the cases are the codes of the list. */
export function priorTableFaults(table: PriorTable, cases: ReadonlySet<string>): string[] {
  const faults: string[] = [];
  if (table.method.trim() === "") faults.push("has no method");
  const codes = new Set(table.codes);
  for (const [code, rates] of Object.entries(table.rates)) {
    if (!cases.has(code)) faults.push(`has the case "${code}", which is not a case of the list`);
    for (const [region, [perYear, reach]] of Object.entries(rates)) {
      if (!codes.has(region)) faults.push(`has a rate of "${code}" for the region "${region}", which is not in its codes`);
      if (!(Number.isFinite(perYear) && perYear >= 0 && reach >= 0 && reach <= 1)) faults.push(`has a rate of "${code}" in "${region}" that is not a count of 0 or more with a share from 0 to 1`);
    }
  }
  return faults;
}
