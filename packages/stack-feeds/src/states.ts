import { dayNumber, partNeeds, partsById, type Part, type Stack } from "@mark1russell7/system-stack";
import { feedKey, firstFeeds, type Feed, type FeedIgnore, type FeedLayer, type FeedRead } from "./layer.ts";

// The states of the feeds: the newest read of each feed, and the comparison of its names with the records of the stack.

/** The options of the states and of the gate. */
export interface FeedOptions {
  /** The date of the check, as `YYYY-MM-DD`. The functions have no clock: the caller gives the date. */
  readonly today: string;
  /** The reads of the feeds. A program makes them from each source. */
  readonly reads: readonly FeedRead[];
}

/** These are the codes of the faults of a read. */
export const READ_CODES: readonly ["read-feed", "read-date"] = ["read-feed", "read-date"];

/** A code of a fault of a read. */
export type ReadCode = (typeof READ_CODES)[number];

/**
 * A name of a read with a part that the feed does not list. The kind of the part is not a kind of the feed, or the part is out
 * of its scope.
 */
export interface OutsideName {
  /** The name in the source. */
  readonly key: string;
  /** The `id` of the part of the name. */
  readonly part: string;
}

/** The state of one feed on the date of the check. */
export interface FeedState {
  /** The `id` of the feed. */
  readonly feed: string;
  /** The date of the newest read with no fault. A feed with no read has no date, and its lists are empty. */
  readonly date?: string | undefined;
  /** The age of the newest read, in days. */
  readonly age?: number | undefined;
  /** This value tells that the newest read is older than the largest age of the feed. */
  readonly old: boolean;
  /** The parts that the newest read shows, in the sequence of the read. Each part comes one time. */
  readonly shown: readonly string[];
  /** The names of the newest read with no part and no current ignore record. */
  readonly unknown: readonly string[];
  /** The names of the newest read with a part that the feed does not list. */
  readonly outside: readonly OutsideName[];
  /** The names of the newest read that a current ignore record covers. */
  readonly ignored: readonly string[];
  /** The parts that the feed lists and the newest read does not show. A feed that is not complete has none. */
  readonly gone: readonly string[];
}

/**
 * This function gives the parts of a stack that a feed lists: the parts of its kinds, in its scope.
 * A part with a scope needs the part of the scope directly. The parts are in the sequence of the stack, and each `id` comes one time.
 */
export function feedCover(feed: Feed, stack: Stack): Part[] {
  const kinds = new Set(feed.kinds);
  return [...partsById(stack).values()].filter((part) => kinds.has(part.kind) && (feed.scope === undefined || partNeeds(part).includes(feed.scope)));
}

/** This function gives the number of the day of the date of the check, or it throws. */
export function todayNumber(today: string): number {
  const day = dayNumber(today);
  if (day === undefined) throw new RangeError(`The date "${today}" is not a date of the form YYYY-MM-DD.`);
  return day;
}

/**
 * This function gives the fault of each read, in the sequence of the reads. A read with no fault gives `undefined`.
 *
 * - `read-feed`: the read names no feed of the layer.
 * - `read-date`: the date of the read is not a date, or it is after the date of the check.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function readCodes(layer: FeedLayer, reads: readonly FeedRead[], today: string): (ReadCode | undefined)[] {
  const day = todayNumber(today);
  const feeds = new Set(layer.feeds.map((feed) => feed.id));
  return reads.map((read) => {
    if (!feeds.has(read.feed)) return "read-feed";
    const date = dayNumber(read.date);
    if (date === undefined || date > day) return "read-date";
    return undefined;
  });
}

/** This function tells if an ignore record holds on a day: it has no last date, or its last date is not before the day. */
export function ignoreHolds(ignore: FeedIgnore, day: number): boolean {
  if (ignore.until === undefined) return true;
  const until = dayNumber(ignore.until);
  return until !== undefined && until >= day;
}

/**
 * This function gives the state of each feed of a layer on the date of the check, in the sequence of the feeds.
 *
 * - The newest read of a feed is the read with the latest date and no fault. Of two reads of one date, the last read counts.
 * - A name gives a part through a key record of the feed, or else through the part with that `id`.
 * - A name with no part goes to `ignored` when a current ignore record names it, and to `unknown` when no record names it.
 * - A part that the feed does not list goes to `outside`. A part that the feed lists goes to `shown`.
 * - A complete feed puts each part that it lists and the read does not show into `gone`.
 *
 * The function is pure. It gives the first feed of each `id`.
 *
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function feedStates(layer: FeedLayer, stack: Stack, options: FeedOptions): FeedState[] {
  const today = todayNumber(options.today);
  const codes = readCodes(layer, options.reads, options.today);
  const newest = new Map<string, { readonly read: FeedRead; readonly day: number }>();
  options.reads.forEach((read, index) => {
    if (codes[index] !== undefined) return;
    const day = dayNumber(read.date) ?? 0;
    const last = newest.get(read.feed);
    if (last === undefined || day >= last.day) newest.set(read.feed, { read, day });
  });
  const parts = partsById(stack);
  const keys = new Map<string, string>();
  for (const key of layer.keys ?? []) {
    const name = feedKey(key.feed, key.key);
    if (!keys.has(name)) keys.set(name, key.part);
  }
  const ignores = new Set((layer.ignores ?? []).filter((ignore) => ignoreHolds(ignore, today)).map((ignore) => feedKey(ignore.feed, ignore.key)));

  return firstFeeds(layer).map((feed): FeedState => {
    const last = newest.get(feed.id);
    if (last === undefined) return { feed: feed.id, old: false, shown: [], unknown: [], outside: [], ignored: [], gone: [] };
    const age = today - last.day;
    const cover = feedCover(feed, stack);
    const listed = new Set(cover.map((part) => part.id));
    const shown: string[] = [];
    const seen = new Set<string>();
    const unknown: string[] = [];
    const outside: OutsideName[] = [];
    const ignored: string[] = [];
    for (const key of new Set(last.read.keys)) {
      const name = feedKey(feed.id, key);
      const part = keys.get(name) ?? key;
      if (!parts.has(part)) {
        (ignores.has(name) ? ignored : unknown).push(key);
      } else if (!listed.has(part)) {
        outside.push({ key, part });
      } else if (!seen.has(part)) {
        seen.add(part);
        shown.push(part);
      }
    }
    const gone = feed.complete === false ? [] : cover.map((part) => part.id).filter((id) => !seen.has(id));
    return { feed: feed.id, date: last.read.date, age, old: age > feed.days, shown, unknown, outside, ignored, gone };
  });
}
