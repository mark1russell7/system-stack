import { random } from "@mark1russell7/rigor-generators";
import { splitHoldout, thinUnits, type RateUnit, type ThinningScore } from "@mark1russell7/rigor-statistics";
import { eagleRegion } from "../src/eaglei.ts";
import type { PoolHoldout, PoolScore, PoolTimeHoldout, PoolTimeScore } from "../src/hazard.ts";
import { pooledRates, regionCounts, regionObservation, type AreaCount, type Observation } from "../src/priors.ts";
import type { EaglePriors, YearlyCounts } from "./eaglei-fit.ts";

// The gates of the pooled rates of the counties and of the states: a holdout by the thinning of the counts, and a holdout over time.
// Thinning: each event goes to the fit half or to the score half with the chance 1/2 (`thinUnits` of `rigor-statistics`).
// Each half of a Poisson count is then an independent Poisson count with half the rate. A method fits its rates on the fit half, and the score half scores them.
// `splitHoldout` of `rigor-statistics` gives the scores of the rates of each split.
// Over time: a method fits its rates on the events of the early years, and the events of the later years score them (`timeHoldout`).
// It needs the counts of each year, which a record of a fit before 0.6.8 does not have.

/** The seed of the holdout of the committed modules. */
export const POOL_HOLDOUT_SEED = 20261124;

/** The number of splits of each case in the holdout of the committed modules. The mean of some splits makes the margins less noisy. */
export const POOL_HOLDOUT_ROUNDS = 5;

/** A county as a unit of a split: its events, its years and the mean share of its events. Each half of a split keeps the mean share. */
interface AreaUnit extends RateUnit {
  readonly area: string;
  readonly each: number;
}

/** This function gives the counts of the areas of the units of one half of a split. The share of an area is its events times their mean share. */
function unitCounts(units: readonly AreaUnit[]): Record<string, AreaCount> {
  return Object.fromEntries(units.map((unit) => [unit.area, { events: unit.count, share: unit.each * unit.count }]));
}

/**
 * This function gives the scores of the methods of one case on one split.
 * The default group of an area is its state (`eagleRegion`). With the states as the areas and one group for the nation, it scores the pooled state rates.
 * The rates come from the counts of `fit` in the years of `observation`.
 * The option `scoreYears` gives the years of the counts of `score`, for a split over time. Then only an area with years in the two halves has a score.
 * With no option, the counts of `score` are in the years of `observation`, as in a thinning split.
 */
export function poolScore(
  fit: Readonly<Record<string, AreaCount>>,
  score: Readonly<Record<string, AreaCount>>,
  observation: Observation,
  group: (area: string) => string = eagleRegion,
  scoreYears?: Readonly<Record<string, number>>,
): PoolScore {
  const pooled = pooledRates(fit, observation, group);
  const areas = Object.keys(observation.years)
    .filter((area) => (observation.years[area] ?? 0) > 0 && (observation.customers[area] ?? 0) > 0 && (scoreYears === undefined || (scoreYears[area] ?? 0) > 0))
    .sort();
  // One rate for each state: the events of its observed counties over their years.
  const totals = new Map<string, { events: number; years: number }>();
  for (const area of areas) {
    const total = totals.get(group(area)) ?? { events: 0, years: 0 };
    total.events += fit[area]?.events ?? 0;
    total.years += observation.years[area] ?? 0;
    totals.set(group(area), total);
  }
  // The events-weighted reach of each state in the fit half, and of all states for a state with no event.
  const shares = new Map<string, { share: number; events: number }>();
  for (const area of areas) {
    const sum = shares.get(group(area)) ?? { share: 0, events: 0 };
    sum.share += fit[area]?.share ?? 0;
    sum.events += fit[area]?.events ?? 0;
    shares.set(group(area), sum);
  }
  const all = [...shares.values()].reduce((sum, item) => ({ share: sum.share + item.share, events: sum.events + item.events }), { share: 0, events: 0 });
  const reach = { areas: 0, plain: { bias: 0, error: 0 }, events: { bias: 0, error: 0 } };
  for (const area of areas) {
    const held = score[area];
    if ((fit[area]?.events ?? 0) > 0 || held === undefined || held.events === 0) continue;
    const truth = held.share / held.events;
    const state = shares.get(group(area)) ?? { share: 0, events: 0 };
    const weighted = state.events > 0 ? state.share / state.events : all.events > 0 ? all.share / all.events : 0;
    const rates = { plain: pooled.rates[area]?.[1] ?? 0, events: Math.min(1, weighted) };
    for (const method of ["plain", "events"] as const) {
      reach[method].bias += rates[method] - truth;
      reach[method].error += Math.abs(rates[method] - truth);
    }
    reach.areas += 1;
  }
  // The rate of each area in each method, from the fit half. The score half scores them in the years of the score part.
  const methodRates = { raw: [] as number[], pooled: [] as number[], state: [] as number[] };
  for (const area of areas) {
    const code = group(area);
    const total = totals.get(code) ?? { events: 0, years: 1 };
    const law = pooled.laws[code];
    methodRates.raw.push((fit[area]?.events ?? 0) / (observation.years[area] ?? 0));
    methodRates.pooled.push(pooled.rates[area]?.[0] ?? 0);
    methodRates.state.push(law?.from === "nation" ? law.mean : total.events / total.years);
  }
  if (areas.length === 0) return { raw: 0, pooled: 0, state: 0, lost: 0, squared: { raw: 0, pooled: 0, state: 0 }, seen: { raw: 0, pooled: 0, state: 0, areas: 0 }, reach };
  const split = splitHoldout(
    areas.map((area) => ({ count: fit[area]?.events ?? 0, exposure: observation.years[area] ?? 0 })),
    areas.map((area) => ({ count: score[area]?.events ?? 0, exposure: scoreYears === undefined ? (observation.years[area] ?? 0) : (scoreYears[area] ?? 0) })),
    { raw: () => methodRates.raw, pooled: () => methodRates.pooled, state: () => methodRates.state },
  );
  const scores = split.methods as Readonly<Record<"raw" | "pooled" | "state", ThinningScore>>;
  return {
    raw: scores.raw.logLikelihood,
    pooled: scores.pooled.logLikelihood,
    state: scores.state.logLikelihood,
    // A county with no event in the fit half has the raw rate 0. Thus only the raw rates lose a county.
    lost: scores.raw.lost,
    squared: { raw: scores.raw.squared, pooled: scores.pooled.squared, state: scores.state.squared },
    seen: { raw: scores.raw.seen, pooled: scores.pooled.seen, state: scores.state.seen, areas: split.seenUnits },
    reach,
  };
}

