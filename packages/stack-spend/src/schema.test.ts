import { SAMPLE_STACK } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkSpend } from "./check.ts";
import { SAMPLE_ENDS, SAMPLE_READS, SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";
import { parseReads, parseSpend } from "./schema.ts";
import { checkUse } from "./use-check.ts";

const sample = (): Record<string, unknown> => JSON.parse(JSON.stringify(SAMPLE_SPEND)) as Record<string, unknown>;
const service = (fields: Record<string, unknown>): unknown => ({ ...sample(), services: [{ part: "a", billing: "free", ...fields }] });

describe("parseSpend", () => {
  it("reads the sample from its JSON, with no change", () => {
    expect(parseSpend(sample())).toEqual({ ok: true, layer: SAMPLE_SPEND });
  });

  it("gives a layer that the gate can examine", () => {
    const read = parseSpend(sample());
    expect(read.ok).toBe(true);
    if (read.ok) expect(checkSpend(read.layer, SAMPLE_STACK, { today: SAMPLE_TODAY })).toHaveLength(2);
  });

  it("reads the sample of ends from its JSON, with no change", () => {
    expect(parseSpend(JSON.parse(JSON.stringify(SAMPLE_ENDS)))).toEqual({ ok: true, layer: SAMPLE_ENDS });
  });

  it("reads the end of a plan, with a plan after the end or with none, and the days of warning", () => {
    expect(parseSpend(service({ ends: { date: "2026-12-01" } })).ok).toBe(true);
    expect(parseSpend(service({ ends: { date: "2026-12-01", next: { plan: "Paid", billing: "metered", price: 1, limits: [{ kind: "provider", amount: 5 }] } } })).ok).toBe(true);
    expect(parseSpend({ ...sample(), endDays: 0 }).ok).toBe(true);
    expect(parseSpend({ ...sample(), endDays: 14 })).toMatchObject({ ok: true, layer: { endDays: 14 } });
  });

  it("reads the decision about an end, and refuses a decision with no date, with no person or with a different field", () => {
    const decided = { date: "2026-11-10", by: "The owner" };
    expect(parseSpend(service({ ends: { date: "2026-12-01", decided } })).ok).toBe(true);
    expect(parseSpend(service({ ends: { date: "2026-12-01", next: { billing: "fixed", price: 20 }, decided } })).ok).toBe(true);
    expect(parseSpend(service({ ends: { date: "2026-12-01", decided: { by: "The owner" } } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", decided: { date: "2026-11-10" } } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", decided: { date: "2026-11-10", by: "" } } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", decided: { ...decided, result: "stop" } } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", decided: true } })).ok).toBe(false);
  });

  it("refuses an end with no date, a plan after the end with no billing, and a field that the format does not have", () => {
    expect(parseSpend(service({ ends: {} })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: 20261201 } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", next: {} } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", next: { billing: "trial" } } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", then: "stop" } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", next: { billing: "free", wanted: { kind: "alert", amount: 1 } } } })).ok).toBe(false);
    expect(parseSpend(service({ ends: { date: "2026-12-01", next: { billing: "metered", limits: [{ kind: "cap", amount: 1 }] } } })).ok).toBe(false);
  });

  it("refuses days of warning that are less than 0 or no number", () => {
    expect(parseSpend({ ...sample(), endDays: -1 }).ok).toBe(false);
    expect(parseSpend({ ...sample(), endDays: "30" }).ok).toBe(false);
  });

  it("reads a layer with no service", () => {
    expect(parseSpend({ ...sample(), services: [] }).ok).toBe(true);
  });

  it("refuses a different format", () => {
    const read = parseSpend({ ...sample(), schema: "spend/2" });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors[0]).toContain('The record "spend/1" has a fault at "schema"');
  });

  it("refuses a field that the format does not have, and names its place", () => {
    const read = parseSpend(service({ limit: [] }));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors.join(" ")).toContain('"services.0"');
  });

  it("refuses a currency that is not a code of three capital letters", () => {
    for (const currency of ["usd", "US", "DOLLAR", ""]) expect(parseSpend({ ...sample(), currency }).ok).toBe(false);
  });

  it("refuses a largest age of a proof that is not more than 0", () => {
    for (const proofDays of [0, -1, "90"]) expect(parseSpend({ ...sample(), proofDays }).ok).toBe(false);
  });

  it("refuses an unknown billing and an unknown kind of limit", () => {
    expect(parseSpend(service({ billing: "paid" })).ok).toBe(false);
    expect(parseSpend(service({ limits: [{ kind: "soft", amount: 1 }] })).ok).toBe(false);
    expect(parseSpend(service({ wanted: { kind: "soft", amount: 1 } })).ok).toBe(false);
  });

  it("refuses an amount and a price that are not numbers", () => {
    expect(parseSpend(service({ price: "4" })).ok).toBe(false);
    expect(parseSpend(service({ limits: [{ kind: "provider", amount: "10" }] })).ok).toBe(false);
    expect(parseSpend(service({ limits: [{ kind: "provider" }] })).ok).toBe(false);
  });

  it("refuses an empty part, an empty stop and a proof with no reader", () => {
    expect(parseSpend(service({ part: "" })).ok).toBe(false);
    expect(parseSpend(service({ limits: [{ kind: "code", amount: 1, stop: "" }] })).ok).toBe(false);
    expect(parseSpend(service({ proof: { date: "2026-11-10" } })).ok).toBe(false);
    expect(parseSpend(service({ proof: { date: "2026-11-10", by: "" } })).ok).toBe(false);
  });

  it("leaves the meaning to the gate: a negative amount and a date that is no date have a correct form", () => {
    const read = parseSpend(service({ billing: "metered", limits: [{ kind: "provider", amount: -1 }], proof: { date: "soon", by: "The owner" } }));
    expect(read.ok).toBe(true);
  });

  it("refuses a value that is not a record", () => {
    for (const value of [null, 3, "spend/1", []]) {
      const read = parseSpend(value);
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("parseReads", () => {
  it("reads the sample reads from their JSON, with no change", () => {
    expect(parseReads(JSON.parse(JSON.stringify(SAMPLE_READS)))).toEqual({ ok: true, reads: SAMPLE_READS });
  });

  it("gives reads that the gate can examine", () => {
    const read = parseReads(JSON.parse(JSON.stringify(SAMPLE_READS)));
    expect(read.ok).toBe(true);
    if (read.ok) expect(checkUse(SAMPLE_SPEND, read.reads, { today: SAMPLE_TODAY })).toHaveLength(2);
  });

  it("reads an empty list", () => {
    expect(parseReads([])).toEqual({ ok: true, reads: [] });
  });

  it("names the place of a fault of the form", () => {
    expect(parseReads([{ part: "a", source: "count", amount: 1, date: "2026-11-16" }, { part: "a", source: "guess", amount: 1, date: "2026-11-16" }])).toEqual({
      ok: false,
      errors: ['The record "spend/1 reads" has a fault at "1.source": Invalid option: expected one of "count"|"provider"'],
    });
  });

  it("refuses an empty part, an amount that is no finite number, a field that the format does not have and a value that is no list", () => {
    const one = (fields: Record<string, unknown>): unknown => [{ part: "a", source: "count", amount: 1, date: "2026-11-16", ...fields }];
    expect(parseReads(one({})).ok).toBe(true);
    expect(parseReads(one({ part: "" })).ok).toBe(false);
    expect(parseReads(one({ amount: "1" })).ok).toBe(false);
    expect(parseReads(one({ amount: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(parseReads(one({ month: "2026-11" })).ok).toBe(false);
    for (const value of [null, 3, {}, "reads"]) expect(parseReads(value).ok).toBe(false);
  });

  it("leaves the meaning to the gate: a negative amount and a date that is no date have a correct form", () => {
    expect(parseReads([{ part: "a", source: "provider", amount: -1, date: "soon" }]).ok).toBe(true);
  });
});
