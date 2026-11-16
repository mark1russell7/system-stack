import { SPEND_SCHEMA, type SpendLayer } from "./layer.ts";

/** The date of the check of the sample. With it, the gate gives the faults that the README shows. */
export const SAMPLE_TODAY = "2026-11-16";

/**
 * A sample spend layer for `SAMPLE_STACK` of the core. Each name and each amount is an example.
 * It has two faults: the only limit of the cloud account is an alert, and the balance of the call account gets money automatically.
 */
export const SAMPLE_SPEND: SpendLayer = {
  schema: SPEND_SCHEMA,
  currency: "USD",
  kinds: ["account"],
  proofDays: 90,
  services: [
    {
      part: "cloud-account",
      plan: "A free allowance, then a price for the use",
      billing: "metered",
      limits: [{ kind: "alert", amount: 5 }],
      proof: { date: "2026-11-10", by: "The owner", source: "The billing page of the account" },
    },
    {
      part: "push-account",
      plan: "A license that was paid one time",
      billing: "fixed",
      price: 0,
      proof: { date: "2026-11-10", by: "The owner", source: "The license page of the account" },
    },
    {
      part: "call-account",
      plan: "A price for each call",
      billing: "metered",
      limits: [
        { kind: "prepaid", amount: 20, recharge: true },
        { kind: "code", amount: 10, stop: "program-home" },
      ],
      proof: { date: "2026-11-10", by: "The owner", source: "The billing page of the account" },
      steps: ["Open the billing page of the account.", "Stop the automatic recharge.", "Save the change."],
    },
  ],
};