/** The mean of some scores. */
function meanScore(scores: readonly PoolScore[]): PoolScore {
  const mean = (read: (score: PoolScore) => number): number => scores.reduce((sum, score) => sum + read(score), 0) / scores.length;
  return {
    raw: mean((score) => score.raw),
    pooled: mean((score) => score.pooled),
    state: mean((score) => score.state),
    lost: mean((score) => score.lost),
    squared: { raw: mean((score) => score.squared.raw), pooled: mean((score) => score.squared.pooled), state: mean((score) => score.squared.state) },
    seen: { raw: mean((score) => score.seen.raw), pooled: mean((score) => score.seen.pooled), state: mean((score) => score.seen.state), areas: mean((score) => score.seen.areas) },
    reach: {
      areas: mean((score) => score.reach.areas),
      plain: { bias: mean((score) => score.reach.plain.bias), error: mean((score) => score.reach.plain.error) },
      events: { bias: mean((score) => score.reach.events.bias), error: mean((score) => score.reach.events.error) },
    },
  };
}

/**
 * This function gives the holdout of each case of the counts of a fit: the mean scores of some splits.
 * Each case has its own stream of draws, so a new case does not change the scores of the other cases.
 * The option `group` gives the group of each area, as in `poolScore`.
 */
export function poolHoldout(priors: EaglePriors, seed: number = POOL_HOLDOUT_SEED, rounds: number = POOL_HOLDOUT_ROUNDS, group: (area: string) => string = eagleRegion): PoolHoldout {
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new RangeError(`poolHoldout: rounds is a whole number from 1, not ${rounds}.`);
  const draws = random(seed);
  const cases: Record<string, PoolScore> = {};
  for (const name of Object.keys(priors.counts).sort()) {
    const stream = draws.fork(name);
    const counts = priors.counts[name] ?? {};
    // The units in the order of the codes. The draws go in the order of the units, and then in the order of the events.
    const units: AreaUnit[] = Object.keys(counts)
      .sort()
      .map((area) => {
        const { events, share } = counts[area] as AreaCount;
        return { area, count: events, exposure: priors.observation.years[area] ?? 0, each: events > 0 ? share / events : 0 };
      });
    const scores: PoolScore[] = [];
    for (let round = 0; round < rounds; round++) {
      const [fit, score] = thinUnits(units, () => stream.chance(0.5));
      scores.push(poolScore(unitCounts(fit), unitCounts(score), priors.observation, group));
    }
    cases[name] = meanScore(scores);
  }
  return { seed, rounds, cases };
}

/** The counts of the areas in one part of the years: the observation of the part and the counts of each case. */
export interface YearPart {
  readonly observation: Observation;
  readonly counts: Readonly<Record<string, Readonly<Record<string, AreaCount>>>>;
}

