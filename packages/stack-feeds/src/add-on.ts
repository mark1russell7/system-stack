import type { StackJoiner } from "@mark1russell7/system-stack";
import { checkFeeds } from "./check.ts";
import { joinFeeds } from "./join.ts";
import { FEED_SCHEMA, type FeedLayer } from "./layer.ts";
import { parseFeeds } from "./schema.ts";
import { todayNumber, type FeedOptions } from "./states.ts";

// The feed add-on in the form of the layer contract. A host gives it to `checkStackLayers` and to `joinStacks` of the core.
// This entry has the schema library, so the root entry does not import it.

/**
 * This function gives the feed add-on for a check on one date, with the reads of the feeds.
 *
 * - `schema` is `feed/1`, the key of the layer in `Stack.layers`.
 * - `parse` is `parseFeeds`.
 * - `check` is the gate `checkFeeds` with the options. A feed with no read is a fault, so give each read.
 * - `join` is `joinFeeds`. It joins the feed layers of the fragments of a stack.
 *
 * @param options - The date of the check and the reads. The gate has no clock: the caller gives the date.
 * @throws RangeError when `today` is not a date `YYYY-MM-DD`
 */
export function feedAddOn(options: FeedOptions): StackJoiner<FeedLayer> {
  todayNumber(options.today);
  return { schema: FEED_SCHEMA, parse: parseFeeds, check: (layer, stack) => checkFeeds(layer, stack, options), join: joinFeeds };
}
