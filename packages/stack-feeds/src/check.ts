import { dayNumber, partsById, type Fault, type FaultLevel, type Stack } from "@mark1russell7/system-stack";
import { feedKey, firstFeeds, type FeedLayer } from "./layer.ts";
import { feedStates, ignoreHolds, readCodes, todayNumber, type FeedOptions } from "./states.ts";

// The gate of the feeds. A gate that passes tells that each feed has a new read, and that each read agrees with the records.

/** These are the codes of the faults of a feed layer and of its reads. */
export const FEED_CODES: readonly [
  "feed-duplicate",
  "feed-days",
  "feed-scope",
  "key-feed",
  "key-part",
  "key-duplicate",
  "ignore-feed",
  "ignore-date",
  "ignore-part",
  "read-feed",
  "read-date",
  "feed-none",
  "feed-old",
  "feed-unknown",
  "feed-outside",
  "feed-gone",
  "ignore-unused",
  "ignore-old",
] = [
  "feed-duplicate",
  "feed-days",
  "feed-scope",
  "key-feed",
  "key-part",
  "key-duplicate",
  "ignore-feed",
  "ignore-date",
  "ignore-part",
  "read-feed",
  "read-date",
  "feed-none",
  "feed-old",
  "feed-unknown",
  "feed-outside",
  "feed-gone",
  "ignore-unused",
  "ignore-old",
];

/** A code of a fault of a feed layer. */
export type FeedCode = (typeof FEED_CODES)[number];

/** A fault of a feed layer. Its field `at` is the `id` of the feed. */
export interface FeedFault extends Fault {
  readonly code: FeedCode;
  /** The name in the source, for a fault of one name. */
  readonly key?: string | undefined;
  /** The `id` of the part, for a fault of one part. */
  readonly part?: string | undefined;
}

/** This function gives a list of texts for a message, for example `"a", "b"`. */
function names(list: readonly string[]): string {
  return list.map((item) => `"${item}"`).join(", ");
}

