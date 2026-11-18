import { checkStackLayers, readLayer, SAMPLE_STACK, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { feedAddOn } from "./add-on.ts";
import { checkFeeds } from "./check.ts";
import { joinFeeds } from "./join.ts";
import { FEED_SCHEMA } from "./layer.ts";
import { SAMPLE_FEED_READS, SAMPLE_FEED_TODAY, SAMPLE_FEEDS } from "./sample.ts";

const options = { today: SAMPLE_FEED_TODAY, reads: SAMPLE_FEED_READS };
const withLayer = (layer: unknown): Stack => ({ ...SAMPLE_STACK, layers: { [FEED_SCHEMA]: layer } });

describe("feedAddOn", () => {
  it("has the name of the feed layer and the join of the feed layers", () => {
    expect(feedAddOn(options).schema).toBe("feed/1");
    expect(feedAddOn(options).join).toBe(joinFeeds);
  });

  it("reads the layer of a stack", () => {
    expect(readLayer(withLayer(SAMPLE_FEEDS), feedAddOn(options))).toEqual({ ok: true, layer: SAMPLE_FEEDS });
    expect(readLayer(SAMPLE_STACK, feedAddOn(options))).toBeUndefined();
  });

  it("gives the faults of the gate with the reads, with the name of the layer", () => {
    const faults = checkFeeds(SAMPLE_FEEDS, SAMPLE_STACK, options);
    expect(faults).toHaveLength(1);
    expect(checkStackLayers(withLayer(SAMPLE_FEEDS), [feedAddOn(options)])).toEqual(faults.map((fault) => ({ ...fault, layer: FEED_SCHEMA })));
  });

  it("fails for each feed when it gets no read", () => {
    const findings = checkStackLayers(withLayer(SAMPLE_FEEDS), [feedAddOn({ today: SAMPLE_FEED_TODAY, reads: [] })]);
    expect(findings.map((finding) => [finding.code, finding.at])).toEqual([
      ["feed-none", "card-statement"],
      ["feed-none", "devices"],
    ]);
  });

  it("gives the faults of the form of a layer, and starts no gate then", () => {
    const findings = checkStackLayers(withLayer({ ...SAMPLE_FEEDS, feeds: [{ id: "a", kinds: ["host"], days: "seven" }] }), [feedAddOn(options)]);
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) expect(finding).toMatchObject({ layer: FEED_SCHEMA, level: "error", code: "layer-form" });
  });

  it("refuses a date of a wrong form at once", () => {
    expect(() => feedAddOn({ today: "tomorrow", reads: [] })).toThrow(RangeError);
  });
});
