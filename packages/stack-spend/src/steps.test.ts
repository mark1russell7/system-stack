import { SAMPLE_STACK, STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { SPEND_CODES } from "./check.ts";
import { SPEND_SCHEMA, type Proof, type Service, type SpendLayer } from "./layer.ts";
import { SAMPLE_SPEND, SAMPLE_TODAY } from "./sample.ts";
import { OWNER_CODES, ownerSteps } from "./steps.ts";

const today = "2026-11-16";
const proof: Proof = { date: "2026-11-01", by: "The owner" };
const stack: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "a", kind: "account", name: "The account A" },
    { id: "b", kind: "account" },
    { id: "program", kind: "service" },
  ],
};
const layer = (...services: Service[]): SpendLayer => ({ schema: SPEND_SCHEMA, currency: "USD", kinds: [], proofDays: 90, services });
const steps = (...services: Service[]): unknown => ownerSteps(layer(...services), stack, { today });

describe("ownerSteps", () => {
  it("gives no step for a layer that passes the gate", () => {
    expect(steps({ part: "a", billing: "free", proof }, { part: "b", billing: "metered", limits: [{ kind: "provider", amount: 5 }], proof })).toEqual([]);
  });

  it("gives the one step of the sample: stop the recharge of the call account", () => {
    expect(ownerSteps(SAMPLE_SPEND, SAMPLE_STACK, { today: SAMPLE_TODAY })).toEqual([
      {
        part: "call-account",
        name: "The account of the call service",
        code: "limit-recharge",
        text: "Stop the automatic recharge of the prepaid balance.",
        steps: ["Open the billing page of the account.", "Stop the automatic recharge.", "Save the change."],
      },
    ]);
  });

  it("gives a step for a wanted limit of the provider, with the amount and the currency", () => {
    expect(steps({ part: "a", billing: "metered", limits: [{ kind: "alert", amount: 5 }], wanted: { kind: "provider", amount: 10 }, proof, steps: ["Open the budget page."] })).toEqual([
      { part: "a", name: "The account A", code: "limit-wanted", text: "Set a hard limit of 10 USD for a month.", steps: ["Open the budget page."] },
    ]);
  });

  it("gives a step for a wanted balance and for a wanted alert", () => {
    expect(steps({ part: "a", billing: "metered", wanted: { kind: "prepaid", amount: 20 }, proof })).toMatchObject([{ text: "Keep a prepaid balance of 20 USD at most, with no automatic recharge." }]);
    expect(steps({ part: "a", billing: "metered", limits: [{ kind: "provider", amount: 9 }], wanted: { kind: "alert", amount: 4 }, proof })).toMatchObject([{ text: "Set an alert at 4 USD for a month." }]);
  });

  it("gives no step for a wanted stop by code: that is the work of a programmer", () => {
    expect(steps({ part: "a", billing: "metered", wanted: { kind: "code", amount: 10, stop: "program" }, proof })).toEqual([]);
  });

  it("gives a step to read the account for a record with no proof, and for an old proof", () => {
    const read = "Read the plan and the limits in the account, and give them with the date of the read.";
    expect(steps({ part: "b", billing: "free" })).toEqual([{ part: "b", name: "b", code: "proof-none", text: read, steps: [] }]);
    expect(steps({ part: "b", billing: "free", proof: { date: "2026-01-01", by: "The owner" } })).toEqual([{ part: "b", name: "b", code: "proof-old", text: read, steps: [] }]);
  });

  it("gives no step for a fault of the records", () => {
    expect(steps({ part: "a", billing: "metered", proof }, { part: "b", billing: "fixed", proof }, { part: "none", billing: "free", proof })).toEqual([]);
  });

  it("uses the first record of a part", () => {
    expect(steps({ part: "a", billing: "free", steps: ["The first."] }, { part: "a", billing: "free", steps: ["The second."] })).toMatchObject([{ code: "proof-none", steps: ["The first."] }]);
  });

  it("has only codes of the gate", () => {
    for (const code of OWNER_CODES) expect(SPEND_CODES).toContain(code);
  });

  it("refuses a date of the check that is not a date", () => {
    expect(() => ownerSteps(layer(), stack, { today: "" })).toThrow(RangeError);
  });
});
