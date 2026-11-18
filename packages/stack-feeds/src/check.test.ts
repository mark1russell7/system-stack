import { SAMPLE_STACK, STACK_SCHEMA, type Part, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkFeeds, FEED_CODES, type FeedFault } from "./check.ts";
import { FEED_SCHEMA, type Feed, type FeedLayer, type FeedRead } from "./layer.ts";
import { SAMPLE_FEED_READS, SAMPLE_FEED_TODAY, SAMPLE_FEEDS } from "./sample.ts";
import { feedCover } from "./states.ts";

const stack = (...parts: Part[]): Stack => ({ schema: STACK_SCHEMA, parts });
const layer = (fields: Partial<FeedLayer>): FeedLayer => ({ schema: FEED_SCHEMA, feeds: [], ...fields });
const today = "2026-11-18";
const check = (of: FeedLayer, reads: readonly FeedRead[], parts: Stack = small): FeedFault[] => checkFeeds(of, parts, { today, reads });
const codes = (faults: readonly FeedFault[]): string[] => faults.map((fault) => fault.code);
const errors = (faults: readonly FeedFault[]): FeedFault[] => faults.filter((fault) => fault.level === "error");

// Two secrets of the repository `repo`, one secret of a second repository, and a host.
const small = stack(
  { id: "repo", kind: "repository" },
  { id: "repo-2", kind: "repository" },
  { id: "token", kind: "secret", needs: ["repo"] },
  { id: "key", kind: "secret", needs: [{ any: ["repo", "repo-2"] }] },
  { id: "other", kind: "secret", needs: ["repo-2"] },
  { id: "host", kind: "host" },
);
const secrets: Feed = { id: "secrets", kinds: ["secret"], scope: "repo", days: 1 };
const read = (keys: readonly string[], date = today, feed = "secrets"): FeedRead => ({ feed, date, keys });

