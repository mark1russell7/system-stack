import { SAMPLE_STACK } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkRisk } from "./check.ts";
import { SAMPLE_RISK, SAMPLE_TODAY } from "./sample.ts";
import { parseRisk } from "./schema.ts";

const sample = (): Record<string, unknown> => JSON.parse(JSON.stringify(SAMPLE_RISK)) as Record<string, unknown>;
const goal = (fields: Record<string, unknown>): unknown => ({ schema: "risk/1", goals: [{ part: "a", survives: 1, ...fields }] });

describe("parseRisk", () => {
  it("reads the sample from its JSON, with no change", () => {
    expect(parseRisk(sample())).toEqual({ ok: true, layer: SAMPLE_RISK });
  });

  it("gives a layer that the gate can examine", () => {
    const read = parseRisk(sample());
    expect(read.ok).toBe(true);
    if (read.ok) expect(checkRisk(read.layer, SAMPLE_STACK, { today: SAMPLE_TODAY })).toHaveLength(2);
  });

  it("reads a layer with goals only, and a layer with no goal", () => {
    expect(parseRisk(goal({}))).toEqual({ ok: true, layer: { schema: "risk/1", goals: [{ part: "a", survives: 1 }] } });
    expect(parseRisk({ schema: "risk/1", goals: [] }).ok).toBe(true);
  });

  it("refuses a different format", () => {
    const read = parseRisk({ ...sample(), schema: "risk/2" });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors[0]).toContain('The record "risk/1" has a fault at "schema"');
  });

  it("refuses a field that the format does not have, and names its place", () => {
    const read = parseRisk(goal({ owner: "a" }));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors[0]).toContain('"goals.0"');
    expect(parseRisk({ ...sample(), risks: [] }).ok).toBe(false);
  });

  it("reads a limit of time, a wait and delay points, and refuses a point with a wrong form", () => {
    const timed = { schema: "risk/1", goals: [{ part: "a", survives: 0, chance: 0.99, within: 60 }], chances: [{ part: "b", works: 0.9, wait: 30, delay: [{ within: 5, chance: 0.5 }] }] };
    expect(parseRisk(timed)).toEqual({ ok: true, layer: timed });
    expect(parseRisk({ ...timed, chances: [{ part: "b", works: 0.9, delay: [{ within: "5", chance: 0.5 }] }] }).ok).toBe(false);
    expect(parseRisk({ ...timed, chances: [{ part: "b", works: 0.9, delay: [{ within: 5, chance: 0.5, unit: "s" }] }] }).ok).toBe(false);
    expect(parseRisk({ ...timed, chances: [{ part: "b", works: 0.9, wait: "30" }] }).ok).toBe(false);
    expect(parseRisk(goal({ within: "60" })).ok).toBe(false);
  });

  it("refuses a value of the wrong type", () => {
    expect(parseRisk(goal({ survives: "1" })).ok).toBe(false);
    expect(parseRisk(goal({ part: "" })).ok).toBe(false);
    expect(parseRisk(goal({ chance: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(parseRisk({ schema: "risk/1", goals: [], chances: [{ part: "a", works: "0.9" }] }).ok).toBe(false);
    expect(parseRisk({ schema: "risk/1", goals: [], accepted: [{ part: "a", stop: ["b"], reason: "" }] }).ok).toBe(false);
    expect(parseRisk({ schema: "risk/1", goals: [], accepted: [{ part: "a", stop: "b", reason: "An example" }] }).ok).toBe(false);
    expect(parseRisk({ schema: "risk/1" }).ok).toBe(false);
    expect(parseRisk(null).ok).toBe(false);
  });

  it("keeps the meaning for the gate: a count that is not a whole number has a correct form", () => {
    const read = parseRisk({ schema: "risk/1", goals: [{ part: "alert", survives: 1.5 }] });
    expect(read.ok).toBe(true);
    if (read.ok) expect(checkRisk(read.layer, SAMPLE_STACK, { today: SAMPLE_TODAY }).map((fault) => fault.code)).toEqual(["goal-survives"]);
  });
});
