import { random } from "@mark1russell7/rigor-generators";
import { thinUnits } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import type { Observation } from "../src/priors.ts";
import { poolHoldout, poolScore, POOL_HOLDOUT_ROUNDS, POOL_HOLDOUT_SEED, regionPart, splitYears, timeHoldout } from "./eaglei-pooling.ts";

// Made-up counties of the made-up states 98 and 99.
const observation: Observation = { years: { "99001": 5, "99002": 5, "99003": 1, "98001": 5, "98002": 5 }, customers: { "99001": 10, "99002": 10, "99003": 10, "98001": 10, "98002": 10 } };

describe("poolScore", () => {
  it("gives -Infinity to the raw rates when a county with no event in the fit half has an event in the score half", () => {
    const fit = { "99001": { events: 10, share: 1 }, "99002": { events: 0, share: 0 } };
    const score = { "99001": { events: 9, share: 1 }, "99002": { events: 1, share: 0.1 } };
    const result = poolScore(fit, score, observation);
    expect(result.raw).toBe(Number.NEGATIVE_INFINITY);
    expect(result.lost).toBe(1);
    expect(Number.isFinite(result.pooled)).toBe(true);
    expect(Number.isFinite(result.state)).toBe(true);
    // The finite scores keep only the county with events in the fit half.
    expect(result.seen.areas).toBe(1);
    expect(Number.isFinite(result.seen.raw)).toBe(true);
    expect(result.seen.raw).toBeLessThan(0);
  });

  it("gives the state with no event the same rate in the pooled and the state methods, so the two scores of its counties are equal", () => {
    const fit = { "99001": { events: 10, share: 1 } };
    const score = { "98001": { events: 1, share: 0.1 } };
    const only98: Observation = { years: { "98001": 5, "98002": 5, "99001": 5 }, customers: { "98001": 10, "98002": 10, "99001": 10 } };
    const result = poolScore(fit, score, only98);
    const without = poolScore(fit, {}, only98);
    // The county 98001 adds the same term to each of the two methods.
    expect(result.pooled - without.pooled).toBeCloseTo(result.state - without.state, 12);
  });
});

describe("poolScore with the years of the score part", () => {
  it("scores each count in its own years, and leaves out an area with no year in the score part", () => {
    const fit = { "99001": { events: 10, share: 0 }, "99002": { events: 5, share: 0 } };
    const score = { "99001": { events: 4, share: 0 } };
    // 99001 has 5 fit years and 2 score years. 99002 has no score year, so it is not scored.
    const result = poolScore(fit, score, observation, undefined, { "99001": 2 });
    // The raw rate of 99001 is 10 / 5 = 2 a year: 4 expected events in 2 years, and 4 events.
    expect(result.squared.raw).toBeCloseTo(0, 12);
    expect(result.seen.areas).toBe(1);
    // The Poisson log-likelihood of 4 events with the mean 4.
    expect(result.raw).toBeCloseTo(4 * Math.log(4) - 4 - Math.log(24), 12);
    // With the same years in the two parts, the score is the thinning score.
    expect(poolScore(fit, score, observation, undefined, observation.years)).toEqual(poolScore(fit, score, observation));
  });
});