/**
 * This function gives each fault of a feed layer and of its reads. A list with no error tells that the gate passes.
 *
 * The records, as errors:
 * - `feed-duplicate`: two feeds have one `id`.
 * - `feed-days`: the largest age of a feed is not a whole number from 0.
 * - `feed-scope`: the scope of a feed names no part.
 * - `key-feed`, `key-part`: a key record names no feed, or no part.
 * - `key-duplicate`: two key records name one feed and one name.
 * - `ignore-feed`: an ignore record names no feed.
 * - `ignore-date`: the last date of an ignore record is not a date.
 * - `ignore-part`: an ignore record names a name of a part: a key record has it, or a part has it as its `id`.
 *
 * The reads, as errors:
 * - `read-feed`: a read names no feed.
 * - `read-date`: the date of a read is not a date, or it is after `today`.
 *
 * The feeds, as errors:
 * - `feed-none`: a feed has no read. The gate has no result for the feed, so it does not pass.
 * - `feed-old`: the newest read of a feed is older than its largest age. The gate then does not compare its names.
 * - `feed-unknown`: the source shows a name with no part and no current ignore record. Add the part, or an ignore record.
 * - `feed-outside`: the source shows a name of a part that the feed does not list, by its kind or by its scope.
 * - `feed-gone`: a complete feed lists a part, and its source does not show it. The record is old, or the source lost the part.
 * - `ignore-unused`: the source does not show the name of a current ignore record. Remove the record.
 *
 * The feeds, as warnings:
 * - `ignore-old`: an ignore record ended before `today`. Its name is then a name with no record.
 *
 * A read with a fault does not count. The function is pure. The sequence of the faults is the feeds, the keys, the ignore records,
 * the reads, the states of the feeds, then the old ignore records.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function checkFeeds(layer: FeedLayer, stack: Stack, options: FeedOptions): FeedFault[] {
  const today = todayNumber(options.today);
  const faults: FeedFault[] = [];
  const add = (level: FaultLevel, code: FeedCode, at: string, message: string, more: { readonly key?: string; readonly part?: string } = {}): void => {
    faults.push({ level, code, at, message, ...more });
  };
  const parts = partsById(stack);

  const feeds = new Set<string>();
  for (const feed of layer.feeds) {
    const at = feed.id;
    if (feeds.has(at)) {
      add("error", "feed-duplicate", at, `Two feeds have the id "${at}".`);
      continue;
    }
    feeds.add(at);
    if (!Number.isInteger(feed.days) || feed.days < 0) add("error", "feed-days", at, `The largest age ${String(feed.days)} of the feed "${at}" is not a whole number of days from 0.`);
    if (feed.scope !== undefined && !parts.has(feed.scope)) add("error", "feed-scope", at, `The scope of the feed "${at}" is "${feed.scope}", which is no part of the stack.`, { part: feed.scope });
  }

  const keys = new Set<string>();
  for (const key of layer.keys ?? []) {
    const at = key.feed;
    const name = feedKey(key.feed, key.key);
    if (keys.has(name)) {
      add("error", "key-duplicate", at, `Two key records name the name "${key.key}" of the feed "${at}".`, { key: key.key });
      continue;
    }
    keys.add(name);
    if (!feeds.has(at)) add("error", "key-feed", at, `A key record names the feed "${at}", which the layer does not have.`, { key: key.key });
    if (!parts.has(key.part)) add("error", "key-part", at, `The key record of the name "${key.key}" of the feed "${at}" names "${key.part}", which is no part of the stack.`, { key: key.key, part: key.part });
  }

  for (const ignore of layer.ignores ?? []) {
    const at = ignore.feed;
    if (!feeds.has(at)) add("error", "ignore-feed", at, `An ignore record names the feed "${at}", which the layer does not have.`, { key: ignore.key });
    if (ignore.until !== undefined && dayNumber(ignore.until) === undefined) {
      add("error", "ignore-date", at, `The last date "${ignore.until}" of the ignore record of "${ignore.key}" is not a date of the form YYYY-MM-DD.`, { key: ignore.key });
    }
    if (keys.has(feedKey(ignore.feed, ignore.key)) || parts.has(ignore.key)) {
      add("error", "ignore-part", at, `An ignore record names "${ignore.key}" of the feed "${at}", and that name gives a part. Remove the record.`, { key: ignore.key });
    }
  }

  const codes = readCodes(layer, options.reads, options.today);
  options.reads.forEach((read, index) => {
    const at = read.feed;
    if (codes[index] === "read-feed") add("error", "read-feed", at, `A read names the feed "${at}", which the layer does not have.`);
    if (codes[index] === "read-date") add("error", "read-date", at, `The date "${read.date}" of a read of the feed "${at}" is not a date of the form YYYY-MM-DD, or it is after the date of the check, ${options.today}.`);
  });

  const records = new Map(firstFeeds(layer).map((feed) => [feed.id, feed]));
  for (const state of feedStates(layer, stack, options)) {
    const at = state.feed;
    const feed = records.get(at);
    if (state.date === undefined) {
      add("error", "feed-none", at, `The feed "${at}" has no read. The gate has no result for it.`);
      continue;
    }
    if (state.old) {
      const days = feed?.days ?? 0;
      add("error", "feed-old", at, `The newest read of the feed "${at}" is from ${state.date}, ${String(state.age)} days before the check. The largest age is ${String(days)} days.`);
      continue;
    }
    for (const key of state.unknown) add("error", "feed-unknown", at, `The feed "${at}" shows "${key}", and no part or ignore record has that name.`, { key });
    for (const { key, part } of state.outside) {
      const scope = feed?.scope === undefined ? "" : ` in the scope "${feed.scope}"`;
      add("error", "feed-outside", at, `The feed "${at}" shows "${key}", which gives the part "${part}". The feed lists only the parts of the kinds ${names(feed?.kinds ?? [])}${scope}.`, { key, part });
    }
    for (const part of state.gone) add("error", "feed-gone", at, `The feed "${at}" lists the part "${part}", and its read of ${state.date} does not show it.`, { part });
    const shown = new Set(state.ignored);
    for (const ignore of layer.ignores ?? []) {
      if (ignore.feed !== at || !ignoreHolds(ignore, today) || shown.has(ignore.key)) continue;
      if (keys.has(feedKey(ignore.feed, ignore.key)) || parts.has(ignore.key)) continue;
      add("error", "ignore-unused", at, `The feed "${at}" does not show "${ignore.key}", which an ignore record names. Remove the record.`, { key: ignore.key });
    }
  }

  for (const ignore of layer.ignores ?? []) {
    if (ignore.until === undefined || dayNumber(ignore.until) === undefined || ignoreHolds(ignore, today)) continue;
    add("warning", "ignore-old", ignore.feed, `The ignore record of "${ignore.key}" of the feed "${ignore.feed}" ended on ${ignore.until}.`, { key: ignore.key });
  }
  return faults;
}
