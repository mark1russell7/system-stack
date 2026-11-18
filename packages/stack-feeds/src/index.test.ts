import { describe, expect, it } from "vitest";
import * as entry from "./index.ts";
import * as schema from "./schema.ts";

describe("the root entry", () => {
  it("has the format, the states, the gate, the join and the sample", () => {
    expect(entry.FEED_SCHEMA).toBe("feed/1");
    for (const name of ["firstFeeds", "feedKey", "feedCover", "feedStates", "readCodes", "ignoreHolds", "todayNumber", "checkFeeds", "joinFeeds"] as const) {
      expect(entry[name]).toBeTypeOf("function");
    }
    expect(entry.FEED_CODES).toContain("feed-none");
    expect(entry.READ_CODES).toEqual(["read-feed", "read-date"]);
    expect(entry.SAMPLE_FEEDS.schema).toBe(entry.FEED_SCHEMA);
    expect(entry.SAMPLE_FEED_TODAY).toBe("2026-11-16");
  });

  it("has no schema", () => {
    for (const name of ["feedSchema", "feedReadsSchema", "parseFeeds", "parseFeedReads"]) expect(entry).not.toHaveProperty(name);
  });
});

describe("the entry /schema", () => {
  it("has the schemas and the reads of a feed layer and of its reads", () => {
    expect(Object.keys(schema).sort()).toEqual(["feedReadsSchema", "feedSchema", "parseFeedReads", "parseFeeds"]);
  });
});
