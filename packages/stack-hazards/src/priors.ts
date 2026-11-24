import type { Prior } from "@mark1russell7/system-stack";
import { hazardRegions, type HazardCaseOptions } from "./case.ts";
import type { HazardList, PriorTable } from "./hazard.ts";
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
 * This function gives the yearly prior of each case of a list at the region of the user, as the records `Prior` of stack-endurance.
 * For each case, the first region of the option with a table of the case in its scheme gives the prior. A region that the table observes with no event of the case has a prior of 0.
 * A case with no table for a region of the option has no prior. That is no read, not a prior of 0.
 * The place of a prior is the scheme and the code of its region, for example `us-county-fips:37183`. The function is pure.
 */
export function hazardPriors(list: HazardList, options: Pick<HazardCaseOptions, "region"> = {}): Prior[] {
  const regions = hazardRegions(options.region);
  const tables = list.priors ?? [];
  const priors: Prior[] = [];
  for (const hazard of list.hazards) {
    for (const region of regions) {
      const table = tables.find((item) => item.scheme === region.scheme && item.rates[hazard.case] !== undefined && item.codes.includes(region.code));
      if (table === undefined) continue;
      const [perYear, reach] = table.rates[hazard.case]?.[region.code] ?? [0, 0];
      const source = list.sources[table.source]?.url ?? table.source;
      priors.push({ case: hazard.case, place: `${region.scheme}:${region.code}`, perYear, reach, source, asOf: table.asOf });
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
