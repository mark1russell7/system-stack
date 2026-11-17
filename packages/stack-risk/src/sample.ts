import { RISK_SCHEMA, type RiskLayer } from "./layer.ts";

/** The date of the check of the sample. With it, the gate gives the faults that the README shows. */
export const SAMPLE_TODAY = "2026-11-16";

/**
 * A sample risk layer for `SAMPLE_STACK` of the core. Each name and each number is an example.
 * It has two faults: the failure of the phone alone stops the alert, and the chance that the alert works is less than its goal.
 * The failure of the reader alone stops the alert too, and a record accepts that risk.
 */
export const SAMPLE_RISK: RiskLayer = {
  schema: RISK_SCHEMA,
  goals: [{ part: "alert", survives: 1, chance: 0.99 }],
  chances: [
    { part: "reader", works: 0.97, source: "An estimate: the hours when the reader cannot read a message" },
    { part: "phone", works: 0.995, source: "An estimate: the hours with no battery or no signal" },
    { part: "card", works: 0.999, source: "An estimate" },
    { part: "home-power", works: 0.999, source: "An estimate: the hours without power in a year" },
    { part: "home-network", works: 0.995, source: "An estimate: the hours without a connection in a year" },
    { part: "home-host", works: 0.99, source: "An estimate" },
    { part: "cloud-account", works: 0.999, source: "An estimate" },
    { part: "cloud-host", works: 0.999, source: "The service agreement of the provider" },
    { part: "program-home", works: 0.995, source: "An estimate" },
    { part: "program-cloud", works: 0.995, source: "An estimate" },
    { part: "push-account", works: 0.999, source: "An estimate" },
    { part: "push", works: 0.999, source: "The status page of the provider" },
    { part: "call-account", works: 0.999, source: "An estimate" },
    { part: "call", works: 0.999, source: "The status page of the provider" },
  ],
  accepted: [{ part: "alert", stop: ["reader"], reason: "One person reads the alerts. A second reader is a later step.", until: "2027-06-30" }],
};
