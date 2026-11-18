// The records of the feed add-on. They are one layer of a stack, with the key `feed/1` in `Stack.layers`.
// A feed is a live list of the parts of some kinds, from one source. The gate compares each list with the records.

/** The name of the format of a feed layer. It is the key of the layer in `Stack.layers`. */
export const FEED_SCHEMA = "feed/1";

/**
 * A feed: a source that lists the parts of some kinds, for example the names of the secrets of one repository.
 * A program reads the list. The read is live data: the layer keeps only the record of the feed.
 */
export interface Feed {
  readonly id: string;
  /** The name of the feed for a person. */
  readonly name?: string | undefined;
  /** The kinds of the parts that the source lists. */
  readonly kinds: readonly string[];
  /**
   * The `id` of a part. With it, the source lists only the parts that need this part directly.
   * Thus a feed of the secrets of one repository lists only the secrets that need that repository.
   */
  readonly scope?: string | undefined;
  /** The largest age of the newest read, in days. It is a whole number from 0. */
  readonly days: number;
  /**
   * This value tells if the source lists each part of its kinds and its scope. The default is `true`.
   * With `false`, a part that the read does not show is no fault.
   */
  readonly complete?: boolean | undefined;
}

/** A key: the name of a part in a source, when the name is not the `id` of the part. */
export interface FeedKey {
  /** The `id` of the feed. */
  readonly feed: string;
  /** The name of the part in the source. */
  readonly key: string;
  /** The `id` of the part. */
  readonly part: string;
}

/** A name that the source shows, which is no part of the stack for a reason. */
export interface FeedIgnore {
  /** The `id` of the feed. */
  readonly feed: string;
  /** The name in the source. */
  readonly key: string;
  /** The reason of the owner. */
  readonly reason: string;
  /** The last date of the record, as `YYYY-MM-DD`. After that date the gate fails for the name. A record without it has no end. */
  readonly until?: string | undefined;
}

/** A feed layer: the feeds of a stack, the names of the parts in each source, and the names that are no parts. */
export interface FeedLayer {
  readonly schema: typeof FEED_SCHEMA;
  readonly feeds: readonly Feed[];
  readonly keys?: readonly FeedKey[] | undefined;
  readonly ignores?: readonly FeedIgnore[] | undefined;
}

/**
 * A read of a feed: the names that its source shows on one date. A read is live data, and it is no record of the layer.
 * A read has only names. Thus a read of secrets has the name of each secret, but not its value.
 */
export interface FeedRead {
  /** The `id` of the feed. */
  readonly feed: string;
  /** The date of the read, as `YYYY-MM-DD`. */
  readonly date: string;
  /** The names that the source shows. A name can come two times. */
  readonly keys: readonly string[];
}

/** This function gives the first feed of each `id` of a layer, in the sequence of the records. */
export function firstFeeds(layer: FeedLayer): readonly Feed[] {
  const seen = new Set<string>();
  return layer.feeds.filter((feed) => {
    if (seen.has(feed.id)) return false;
    seen.add(feed.id);
    return true;
  });
}

/** This function gives one text for a feed and a name. Two different pairs give two different texts. */
export function feedKey(feed: string, key: string): string {
  return JSON.stringify([feed, key]);
}