describe("checkFeeds", () => {
  it("gives the fault of the sample: a seller on the statement with no record", () => {
    const faults = checkFeeds(SAMPLE_FEEDS, SAMPLE_STACK, { today: SAMPLE_FEED_TODAY, reads: SAMPLE_FEED_READS });
    expect(faults).toEqual([
      {
        level: "error",
        code: "feed-unknown",
        at: "card-statement",
        message: 'The feed "card-statement" shows "MUSIC STREAM", and no part or ignore record has that name.',
        key: "MUSIC STREAM",
      },
    ]);
  });

  it("passes when each read agrees with the records", () => {
    const reads = SAMPLE_FEED_READS.map((each) => ({ ...each, keys: each.keys.filter((key) => key !== "MUSIC STREAM") }));
    expect(checkFeeds(SAMPLE_FEEDS, SAMPLE_STACK, { today: SAMPLE_FEED_TODAY, reads })).toEqual([]);
  });

  it("passes for a layer with no feed", () => {
    expect(check(layer({}), [])).toEqual([]);
  });

  it("has a code for each fault", () => {
    expect(new Set(FEED_CODES).size).toBe(FEED_CODES.length);
    expect(FEED_CODES).toHaveLength(18);
  });

  it("refuses a date of the check of a wrong form", () => {
    expect(() => checkFeeds(layer({}), small, { today: "2026-02-30", reads: [] })).toThrow(RangeError);
  });

  describe("the records", () => {
    it("refuses a second feed of one id, a largest age that is not a whole number from 0, and a scope that is no part", () => {
      const faults = check(layer({ feeds: [secrets, { ...secrets, days: 2 }, { id: "b", kinds: ["host"], days: 1.5, scope: "not-a-part" }] }), [read(["token", "key"]), read([], today, "b")]);
      expect(faults.map((fault) => [fault.code, fault.at])).toEqual([
        ["feed-duplicate", "secrets"],
        ["feed-days", "b"],
        ["feed-scope", "b"],
      ]);
      for (const days of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(codes(check(layer({ feeds: [{ ...secrets, days }] }), [read(["token", "key"])]))).toContain("feed-days");
      }
    });

    it("refuses a key record of no feed, of no part, and a second key record of one name", () => {
      const keys = [
        { feed: "not-a-feed", key: "A", part: "token" },
        { feed: "secrets", key: "B", part: "not-a-part" },
        { feed: "secrets", key: "TOKEN", part: "token" },
        { feed: "secrets", key: "TOKEN", part: "key" },
      ];
      const faults = check(layer({ feeds: [secrets], keys }), [read(["TOKEN", "key"])]);
      expect(faults.map((fault) => [fault.code, fault.at, fault.key])).toEqual([
        ["key-feed", "not-a-feed", "A"],
        ["key-part", "secrets", "B"],
        ["key-duplicate", "secrets", "TOKEN"],
      ]);
    });

    it("refuses an ignore record of no feed, with a wrong date, or with the name of a part", () => {
      const ignores = [
        { feed: "not-a-feed", key: "x", reason: "A reason." },
        { feed: "secrets", key: "y", reason: "A reason.", until: "2026-02-30" },
        { feed: "secrets", key: "token", reason: "A reason." },
        { feed: "secrets", key: "TOKEN", reason: "A reason." },
      ];
      const keys = [{ feed: "secrets", key: "TOKEN", part: "token" }];
      const faults = check(layer({ feeds: [secrets], keys, ignores }), [read(["TOKEN", "key", "y"])]);
      expect(faults.map((fault) => [fault.code, fault.key])).toEqual([
        ["ignore-feed", "x"],
        ["ignore-date", "y"],
        ["ignore-part", "token"],
        ["ignore-part", "TOKEN"],
        // A wrong date is no end of the record, so the name "y" has no current record.
        ["feed-unknown", "y"],
      ]);
    });
  });

  describe("the reads", () => {
    it("refuses a read of no feed, and a read with a wrong date or a date after the check", () => {
      const reads = [read(["token", "key"]), read([], today, "not-a-feed"), read(["x"], "2026-11-31"), read(["x"], "2026-11-19")];
      expect(check(layer({ feeds: [secrets] }), reads).map((fault) => [fault.code, fault.at])).toEqual([
        ["read-feed", "not-a-feed"],
        ["read-date", "secrets"],
        ["read-date", "secrets"],
      ]);
    });

    it("does not count a read with a fault, so a feed with only such reads has no read", () => {
      expect(codes(check(layer({ feeds: [secrets] }), [read(["token", "key"], "2026-11-19")]))).toEqual(["read-date", "feed-none"]);
    });

    it("uses the newest read, and the last read of one date", () => {
      const reads = [read(["token", "key"], "2026-11-18"), read(["x"], "2026-11-17"), read(["y", "token", "key"], "2026-11-18")];
      expect(check(layer({ feeds: [secrets] }), reads).map((fault) => [fault.code, fault.key])).toEqual([["feed-unknown", "y"]]);
    });
  });

  describe("the feeds", () => {
    it("fails for a feed with no read", () => {
      expect(check(layer({ feeds: [secrets] }), [])).toEqual([{ level: "error", code: "feed-none", at: "secrets", message: 'The feed "secrets" has no read. The gate has no result for it.' }]);
    });

    it("fails for a read older than the largest age, and compares no name of it", () => {
      const faults = check(layer({ feeds: [secrets] }), [read(["x"], "2026-11-16")]);
      expect(faults).toEqual([
        {
          level: "error",
          code: "feed-old",
          at: "secrets",
          message: 'The newest read of the feed "secrets" is from 2026-11-16, 2 days before the check. The largest age is 1 days.',
        },
      ]);
      expect(check(layer({ feeds: [secrets] }), [read(["token", "key"], "2026-11-17")])).toEqual([]);
      expect(codes(check(layer({ feeds: [{ ...secrets, days: 0 }] }), [read(["token", "key"], "2026-11-17")]))).toEqual(["feed-old"]);
    });

    it("fails for a name with no part, and passes for a name of a current ignore record", () => {
      const ignores = [{ feed: "secrets", key: "BOT", reason: "The provider makes this secret." }];
      expect(check(layer({ feeds: [secrets], ignores }), [read(["token", "key", "BOT", "NEW"])]).map((fault) => [fault.code, fault.key])).toEqual([["feed-unknown", "NEW"]]);
    });

    it("gives a warning for an ignore record that ended, and its name has no record then", () => {
      const ignores = [{ feed: "secrets", key: "BOT", reason: "A reason.", until: "2026-11-17" }];
      const faults = check(layer({ feeds: [secrets], ignores }), [read(["token", "key", "BOT"])]);
      expect(faults.map((fault) => [fault.level, fault.code, fault.key])).toEqual([
        ["error", "feed-unknown", "BOT"],
        ["warning", "ignore-old", "BOT"],
      ]);
      expect(check(layer({ feeds: [secrets], ignores: [{ ...ignores[0]!, until: today }] }), [read(["token", "key", "BOT"])])).toEqual([]);
    });

    it("fails for a name of a part of a different kind or out of the scope", () => {
      const faults = check(layer({ feeds: [secrets] }), [read(["token", "key", "host", "other"])]);
      expect(faults.map((fault) => [fault.code, fault.key, fault.part])).toEqual([
        ["feed-outside", "host", "host"],
        ["feed-outside", "other", "other"],
      ]);
      expect(faults[0]?.message).toBe('The feed "secrets" shows "host", which gives the part "host". The feed lists only the parts of the kinds "secret" in the scope "repo".');
    });

    it("fails for a part that a complete feed lists and its read does not show", () => {
      const faults = check(layer({ feeds: [secrets] }), [read(["token"])]);
      expect(faults).toEqual([{ level: "error", code: "feed-gone", at: "secrets", message: 'The feed "secrets" lists the part "key", and its read of 2026-11-18 does not show it.', part: "key" }]);
      expect(check(layer({ feeds: [{ ...secrets, complete: false }] }), [read(["token"])])).toEqual([]);
    });

    it("fails for a current ignore record whose name the read does not show", () => {
      const ignores = [{ feed: "secrets", key: "BOT", reason: "A reason." }];
      expect(check(layer({ feeds: [secrets], ignores }), [read(["token", "key"])]).map((fault) => [fault.code, fault.key])).toEqual([["ignore-unused", "BOT"]]);
    });

    it("gives a part through its key record, and counts a name two times as one", () => {
      const keys = [{ feed: "secrets", key: "API_TOKEN", part: "token" }];
      expect(check(layer({ feeds: [secrets], keys }), [read(["API_TOKEN", "key", "key", "API_TOKEN"])])).toEqual([]);
    });

    it("keeps the feeds apart: a read of one feed is no read of a second feed", () => {
      const hosts: Feed = { id: "hosts", kinds: ["host"], days: 7 };
      expect(check(layer({ feeds: [secrets, hosts] }), [read(["token", "key"])]).map((fault) => [fault.code, fault.at])).toEqual([["feed-none", "hosts"]]);
    });
  });

  describe("the properties", () => {
    const kinds = ["secret", "host", "account"];
    const arbitraryStack = fc
      .array(fc.record({ kind: fc.constantFrom(...kinds), scoped: fc.boolean() }), { maxLength: 12 })
      .map((list) => stack({ id: "scope", kind: "repository" }, ...list.map((part, index): Part => ({ id: `p${String(index)}`, kind: part.kind, ...(part.scoped ? { needs: ["scope"] } : {}) }))));
    const arbitraryFeed = fc.record({ kinds: fc.subarray(kinds, { minLength: 1 }), scoped: fc.boolean() }).map(({ kinds: list, scoped }): Feed => ({ id: "f", kinds: list, days: 0, ...(scoped ? { scope: "scope" } : {}) }));

    it("passes for a read that shows each part of the cover of the feed", () => {
      fc.assert(
        fc.property(arbitraryStack, arbitraryFeed, (parts, feed) => {
          const keys = feedCover(feed, parts).map((part) => part.id);
          expect(checkFeeds(layer({ feeds: [feed] }), parts, { today, reads: [read(keys, today, "f")] })).toEqual([]);
        }),
      );
    });

    it("gives one fault for each part of the cover that the read leaves out, and for each new name", () => {
      fc.assert(
        fc.property(arbitraryStack, arbitraryFeed, fc.nat(), fc.nat({ max: 3 }), (parts, feed, cut, added) => {
          const keys = feedCover(feed, parts).map((part) => part.id);
          const out = keys.filter((_, index) => index % (cut + 2) === 0);
          const names = Array.from({ length: added }, (_, index) => `new-${String(index)}`);
          const faults = errors(checkFeeds(layer({ feeds: [feed] }), parts, { today, reads: [read([...keys.filter((key) => !out.includes(key)), ...names], today, "f")] }));
          expect(faults.filter((fault) => fault.code === "feed-gone").map((fault) => fault.part)).toEqual(out);
          expect(faults.filter((fault) => fault.code === "feed-unknown").map((fault) => fault.key)).toEqual(names);
          expect(faults).toHaveLength(out.length + names.length);
        }),
      );
    });

    it("gives the same faults for each sequence of the reads of different dates", () => {
      fc.assert(
        fc.property(fc.shuffledSubarray([read(["token"], "2026-11-15"), read(["token", "key", "x"], "2026-11-16"), read(["token", "key"], "2026-11-18")], { minLength: 3, maxLength: 3 }), (reads) => {
          expect(check(layer({ feeds: [secrets] }), reads)).toEqual([]);
        }),
      );
    });
  });
});