/** The two parts of a split over time, with the first and the last year of each part. */
export interface YearSplit {
  readonly fit: YearPart;
  readonly score: YearPart;
  readonly years: { readonly fit: readonly [number, number]; readonly score: readonly [number, number] };
}

/**
 * This function splits the counts of each year at a year: the fit part has the years before it, and the score part has that year and the later years.
 * Only an area of `observation` with years in the two parts is in the parts. Its years in a part are the calendar years of the part in which the files list it.
 * The share of each count is 0, so a holdout over time does not score the reach.
 * The default split is the middle of the years of the areas: with the years 2014 to 2025, the fit part has 2014 to 2019.
 *
 * @throws RangeError when the areas have no year, or the split leaves a part with no year
 */
export function splitYears(yearly: YearlyCounts, observation: Observation, split?: number): YearSplit {
  const candidates = Object.keys(observation.years)
    .filter((area) => (observation.years[area] ?? 0) > 0 && (observation.customers[area] ?? 0) > 0)
    .sort();
  const all = candidates.flatMap((area) => yearly.observed[area] ?? []);
  if (all.length === 0) throw new RangeError("splitYears: the areas have no year.");
  const first = all.reduce((low, year) => Math.min(low, year), Number.POSITIVE_INFINITY);
  const last = all.reduce((high, year) => Math.max(high, year), Number.NEGATIVE_INFINITY);
  const cut = split ?? first + Math.ceil((last - first + 1) / 2);
  if (!(Number.isSafeInteger(cut) && cut > first && cut <= last)) throw new RangeError(`splitYears: the split ${String(cut)} leaves a part with no year of ${String(first)} to ${String(last)}.`);
  const fitObservation = { years: {} as Record<string, number>, customers: {} as Record<string, number> };
  const scoreObservation = { years: {} as Record<string, number>, customers: {} as Record<string, number> };
  for (const area of candidates) {
    const years = yearly.observed[area] ?? [];
    const early = years.filter((year) => year < cut).length;
    const late = years.length - early;
    if (early === 0 || late === 0) continue;
    const customers = observation.customers[area] ?? 0;
    fitObservation.years[area] = early;
    fitObservation.customers[area] = customers;
    scoreObservation.years[area] = late;
    scoreObservation.customers[area] = customers;
  }
  const fitCounts: Record<string, Record<string, AreaCount>> = {};
  const scoreCounts: Record<string, Record<string, AreaCount>> = {};
  for (const name of Object.keys(yearly.counts).sort()) {
    const early = new Map<string, number>();
    const late = new Map<string, number>();
    for (const [year, areas] of Object.entries(yearly.counts[name] ?? {})) {
      const part = Number(year) < cut ? early : late;
      for (const [area, events] of Object.entries(areas)) if (fitObservation.years[area] !== undefined) part.set(area, (part.get(area) ?? 0) + events);
    }
    const record = (sums: ReadonlyMap<string, number>): Record<string, AreaCount> => Object.fromEntries([...sums.keys()].sort().map((area) => [area, { events: sums.get(area) ?? 0, share: 0 }]));
    fitCounts[name] = record(early);
    scoreCounts[name] = record(late);
  }
  return {
    fit: { observation: fitObservation, counts: fitCounts },
    score: { observation: scoreObservation, counts: scoreCounts },
    years: { fit: [first, cut - 1], score: [cut, last] },
  };
}

/** This function gives a part of the years with each region as one area, as `regionObservation` and `regionCounts` give it. The default region is the state. */
export function regionPart(part: YearPart, region: (area: string) => string = eagleRegion): YearPart {
  return {
    observation: regionObservation(part.observation, region),
    counts: Object.fromEntries(Object.entries(part.counts).map(([name, counts]) => [name, regionCounts(counts, part.observation, region)])),
  };
}

/**
 * This function gives the holdout over time of each case of a split: the rates come from the fit part, and the score part scores them (`poolScore`).
 * The option `group` gives the group of each area, as in `poolScore`.
 */
export function timeHoldout(split: YearSplit, group: (area: string) => string = eagleRegion): PoolTimeHoldout {
  const cases: Record<string, PoolTimeScore> = {};
  for (const name of Object.keys(split.fit.counts).sort()) {
    const { reach: _, ...score } = poolScore(split.fit.counts[name] ?? {}, split.score.counts[name] ?? {}, split.fit.observation, group, split.score.observation.years);
    cases[name] = score;
  }
  const areas = Object.keys(split.fit.observation.years).filter((area) => (split.fit.observation.years[area] ?? 0) > 0 && (split.score.observation.years[area] ?? 0) > 0).length;
  return { fit: split.years.fit, score: split.years.score, areas, cases };
}
