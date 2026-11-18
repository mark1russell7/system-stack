import { STACK_SCHEMA, type Part, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { FEED_SCHEMA, feedKey, firstFeeds, type Feed, type FeedLayer } from "./layer.ts";
import { feedCover, feedStates, ignoreHolds, readCodes, todayNumber } from "./states.ts";

const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });
const today = "2026-11-18";
const parts = stack(
  { id: "repo", kind: "repository" },
  { id: "token", kind: "secret", needs: ["repo"] },
  { id: "key", kind: "secret", needs: [{ all: [{ any: ["repo", "host"] }] }] },
  { id: "other", kind: "secret" },
  { id: "host", kind: "host" },
  { id: "token", kind: "host" },
);
const secrets: Feed = { id: "secrets", kinds: ["secret"], scope: "repo", days: 3 };

describe("feedCover", () => {
  it("gives the parts of the kinds of the feed that need its scope, each id one time", () => {
    expect(feedCover(secrets, parts).map((part) => part.id)).toEqual(["token", "key"]);
    expect(feedCover({ ...secrets, scope: undefined }, parts).map((part) => part.id)).toEqual(["token", "key", "other"]);
    expect(feedCover({ id: "f", kinds: ["host", "secret"], days: 1 }, parts).map((part) => part.id)).toEqual(["token", "key", "other", "host"]);
  });
});

describe("feedStates", () => {
  const layer: FeedLayer = {
    schema: FEED_SCHEMA,
    feeds: [secrets, { ...secrets, days: 0 }, { id: "hosts", kinds: ["host"], days: 0 }],
    keys: [{ feed: "secrets", key: "TOKEN", part: "token" }, { feed: "secrets", key: "GONE", part: "not-a-part" }],
    ignores: [{ feed: "secrets", key: "BOT", reason: "A reason." }],
  };

  it("gives the state of the first feed of each id", () => {
    const states = feedStates(layer, parts, { today, reads: [{ feed: "secrets", date: "2026-11-16", keys: ["TOKEN", "BOT", "GONE", "host", "TOKEN"] }] });
    expect(states).toEqual([
      { feed: "secrets", date: "2026-11-16", age: 2, old: false, shown: ["token"], unknown: ["GONE"], outside: [{ key: "host", part: "host" }], ignored: ["BOT"], gone: ["key"] },
      { feed: "hosts", old: false, shown: [], unknown: [], outside: [], ignored: [], gone: [] },
    ]);
  });

  it("tells that a read is old after the largest age", () => {
    const states = feedStates(layer, parts, { today, reads: [{ feed: "secrets", date: "2026-11-14", keys: [] }] });
    expect(states[0]).toMatchObject({ age: 4, old: true });
  });

  it("refuses a date of the check of a wrong form", () => {
    expect(() => feedStates(layer, parts, { today: "18 November", reads: [] })).toThrow(RangeError);
  });
});

describe("readCodes", () => {
  it("gives the fault of each read, or undefined", () => {
    const layer: FeedLayer = { schema: FEED_SCHEMA, feeds: [secrets] };
    const reads = [
      { feed: "secrets", date: today, keys: [] },
      { feed: "no", date: today, keys: [] },
      { feed: "secrets", date: "2026-13-01", keys: [] },
      { feed: "secrets", date: "2026-11-19", keys: [] },
    ];
    expect(readCodes(layer, reads, today)).toEqual([undefined, "read-feed", "read-date", "read-date"]);
  });
});

describe("ignoreHolds", () => {
  it("holds with no last date, and until the last date", () => {
    const day = todayNumber(today);
    expect(ignoreHolds({ feed: "f", key: "k", reason: "r" }, day)).toBe(true);
    expect(ignoreHolds({ feed: "f", key: "k", reason: "r", until: today }, day)).toBe(true);
    expect(ignoreHolds({ feed: "f", key: "k", reason: "r", until: "2026-11-17" }, day)).toBe(false);
    expect(ignoreHolds({ feed: "f", key: "k", reason: "r", until: "not a date" }, day)).toBe(false);
  });
});

describe("the records", () => {
  it("gives the first feed of each id, and one text for each pair of a feed and a name", () => {
    expect(firstFeeds({ schema: FEED_SCHEMA, feeds: [secrets, { ...secrets, days: 9 }] })).toEqual([secrets]);
    expect(feedKey("a:b", "c")).not.toBe(feedKey("a", "b:c"));
  });
});