describe("splitYears and timeHoldout", () => {
  const yearly = {
    observed: { "99001": [2014, 2015, 2016, 2017], "99002": [2014, 2017], "99003": [2016, 2017], "98001": [2014, 2015] },
    counts: { "case.a": { "2014": { "99001": 2, "99002": 1, "98001": 7 }, "2016": { "99001": 1, "99003": 3 }, "2017": { "99001": 5, "99002": 2 } } },
  };
  const seen: Observation = { years: { "99001": 4, "99002": 2, "99003": 2, "98001": 2 }, customers: { "99001": 10, "99002": 10, "99003": 10, "98001": 10 } };

  it("fits the early half of the years and scores the later half, with only the areas in the two parts", () => {
    const split = splitYears(yearly, seen);
    expect(split.years).toEqual({ fit: [2014, 2015], score: [2016, 2017] });
    // 99003 has no early year and 98001 has no late year, so they are not in the parts.
    expect(split.fit.observation).toEqual({ years: { "99001": 2, "99002": 1 }, customers: { "99001": 10, "99002": 10 } });
    expect(split.score.observation).toEqual({ years: { "99001": 2, "99002": 1 }, customers: { "99001": 10, "99002": 10 } });
    expect(split.fit.counts).toEqual({ "case.a": { "99001": { events: 2, share: 0 }, "99002": { events: 1, share: 0 } } });
    expect(split.score.counts).toEqual({ "case.a": { "99001": { events: 6, share: 0 }, "99002": { events: 2, share: 0 } } });
    expect(splitYears(yearly, seen, 2017).years).toEqual({ fit: [2014, 2016], score: [2017, 2017] });
    expect(() => splitYears(yearly, seen, 2014)).toThrow(RangeError);
    expect(() => splitYears(yearly, seen, 2018)).toThrow(RangeError);
    expect(() => splitYears({ observed: {}, counts: {} }, seen)).toThrow(RangeError);
  });

  it("gives the scores of poolScore with no reach, and a holdout of the states as areas", () => {
    const split = splitYears(yearly, seen);
    const holdout = timeHoldout(split);
    expect(holdout).toMatchObject({ fit: [2014, 2015], score: [2016, 2017], areas: 2 });
    const { reach: _, ...expected } = poolScore(split.fit.counts["case.a"] ?? {}, split.score.counts["case.a"] ?? {}, split.fit.observation, undefined, split.score.observation.years);
    expect(holdout.cases["case.a"]).toEqual(expected);
    const states = { ...split, fit: regionPart(split.fit), score: regionPart(split.score) };
    expect(states.fit.counts["case.a"]).toEqual({ "99": { events: 3, share: 0 } });
    const nation = timeHoldout(states, () => "nation");
    expect(nation.areas).toBe(1);
    expect(Object.keys(nation.cases)).toEqual(["case.a"]);
  });
});

describe("poolHoldout", () => {
  it("scores each case with its own stream of draws from the seed, and gives the same record for the same seed", () => {
    const priors = { observation, counts: { "case.a": { "99001": { events: 30, share: 3 }, "99003": { events: 1, share: 0.5 } }, "case.b": { "98001": { events: 4, share: 1 } } } };
    const holdout = poolHoldout(priors);
    expect(holdout).toMatchObject({ seed: POOL_HOLDOUT_SEED, rounds: POOL_HOLDOUT_ROUNDS });
    expect(Object.keys(holdout.cases)).toEqual(["case.a", "case.b"]);
    // Each case has a score of the reach, with the same count of counties for the two methods.
    for (const score of Object.values(holdout.cases)) expect(score.reach.plain.error).toBeGreaterThanOrEqual(Math.abs(score.reach.plain.bias) - 1e-12);
    expect(poolHoldout(priors)).toEqual(holdout);
    // A new case does not change the draws of the other cases.
    expect(poolHoldout({ ...priors, counts: { ...priors.counts, "case.c": {} } }).cases["case.a"]).toEqual(holdout.cases["case.a"]);
    // With one round, the score is the score of the first split of the stream of the case.
    // Each county keeps the mean share of its events in each half.
    const stream = random(POOL_HOLDOUT_SEED).fork("case.a");
    const units = [
      { area: "99001", count: 30, exposure: 5, each: 0.1 },
      { area: "99003", count: 1, exposure: 1, each: 0.5 },
    ];
    const half = (list: readonly (typeof units)[number][]) => Object.fromEntries(list.map((unit) => [unit.area, { events: unit.count, share: unit.each * unit.count }]));
    const [fit, score] = thinUnits(units, () => stream.chance(0.5));
    expect(poolHoldout(priors, POOL_HOLDOUT_SEED, 1)).toMatchObject({ rounds: 1, cases: { "case.a": poolScore(half(fit), half(score), observation) } });
    expect(() => poolHoldout(priors, POOL_HOLDOUT_SEED, 0)).toThrow(/rounds/u);
  });
});
