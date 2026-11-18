import { describe, expect, it } from "vitest";
import { joinFeeds } from "./join.ts";
import { FEED_SCHEMA, type FeedLayer } from "./layer.ts";

const layer = (fields: Partial<FeedLayer>): FeedLayer => ({ schema: FEED_SCHEMA, feeds: [], ...fields });
const hosts = { id: "hosts", kinds: ["host"], days: 7 };
const secrets = { id: "secrets", kinds: ["secret"], days: 1 };

describe("joinFeeds", () => {
  it("joins the feeds, the keys and the ignore records in the order of the fragments", () => {
    const key = { feed: "hosts", key: "laptop", part: "host" };
    const ignore = { feed: "hosts", key: "tv", reason: "A reason." };
    const joined = joinFeeds([
      { from: "a", layer: layer({ feeds: [hosts] }) },
      { from: "b", layer: layer({ feeds: [secrets], keys: [key], ignores: [ignore] }) },
    ]);
    expect(joined).toEqual({ ok: true, layer: { schema: FEED_SCHEMA, feeds: [hosts, secrets], keys: [key], ignores: [ignore] } });
  });

  it("gives no field keys or ignores when no fragment has it", () => {
    expect(joinFeeds([{ from: "a", layer: layer({ feeds: [hosts] }) }])).toEqual({ ok: true, layer: { schema: FEED_SCHEMA, feeds: [hosts] } });
  });

  it("refuses a feed, a key record or an ignore record of two fragments", () => {
    const key = { feed: "hosts", key: "laptop", part: "host" };
    const ignore = { feed: "hosts", key: "tv", reason: "A reason." };
    const joined = joinFeeds([
      { from: "a", layer: layer({ feeds: [hosts], keys: [key], ignores: [ignore] }) },
      { from: "b", layer: layer({ feeds: [hosts], keys: [{ ...key, part: "other" }], ignores: [ignore] }) },
    ]);
    expect(joined.ok).toBe(false);
    if (joined.ok) return;
    expect(joined.errors).toHaveLength(3);
    expect(joined.errors[0]).toBe('The fragments "a", "b" each have the feed "hosts".');
  });

  it("leaves a second record of one fragment to the gate", () => {
    expect(joinFeeds([{ from: "a", layer: layer({ feeds: [hosts, hosts] }) }]).ok).toBe(true);
  });
});
