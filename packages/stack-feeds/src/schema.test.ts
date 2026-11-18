import { describe, expect, it } from "vitest";
import { SAMPLE_FEED_READS, SAMPLE_FEEDS } from "./sample.ts";
import { parseFeedReads, parseFeeds } from "./schema.ts";

describe("parseFeeds", () => {
  it("reads the sample", () => {
    expect(parseFeeds(JSON.parse(JSON.stringify(SAMPLE_FEEDS)))).toEqual({ ok: true, layer: SAMPLE_FEEDS });
  });

  it("refuses a field that the format does not have, a feed with no kind, and a feed with no largest age", () => {
    const read = parseFeeds({ ...SAMPLE_FEEDS, feeds: [{ id: "a", kinds: [], days: 1, url: "x" }, { id: "b", kinds: ["host"] }] });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.errors.some((error) => error.includes('"feeds.0.kinds"'))).toBe(true);
    expect(read.errors.some((error) => error.includes('"feeds.0"'))).toBe(true);
    expect(read.errors.some((error) => error.includes('"feeds.1.days"'))).toBe(true);
    for (const error of read.errors) expect(error.startsWith('The record "feed/1" has a fault at ')).toBe(true);
  });

  it("refuses an ignore record with no reason, and a wrong format name", () => {
    expect(parseFeeds({ ...SAMPLE_FEEDS, ignores: [{ feed: "a", key: "b", reason: "" }] }).ok).toBe(false);
    expect(parseFeeds({ ...SAMPLE_FEEDS, schema: "feed/2" }).ok).toBe(false);
  });
});

describe("parseFeedReads", () => {
  it("reads the sample reads", () => {
    expect(parseFeedReads(JSON.parse(JSON.stringify(SAMPLE_FEED_READS)))).toEqual({ ok: true, reads: SAMPLE_FEED_READS });
  });

  it("refuses a read with a field more than the names, for example the values of secrets", () => {
    const read = parseFeedReads([{ feed: "secrets", date: "2026-11-18", keys: ["TOKEN"], values: { TOKEN: "x" } }]);
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.errors[0]).toMatch(/^The record "feed reads" has a fault at "0": /);
  });

  it("refuses an empty name", () => {
    expect(parseFeedReads([{ feed: "secrets", date: "2026-11-18", keys: [""] }]).ok).toBe(false);
  });
});
