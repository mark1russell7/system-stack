import type { Stack } from "@mark1russell7/system-stack";
import { PLACEMENT_SCHEMA, type Candidate, type PlacementLayer, type Shared } from "./layer.ts";

// A sample placement: a function that works with one copy of two, and two hosts of two providers for each copy.

/** The date of the add-ons of the sample. */
export const SAMPLE_TODAY = "2026-11-18";

/** This function gives a sample candidate: one host of a provider, with its chance and its fixed price. */
function sampleHost(slot: string, key: string, provider: string, works: number, cost: number): Candidate {
  return {
    key,
    cost,
    uses: [provider],
    source: `offer-${key}`,
    stack: {
      schema: "stack/1",
      parts: [{ id: slot, kind: "host", needs: [provider] }],
      layers: {
        "risk/1": { schema: "risk/1", goals: [], chances: [{ part: slot, works, source: "An estimate" }] },
        "spend/1": { schema: "spend/1", currency: "USD", kinds: [], proofDays: 30, services: [{ part: slot, billing: "fixed", price: cost }] },
      },
    },
  };
}

/** This function gives a sample shared fragment: one provider, with its chance. */
function sampleProvider(id: string, works: number): Shared {
  return {
    id,
    stack: { schema: "stack/1", parts: [{ id, kind: "provider" }], layers: { "risk/1": { schema: "risk/1", goals: [], chances: [{ part: id, works, source: "An estimate" }] } } },
  };
}

/** The base stack of the sample. The function `send` works when one of the parts `copy-a` and `copy-b` works. */
export const SAMPLE_BASE: Stack = {
  schema: "stack/1",
  parts: [{ id: "send", kind: "function", name: "A message gets to its reader", needs: [{ any: ["copy-a", "copy-b"] }] }],
};

/**
 * The sample placement layer. Each name and each number is an example.
 * The slot `copy-a` needs a candidate, and the slot `copy-b` can stay empty. The two candidates of a slot use two different providers.
 */
export const SAMPLE_PLACEMENT: PlacementLayer = {
  schema: PLACEMENT_SCHEMA,
  part: "send",
  currency: "USD",
  slots: [
    { id: "copy-a", candidates: [sampleHost("copy-a", "small-x", "provider-x", 0.99, 5), sampleHost("copy-a", "small-y", "provider-y", 0.98, 6)] },
    { id: "copy-b", optional: true, candidates: [sampleHost("copy-b", "small-x", "provider-x", 0.99, 5), sampleHost("copy-b", "small-y", "provider-y", 0.98, 6)] },
  ],
  shared: [sampleProvider("provider-x", 0.999), sampleProvider("provider-y", 0.995)],
};

/** The base stack of the sample with the sample placement layer. */
export const SAMPLE_STACK: Stack = { ...SAMPLE_BASE, layers: { [PLACEMENT_SCHEMA]: SAMPLE_PLACEMENT } };
