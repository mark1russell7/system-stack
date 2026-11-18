import { formErrors } from "@mark1russell7/system-stack/schema";
import { z } from "zod";
import { FEED_SCHEMA, type FeedLayer, type FeedRead } from "./layer.ts";

// The zod schemas of a feed layer and of its reads, and the read of their JSON. This module is the entry `/schema` of the package.
// The root entry has no zod, so a page that only runs the gate gets no schema library.

const id = z.string().min(1);

const feed = z.strictObject({
  id,
  name: z.string().optional(),
  kinds: z.array(id).min(1).readonly(),
  scope: id.optional(),
  days: z.number(),
  complete: z.boolean().optional(),
});

const key = z.strictObject({
  feed: id,
  key: id,
  part: id,
});

const ignore = z.strictObject({
  feed: id,
  key: id,
  reason: z.string().min(1),
  until: z.string().optional(),
});

/**
 * The schema of a feed layer. It examines the form of the record: the fields, their types and the finite numbers.
 * It refuses a field that the format does not have. `checkFeeds` examines the meaning of a layer with a correct form.
 */
export const feedSchema: z.ZodType<FeedLayer> = z.strictObject({
  schema: z.literal(FEED_SCHEMA),
  feeds: z.array(feed).readonly(),
  keys: z.array(key).readonly().optional(),
  ignores: z.array(ignore).readonly().optional(),
});

/** The schema of a list of reads, for example the JSON file that a program of the feeds writes. A read has only names. */
export const feedReadsSchema: z.ZodType<readonly FeedRead[]> = z
  .array(
    z.strictObject({
      feed: id,
      date: z.string(),
      keys: z.array(id).readonly(),
    }),
  )
  .readonly();

/** The result of the read of a feed layer: the layer, or the faults of its form. */
export type FeedParse = { readonly ok: true; readonly layer: FeedLayer } | { readonly ok: false; readonly errors: readonly string[] };

/** The result of the read of a list of reads: the reads, or the faults of their form. */
export type FeedReadsParse = { readonly ok: true; readonly reads: readonly FeedRead[] } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of a feed layer. It gives the layer, or the faults of its form.
 * Each fault names its place in the record, for example `feeds.0.kinds`.
 */
export function parseFeeds(value: unknown): FeedParse {
  const read = feedSchema.safeParse(value);
  if (read.success) return { ok: true, layer: read.data };
  return { ok: false, errors: formErrors(FEED_SCHEMA, read.error.issues) };
}

/**
 * This function reads the JSON of a list of reads. It gives the reads, or the faults of their form.
 * Each fault names its place in the list, for example `0.keys.2`.
 */
export function parseFeedReads(value: unknown): FeedReadsParse {
  const read = feedReadsSchema.safeParse(value);
  if (read.success) return { ok: true, reads: read.data };
  return { ok: false, errors: formErrors("feed reads", read.error.issues) };
}
