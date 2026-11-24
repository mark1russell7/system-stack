# @mark1russell7/stack-risk

The risks of a system stack as queries. The package tells which failures stop a part, how many failures the part survives, and the chance that it works. It has a gate that fails when a part does not meet its goal.

It is the risk add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). The core knows only parts and needs. This package puts a goal on a part.

Nobody keeps a list of risks by hand. Each risk is a result of a query over the records, so it changes when the stack changes.

Each function is a plain function with no clock and no network.

## The rule

A goal tells how many failures a part must survive. The gate finds each set of parts whose failure stops the part. A set of the size of the goal, or smaller, is a fault.

The owner can accept a set, with a reason and a last date. Thus each risk of the system is in one of two states: a fault of the gate, or a record with a reason.

A search that passes its limit gives no result. The gate then fails, because no result is not a good result.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-risk` | The records of a layer, the states of the goals, the chance, the gate and a sample. |
| `@mark1russell7/stack-risk/schema` | `riskSchema`, the zod schema of a layer, and `parseRisk`. |
| `@mark1russell7/stack-risk/add-on` | `riskAddOn`, the add-on in the form of the layer contract of the core. |

The root entry has no schema library. Thus a page that only shows the states gets no zod.

## Install

```sh
npm install @mark1russell7/stack-risk @mark1russell7/system-stack
```

## A layer

A risk layer is one record with goals, chances and accepted risks. Its format has the name `risk/1`. A stack keeps it in `Stack.layers`, with the key `risk/1`.

```ts
import type { RiskLayer } from "@mark1russell7/stack-risk";

const layer: RiskLayer = {
  schema: "risk/1",
  goals: [{ part: "alert", survives: 1, chance: 0.99 }],
  chances: [
    { part: "reader", works: 0.97, source: "An estimate: the hours when the reader cannot read a message" },
    { part: "phone", works: 0.995, source: "An estimate: the hours with no battery or no signal" },
    { part: "cloud-host", works: 0.999, source: "The service agreement of the provider" },
    // The sample has a record for each part of the paths of the alert.
  ],
  accepted: [{ part: "alert", stop: ["reader"], reason: "One person reads the alerts. A second reader is a later step.", until: "2027-06-30" }],
};
```

`SAMPLE_RISK` of the package is this layer with each chance record. It is for `SAMPLE_STACK` of the core.

| Field of a goal | What it is |
| --- | --- |
| `part` | The `id` of the part with the goal, for example a function of the system. |
| `survives` | The count of failures of other parts that the part survives. With 1, no failure of one part stops the part. |
| `chance` | The smallest chance that the part works, from 0 to 1. |
| `within` | The limit of time of the chance, in seconds from the event. With it, the part must also end its work in time. A goal with a limit of time needs a chance. |

| Field of a chance record | What it is |
| --- | --- |
| `part` | The `id` of the part. |
| `works` | The chance that the part works at a moment, when each of its needs holds. |
| `source` | The source of the number, for example a service agreement or a measured period. |
| `wait` | The wait of the part before it starts, in seconds, for example the wait of the rank of a copy. The default is 0. |
| `delay` | The points of the distribution of the time from the end of the wait to the end of the work, when the part works. Each point is `{ within, chance }`: the chance that the time is `within` seconds or less. |

| Field of an accepted risk | What it is |
| --- | --- |
| `part` | The `id` of the part with the goal. |
| `stop` | The parts of one set, in any sequence. Their failure together stops the part. |
| `reason` | The reason of the owner. |
| `until` | The last date of the acceptance. An acceptance without it has no end. |

## The gate

`checkRisk(layer, stack, { today })` gives the faults of a layer. An empty list tells that the gate passes. The gate has no clock: the caller gives the date.

```ts
import { checkRisk, SAMPLE_RISK, SAMPLE_TODAY } from "@mark1russell7/stack-risk";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

