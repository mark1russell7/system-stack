# @mark1russell7/stack-feeds

The live lists of a system stack. A feed is a source that lists the parts of some kinds, for example the names of the secrets of a repository. The gate compares each list with the records of the stack.

It is the feed add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). The core knows only parts and needs. This package tells which source lists which parts, and how old a list can be.

Each function is a plain function with no clock and no network. A program of the owner reads each source and gives the reads to the gate.

## The rule

The records of a stack become old when the system changes and nobody changes the records. A feed finds this:

- The source shows a name with no record. For example, a new seller on the statement of a card is a new paid service.
- A record has no name in the source. The part is gone, or the source lost it.
- The newest read of a feed is older than its largest age. The gate then has no current list, so it fails.

A feed with no read is a fault too, because no result is not a good result.

The owner can ignore a name that is no part, with a reason and a last date. Thus each name of each source is in one of three states: a part, a record with a reason, or a fault of the gate.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-feeds` | The records of a layer, the states of the feeds, the gate, the join and a sample. |
| `@mark1russell7/stack-feeds/schema` | `feedSchema` and `feedReadsSchema`, the zod schemas of a layer and of its reads, and `parseFeeds` and `parseFeedReads`. |
| `@mark1russell7/stack-feeds/add-on` | `feedAddOn`, the add-on in the form of the layer contract of the core. |

The root entry has no schema library. Thus a page that only shows the states gets no zod.

## Install

```sh
npm install @mark1russell7/stack-feeds @mark1russell7/system-stack
```

## A layer

A feed layer is one record with feeds, keys and ignore records. Its format has the name `feed/1`. A stack keeps it in `Stack.layers`, with the key `feed/1`.

```ts
import type { FeedLayer } from "@mark1russell7/stack-feeds";

const layer: FeedLayer = {
  schema: "feed/1",
  feeds: [
    { id: "card-statement", name: "The sellers on the statement of the payment card", kinds: ["account"], scope: "card", days: 31 },
    { id: "devices", name: "The devices of the network", kinds: ["host", "device"], days: 7 },
  ],
  keys: [
    { feed: "card-statement", key: "CLOUD PROVIDER", part: "cloud-account" },
    { feed: "card-statement", key: "CALL SERVICE", part: "call-account" },
  ],
  ignores: [{ feed: "devices", key: "tv", reason: "The television is on the network, and no function needs it.", until: "2027-06-30" }],
};
```

- A feed lists the parts of its `kinds`. With a `scope`, it lists only the parts that need the part of the scope directly.
- `days` is the largest age of the newest read, in days.
- A feed with `complete: false` lists only some parts of its kinds. A part that its read does not show is then no fault.
- A key gives the part of a name, when the name in the source is not the `id` of the part. With no key, a name is the `id` of a part.
- An ignore record tells that a name is no part, with a reason. After its last date `until`, the name is a fault again.

## The reads

A read is live data: the names that a source shows on one date. A program makes it, and it is no record of the layer.

```ts
import type { FeedRead } from "@mark1russell7/stack-feeds";

const reads: FeedRead[] = [
  { feed: "card-statement", date: "2026-11-01", keys: ["CLOUD PROVIDER", "CALL SERVICE", "MUSIC STREAM"] },
  { feed: "devices", date: "2026-11-15", keys: ["phone", "home-host", "cloud-host", "tv"] },
];
```

- A read has only names. Thus a read of secrets has the name of each secret, but not its value. `feedReadsSchema` refuses a read with more fields.
- The newest read of a feed counts. Of two reads of one date, the last read counts.

## The gate

```ts
import { SAMPLE_STACK } from "@mark1russell7/system-stack";
import { checkFeeds, SAMPLE_FEED_READS, SAMPLE_FEED_TODAY, SAMPLE_FEEDS } from "@mark1russell7/stack-feeds";

checkFeeds(SAMPLE_FEEDS, SAMPLE_STACK, { today: SAMPLE_FEED_TODAY, reads: SAMPLE_FEED_READS });
// [{ level: "error", code: "feed-unknown", at: "card-statement", key: "MUSIC STREAM",
//    message: 'The feed "card-statement" shows "MUSIC STREAM", and no part or ignore record has that name.' }]
```

The statement shows a seller that no record has. The owner adds the part of the new service, or an ignore record with a reason.

The codes of the faults are in `FEED_CODES`:

| Code | Level | The fault |
| --- | --- | --- |
| `feed-duplicate`, `feed-days`, `feed-scope` | error | Two feeds have one `id`, a largest age is not a whole number from 0, or a scope is no part. |
| `key-feed`, `key-part`, `key-duplicate` | error | A key names no feed or no part, or two keys name one name of a feed. |
| `ignore-feed`, `ignore-date`, `ignore-part` | error | An ignore record names no feed, has a wrong date, or names a name of a part. |
| `read-feed`, `read-date` | error | A read names no feed, or its date is wrong or after the check. A read with a fault does not count. |
| `feed-none` | error | A feed has no read. |
| `feed-old` | error | The newest read of a feed is older than its largest age. The gate then compares no names of it. |
| `feed-unknown` | error | The source shows a name with no part and no current ignore record. |
| `feed-outside` | error | The source shows a name of a part that the feed does not list, by its kind or by its scope. |
| `feed-gone` | error | A complete feed lists a part, and its source does not show it. |
| `ignore-unused` | error | The source does not show the name of a current ignore record. |
| `ignore-old` | warning | An ignore record ended. |

`feedStates` gives the state of each feed. The state has the date and the age of its newest read, and the parts and the names of each kind.

## The add-on

`feedAddOn` gives the add-on for `checkStackLayers` and for `joinStacks` of the core. It needs the date of the check and the reads:

```ts
import { checkStackLayers } from "@mark1russell7/system-stack";
import { feedAddOn } from "@mark1russell7/stack-feeds/add-on";

const findings = checkStackLayers(stack, [feedAddOn({ today: "2026-11-16", reads })]);
```

`joinFeeds` joins the feed layers of the fragments of a stack. A feed, a key or an ignore record of one name in two fragments is a fault.

## License

MIT
