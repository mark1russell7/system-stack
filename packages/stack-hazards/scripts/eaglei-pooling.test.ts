import { random } from "@mark1russell7/rigor-generators";
import { describe, expect, it } from "vitest";
import type { AreaCount, Observation } from "../src/priors.ts";
import { poolHoldout, poolScore, POOL_HOLDOUT_ROUNDS, POOL_HOLDOUT_SEED, thinCounts } from "./eaglei-pooling.ts";

// Made-up counties of the made-up states 98 and 99.
const observation: Observation = { years: { "99001": 5, "99002": 5, "99003": 1, "98001": 5, "98002": 5 }, customers: { "99001": 10, "99002": 10, "99003": 10, "98001": 10, "98002": 10 } };

describe("thinCounts", () => {
  it("puts each event in one half, with its share, and gives the same halves for the same draws", () => {
    const counts: Record<string, AreaCount> = { "99001": { events: 40, share: 8 }, "99002": { events: 0, share: 0 } };
    const draws = random(7);
    const [fit, score] = thinCounts(counts, () => draws.chance(0.5));
    expect((fit["99001"]?.events ?? 0) + (score["99001"]?.events ?? 0)).toBe(40);
    expect((fit["99001"]?.share ?? 0) + (score["99001"]?.share ?? 0)).toBeCloseTo(8, 12);
    expect(fit["99002"]).toEqual({ events: 0, share: 0 });
    const again = random(7);
    expect(thinCounts(counts, () => again.chance(0.5))).toEqual([fit, score]);
    // All events go to the fit half when each draw is true.
    expect(thinCounts(counts, () => true)[1]["99001"]).toEqual({ events: 0, share: 0 });
  });
});

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
    const stream = random(POOL_HOLDOUT_SEED).fork("case.a");
    const [fit, score] = thinCounts(priors.counts["case.a"], () => stream.chance(0.5));
    expect(poolHoldout(priors, POOL_HOLDOUT_SEED, 1)).toMatchObject({ rounds: 1, cases: { "case.a": poolScore(fit, score, observation) } });
    expect(() => poolHoldout(priors, POOL_HOLDOUT_SEED, 0)).toThrow(/rounds/u);
  });
});