checkRisk(SAMPLE_RISK, SAMPLE_STACK, { today: SAMPLE_TODAY }).map((fault) => `${fault.code}: ${fault.message}`);
// => [
//   'stop-set: The failure of the set ["phone"] stops "alert". The goal of "alert" is to survive each set of 1 or fewer parts.',
//   'chance-low: The chance that "alert" works is 0.9649835920528091. The goal is 0.99.',
// ]
```

The failure of the reader alone stops the alert too. A record accepts that set until 2027-06-30, so it is no fault. After that date, the gate gives the fault `accept-old` for the set.

The gate examines the design: each part of the stack is in operation. A fault of a stop set has the set in its field `parts`.

| Code | The fault |
| --- | --- |
| `goal-part` | A goal names no part of the stack. |
| `goal-duplicate` | Two goals name one part. |
| `goal-survives` | The count of a goal is not a whole number from 0. |
| `goal-chance` | The chance of a goal is not from 0 to 1. |
| `goal-within` | The limit of time of a goal is not a time of 0 or more, or the goal has no chance. |
| `chance-part` | A chance record names no part of the stack. |
| `chance-duplicate` | Two chance records name one part. |
| `chance-range` | The chance of a part is not from 0 to 1. |
| `chance-delay` | The wait of a part is not a time of 0 or more, or its delay points are not in order. |
| `accept-part` | An accepted risk names a part with no goal. |
| `accept-stop` | An accepted risk names no part, or a part that is not in the stack. |
| `accept-date` | The last date of an accepted risk is not a date. |
| `stopped` | The part of a goal does not work, with each part of the stack in operation. |
| `stop-set` | The failure of a set stops a part, and the goal is to survive a set of that size. No record accepts the set. |
| `accept-old` | The acceptance of a stop set ended before the date of the check. |
| `accept-unused` | An accepted risk names a set that is no stop set of its goal. |
| `chance-none` | A goal has a chance, and a part of its paths has no chance record. |
| `chance-low` | The chance that a part works is less than the chance of its goal. With a limit of time, the part must also end in time. |
| `no-read` | A search passed its limit, so the gate has no result for the goal. |

The gate reports only the smallest sets. When the failure of one part stops a part, each larger set with that part is not a second fault.

An accepted risk that names no stop set is a fault. Thus a record cannot stay after a change of the stack removed its risk.

## The state at this time

The gate examines the design. `goalStates(layer, stack, { down })` gives the state of each goal when the parts of `down` do not work. The parts of `down` come from the monitors of the system.

```ts
import { goalStates, SAMPLE_RISK } from "@mark1russell7/stack-risk";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

goalStates(SAMPLE_RISK, SAMPLE_STACK);
// => [{ part: "alert", read: true, works: true, margin: 0, stop: ["reader"], points: ["reader", "phone"] }]

goalStates(SAMPLE_RISK, SAMPLE_STACK, { down: ["program-cloud"] });
// => [{
//   part: "alert", read: true, works: true, margin: 0, stop: ["reader"],
//   points: ["reader", "phone", "home-power", "home-network", "home-host", "program-home"],
// }]
```

| Field of a state | What it is |
| --- | --- |
| `works` | If the part works at this time. |
| `margin` | The count of more failures that the part always survives. It is `Infinity` when no failure of other parts stops the part. |
| `stop` | A smallest set of parts whose failure stops the part. |
| `points` | Each part whose failure alone stops the part. |

With the copy in the cloud down, the alert still works. But each part of the copy at home is then a single point of failure. A page can show this change before the second failure comes.

A state with `read: false` has no result, because the search passed its limit. Do not show it as a good state.

## The chance

`worksChance(layer, stack, part)` gives the chance that a part works, from the chance record of each part of its paths.

```ts
import { SAMPLE_RISK, worksChance } from "@mark1russell7/stack-risk";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

const chance = worksChance(SAMPLE_RISK, SAMPLE_STACK, "alert");
// => {
//   kind: "exact",
//   value: 0.9649835920528091,
//   importance: [
//     { part: "reader", importance: 0.9948284454152673 },
//     { part: "phone", importance: 0.9698327558319689 },
//     { part: "alert", importance: 0.9649835920528091 },
//     { part: "card", importance: 0.02187312796942623 },
//     ...
//   ],
//   assumed: [],
// }
```

- Each part works or fails alone. A shared cause of failure is thus a part of the stack: a provider, an account or a power feed.
- The value is exact. A part that two paths share counts one time.
- The importance of a part is the chance when the part works, minus the chance when the part fails. The list starts with the largest importance.
- A part with no chance record has the chance 1, and `assumed` names it. The gate gives the fault `chance-none` for such a part.

The sample shows where work helps most. The two copies of the program and the two message services have a small importance. The reader and the phone have a large one.

### A shared part from measured chances

Two copies of a program fail together more often than two independent copies. A part that they share causes it, for example a release or a host. `sharedCauseFit(group)` gives the chance of that shared part from the measured chances of the group.

```ts
import { sharedCauseFit } from "@mark1russell7/stack-risk";

