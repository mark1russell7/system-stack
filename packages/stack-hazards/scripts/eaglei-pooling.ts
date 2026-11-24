import { random } from "@mark1russell7/rigor-generators";
import { gammaPoissonLogLikelihood } from "@mark1russell7/rigor-statistics";
import { eagleRegion } from "../src/eaglei.ts";
import type { PoolHoldout, PoolScore } from "../src/hazard.ts";
import { pooledRates, type AreaCount, type Observation } from "../src/priors.ts";
import type { EaglePriors } from "./eaglei-fit.ts";

// The gate of the pooled rates of the counties and of the states: a holdout by the thinning of the counts.
// The record of a fit has the total events of each county, not the events of each year. Thus a holdout of the later years is not possible.
// Each event goes to the fit half or to the score half with the chance 1/2. Each half of a Poisson count is then an independent
// Poisson count with half the rate. A method fits its rates on the fit half, and the score half scores them.

/** The seed of the holdout of the committed modules. */
export const POOL_HOLDOUT_SEED = 20261124;

/** The number of splits of each case in the holdout of the committed modules. The mean of some splits makes the margins less noisy. */
export const POOL_HOLDOUT_ROUNDS = 5;

/** This function splits the events of each county into two halves, each event with the chance 1/2. The share of an event goes with it in proportion. */
export function thinCounts(counts: Readonly<Record<string, AreaCount>>, draw: () => boolean): readonly [Record<string, AreaCount>, Record<string, AreaCount>] {
  const fit: Record<string, AreaCount> = {};
  const score: Record<string, AreaCount> = {};
  for (const area of Object.keys(counts).sort()) {
    const { events, share } = counts[area] as AreaCount;
    let kept = 0;
    for (let k = 0; k < events; k++) if (draw()) kept += 1;
    const each = events > 0 ? share / events : 0;
    fit[area] = { events: kept, share: each * kept };
    score[area] = { events: events - kept, share: each * (events - kept) };
  }
  return [fit, score];
}

/** The Poisson log-likelihood of a count in its years, with a rate of events in one year. */
function logLikelihood(count: number, years: number, rate: number): number {
  return gammaPoissonLogLikelihood([{ count, exposure: years }], Number.POSITIVE_INFINITY, rate);
}

/**
 * This function gives the scores of the methods of one case on one split.
 * The default group of an area is its state (`eagleRegion`). With the states as the areas and one group for the nation, it scores the pooled state rates.
 */
export function poolScore(fit: Readonly<Record<string, AreaCount>>, score: Readonly<Record<string, AreaCount>>, observation: Observation, group: (area: string) => string = eagleRegion): PoolScore {
  const pooled = pooledRates(fit, observation, group);
  const areas = Object.keys(observation.years)
    .filter((area) => (observation.years[area] ?? 0) > 0 && (observation.customers[area] ?? 0) > 0)
    .sort();
  // One rate for each state: the events of its observed counties over their years.
  const totals = new Map<string, { events: number; years: number }>();
  for (const area of areas) {
    const total = totals.get(group(area)) ?? { events: 0, years: 0 };
    total.events += fit[area]?.events ?? 0;
    total.years += observation.years[area] ?? 0;
    totals.set(group(area), total);
  }
  const sums = { raw: 0, pooled: 0, state: 0 };
  const squared = { raw: 0, pooled: 0, state: 0 };
  const seen = { raw: 0, pooled: 0, state: 0, areas: 0 };
  let lost = 0;
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
  for (const area of areas) {
    const years = observation.years[area] ?? 0;
    const count = score[area]?.events ?? 0;
    const code = group(area);
    const total = totals.get(code) ?? { events: 0, years: 1 };
    const law = pooled.laws[code];
    const rate = { raw: (fit[area]?.events ?? 0) / years, pooled: pooled.rates[area]?.[0] ?? 0, state: law?.from === "nation" ? law.mean : total.events / total.years };
    for (const method of ["raw", "pooled", "state"] as const) {
      sums[method] += logLikelihood(count, years, rate[method]);
      squared[method] += (count - rate[method] * years) ** 2;
      if (rate.raw > 0) seen[method] += logLikelihood(count, years, rate[method]);
    }
    if (rate.raw > 0) seen.areas += 1;
    if (rate.raw === 0 && count > 0) lost += 1;
  }
  return { ...sums, lost, squared, seen, reach };
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
    const scores: PoolScore[] = [];
    for (let round = 0; round < rounds; round++) {
      const [fit, score] = thinCounts(priors.counts[name] ?? {}, () => stream.chance(0.5));
      scores.push(poolScore(fit, score, priors.observation, group));
    }
    cases[name] = meanScore(scores);
  }
  return { seed, rounds, cases };
}
