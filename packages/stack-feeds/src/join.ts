import { joinRecords, type LayerParse, type LayerPiece } from "@mark1russell7/system-stack";
import { FEED_SCHEMA, feedKey, type FeedLayer } from "./layer.ts";

// The join of the feed layers of the fragments of a stack, for example one file of feeds for each owner.

/**
 * This function joins the feed layers of the fragments of a stack into one layer.
 *
 * - The feeds, the key records and the ignore records are in the order of the fragments.
 * - A feed `id` in two or more fragments is a fault, also when the feeds are equal.
 * - A key record or an ignore record of one feed and one name in two or more fragments is a fault.
 * - A fragment can give the keys and the ignore records of a feed of a different fragment.
 *
 * The joined layer has the field `keys` or `ignores` when a fragment has it. The function is pure, and it
 * changes no layer. The gate `checkFeeds` examines the joined layer afterward.
 *
 * @param pieces - The layers, with the name of the fragment of each one, in the order of the fragments.
 * @returns The joined layer, or the faults of the join.
 */
export function joinFeeds(pieces: readonly LayerPiece<FeedLayer>[]): LayerParse<FeedLayer> {
  const feeds = joinRecords(
    pieces,
    (layer) => layer.feeds,
    (feed) => feed.id,
    "feed",
  );
  const keys = joinRecords(
    pieces,
    (layer) => layer.keys,
    (key) => feedKey(key.feed, key.key),
    "key record of the feed and the name",
  );
  const ignores = joinRecords(
    pieces,
    (layer) => layer.ignores,
    (ignore) => feedKey(ignore.feed, ignore.key),
    "ignore record of the feed and the name",
  );
  const errors = [...feeds.errors, ...keys.errors, ...ignores.errors];
  if (errors.length > 0) return { ok: false, errors };
  const withKeys = pieces.some((piece) => piece.layer.keys !== undefined);
  const withIgnores = pieces.some((piece) => piece.layer.ignores !== undefined);
  return {
    ok: true,
    layer: {
      schema: FEED_SCHEMA,
      feeds: feeds.items,
      ...(withKeys ? { keys: keys.items } : {}),
      ...(withIgnores ? { ignores: ignores.items } : {}),
    },
  };
}
