import { FEED_SCHEMA, type FeedLayer, type FeedRead } from "./layer.ts";

/** The date of the check of the sample. With it, the gate gives the fault that the README shows. */
export const SAMPLE_FEED_TODAY = "2026-11-16";

/**
 * A sample feed layer for `SAMPLE_STACK` of the core. Each name is an example.
 *
 * - The statement of the payment card lists the accounts that the card pays. Its names are the names of the sellers.
 * - The list of the devices of the network lists the hosts and the devices. A record ignores the television.
 */
export const SAMPLE_FEEDS: FeedLayer = {
  schema: FEED_SCHEMA,
  feeds: [
    { id: "card-statement", name: "The sellers on the statement of the payment card", kinds: ["account"], scope: "card", days: 31 },
    { id: "devices", name: "The devices of the network", kinds: ["host", "device"], days: 7 },
  ],
  keys: [
    { feed: "card-statement", key: "CLOUD PROVIDER", part: "cloud-account" },
    { feed: "card-statement", key: "CALL SERVICE", part: "call-account" },
  ],
  ignores: [{ feed: "devices", key: "tv", reason: "The television is on the network, and no function needs it.", until: "2027-06-30" }],
};

/**
 * The sample reads of `SAMPLE_FEEDS`. The statement shows a seller that no record has: a new paid service.
 * Thus the gate fails with one fault on `SAMPLE_FEED_TODAY`.
 */
export const SAMPLE_FEED_READS: readonly FeedRead[] = [
  { feed: "card-statement", date: "2026-11-01", keys: ["CLOUD PROVIDER", "CALL SERVICE", "MUSIC STREAM"] },
  { feed: "devices", date: "2026-11-15", keys: ["phone", "home-host", "cloud-host", "tv"] },
];
