import { random } from "@mark1russell7/rigor-generators";
import { gammaPoissonLogLikelihood } from "@mark1russell7/rigor-statistics";
import { eagleRegion } from "../src/eaglei.ts";
import type { PoolHoldout, PoolScore } from "../src/hazard.ts";
import { pooledRates, type AreaCount, type Observation } from "../src/priors.ts";
import type { EaglePriors } from "./eaglei-fit.ts";

// The gate of the pooled county rates: a holdout by the thinning of the counts.
// The record of a fit has the total events of each county, not the events of each year. Thus a holdout of the later years is not possible.
// Each event goes to the fit half or to the score half with the chance 1/2. Each half of a Poisson count is then an independent
// Poisson count with half the rate. A method fits its rates on the fit half, and the score half scores them.

/** The seed of the holdout of the committed modules. */
export const POOL_HOLDOUT_SEED = 20261124;

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

/** This function gives the scores of the methods of one case on one split. */
export function poolScore(fit: Readonly<Record<string, AreaCount>>, score: Readonly<Record<string, AreaCount>>, observation: Observation): PoolScore {
  const pooled = pooledRates(fit, observation, eagleRegion);
  const areas = Object.keys(observation.years)
    .filter((area) => (observation.years[area] ?? 0) > 0 && (observation.customers[area] ?? 0) > 0)
    .sort();
  // One rate for each state: the events of its observed counties over their years.
  const totals = new Map<string, { events: number; years: number }>();
  for (const area of areas) {
    const total = totals.get(eagleRegion(area)) ?? { events: 0, years: 0 };
    total.events += fit[area]?.events ?? 0;
    total.years += observation.years[area] ?? 0;
    totals.set(eagleRegion(area), total);
  }
  const sums = { raw: 0, pooled: 0, state: 0 };
  const squared = { raw: 0, pooled: 0, state: 0 };
  let lost = 0;
  for (const area of areas) {
    const years = observation.years[area] ?? 0;
    const count = score[area]?.events ?? 0;
    const code = eagleRegion(area);
    const total = totals.get(code) ?? { events: 0, years: 1 };
    const law = pooled.laws[code];
    const rate = { raw: (fit[area]?.events ?? 0) / years, pooled: pooled.rates[area]?.[0] ?? 0, state: law?.from === "nation" ? law.mean : total.events / total.years };
    for (const method of ["raw", "pooled", "state"] as const) {
      sums[method] += logLikelihood(count, years, rate[method]);
      squared[method] += (count - rate[method] * years) ** 2;
    }
    if (rate.raw === 0 && count > 0) lost += 1;
  }
  return { ...sums, lost, squared };
}

/** This function gives the holdout of each case of the counts of a fit, with one stream of draws for each case. */
export function poolHoldout(priors: EaglePriors, seed: number = POOL_HOLDOUT_SEED): PoolHoldout {
  const draws = random(seed);
  const cases: Record<string, PoolScore> = {};
  for (const name of Object.keys(priors.counts).sort()) {
    const stream = draws.fork(name);
    const [fit, score] = thinCounts(priors.counts[name] ?? {}, () => stream.chance(0.5));
    cases[name] = poolScore(fit, score, priors.observation);
  }
  return { seed, cases };
}