// Each copy works 0.95 of the time, and one or more copies work 0.97 of the time.
const fit = sharedCauseFit({ works: [0.95, 0.95], anyWorks: 0.97 });
// => { shared: 0.9704..., own: [0.9789..., 0.9789...] }
```

- A part of the group works when the shared part and its own part work. Measure each chance in the same window of time.
- Put the shared part in the stack as a need of each part of the group, with the chance `shared`. Give each part its `own` chance.
- For two parts the value is exact. For 3 or more parts, halvings of the interval find the one value that fits.
- When the parts fail together less often than independent parts, `shared` is 1 and each `own` chance is the measured chance.

### The chance within a limit of time

`worksChance(layer, stack, part, { within })` gives the chance that a part works and ends its work within `within` seconds of the event.

```ts
const layer = {
  schema: "risk/1",
  goals: [{ part: "send", survives: 1, chance: 0.999, within: 90 }],
  chances: [
    { part: "home", works: 0.98, delay: [{ within: 5, chance: 0.9 }, { within: 30, chance: 0.999 }] },
    { part: "cloud", works: 0.99, wait: 60, delay: [{ within: 5, chance: 0.95 }] },
  ],
} as const;
worksChance(layer, stack, "send", { within: 90 });
```

- The chance of each part is its chance to work, times `inTimeChance(record, within)`: the chance that its wait and its delay end in time.
- Between two points of a delay, the chance is the chance of the lower point. The chance of a part does not decrease when the chance of one of its parts increases. Thus the result is a lower bound, which fits a gate.
- A part with no wait and no delay ends at once. With `within: Infinity`, each delay gives the chance of its last point.
- The time of each part is independent of the others when its needs work. A path ends when its last part ends: the delays do not add. Thus give the time of each part from the event, for example the time of a copy to send.
- Without `within`, the time has no effect, and the result is the chance at a moment.

For one copy or more, the result is equal to `sendChance` of [`@mark1russell7/algebra/availability`](https://www.npmjs.com/package/@mark1russell7/algebra). A cause of a placement is a part, and a copy is a part that needs its causes. A property test holds this equivalence.

The paths, the stop sets and the smallest stop set are functions of the core: `pathSets`, `stopSets` and `smallestStop`.

## The read of JSON

`parseRisk` of the entry `/schema` reads the JSON of a layer. It gives the layer, or the faults of its form with the place of each fault.

```ts
import { parseRisk } from "@mark1russell7/stack-risk/schema";

parseRisk({ schema: "risk/1", goals: [{ part: "alert", survives: "1" }] });
// => { ok: false, errors: ['The record "risk/1" has a fault at "goals.0.survives": Invalid input: expected number, received string'] }
```

The schema examines the form of a record. `checkRisk` examines the meaning of a layer with a correct form.

## The goals of some owners

`joinRisk(pieces)` joins the risk layers of the fragments of a stack into one layer. A piece is the layer of one fragment, with the name of the fragment.

- The goals and the chance records are in the order of the fragments. The record of a part is in one fragment.
- A part with a goal in two or more fragments is a fault. Equal goals give the fault too.
- A part with a chance record in two or more fragments is a fault. Equal records give the fault too.
- The accepted risks are in the order of the fragments. A fragment can accept a risk of a goal of a different fragment.

```ts
import { joinRisk } from "@mark1russell7/stack-risk";

const goals = { schema: "risk/1", goals: [{ part: "alert", survives: 1 }], chances: [{ part: "phone", works: 0.99 }] } as const;
const accepted = [{ part: "alert", stop: ["reader"], reason: "One reader is enough for this year.", until: "2027-06-30" }];

joinRisk([
  { from: "a.json", layer: goals },
  { from: "b.json", layer: { schema: "risk/1", goals: [], accepted } },
]);
// => { ok: true, layer: { schema: "risk/1", goals: [{ part: "alert", survives: 1 }], chances: [{ part: "phone", works: 0.99 }], accepted: [{ part: "alert", stop: ["reader"], ... }] } }

joinRisk([
  { from: "a.json", layer: goals },
  { from: "b.json", layer: { schema: "risk/1", goals: [], chances: [{ part: "phone", works: 0.9 }], accepted } },
]);
// => { ok: false, errors: ['The fragments "a.json", "b.json" each have the chance record of the part "phone".'] }
```

The add-on of the entry `/add-on` has the function as `join`. `joinStacks` of the core uses it for a stack in two or more documents, and the gate `checkRisk` examines the joined layer afterward.

The sequence of the parts of a stack does not change a chance, to its last digit. Thus the joined stack and one whole document give the same faults.

## The add-on for one check of a stack

`riskAddOn` of the entry `/add-on` gives the add-on in the form of the layer contract. A host gives it to `checkStackLayers` of the core, with the add-ons of the other layers. A host with a stack in two or more documents gives it to `joinStacks` first.

```ts
import { riskAddOn } from "@mark1russell7/stack-risk/add-on";
import { checkStackLayers } from "@mark1russell7/system-stack";

checkStackLayers(stack, [riskAddOn({ today: "2026-11-16" })]);
// => the faults of the stack, then the faults of `checkRisk` for the layer `risk/1`, each with the name of its layer
```

A layer with a wrong form gives one finding `layer-form` for each fault of the form, and the gate does not start. The function refuses a date of a wrong form at once, with a `RangeError`.

## License
MIT
