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

| Field of a chance record | What it is |
| --- | --- |
| `part` | The `id` of the part. |
| `works` | The chance that the part works at a moment, when each of its needs holds. |
| `source` | The source of the number, for example a service agreement or a measured period. |

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
//   'chance-low: The chance that "alert" works is 0.9649835920528093. The goal is 0.99.',
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
| `chance-part` | A chance record names no part of the stack. |
| `chance-duplicate` | Two chance records name one part. |
| `chance-range` | The chance of a part is not from 0 to 1. |
| `accept-part` | An accepted risk names a part with no goal. |
| `accept-stop` | An accepted risk names no part, or a part that is not in the stack. |
| `accept-date` | The last date of an accepted risk is not a date. |
| `stopped` | The part of a goal does not work, with each part of the stack in operation. |
| `stop-set` | The failure of a set stops a part, and the goal is to survive a set of that size. No record accepts the set. |
| `accept-old` | The acceptance of a stop set ended before the date of the check. |
| `accept-unused` | An accepted risk names a set that is no stop set of its goal. |
| `chance-none` | A goal has a chance, and a part of its paths has no chance record. |
| `chance-low` | The chance that a part works is less than the chance of its goal. |
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
//   value: 0.9649835920528093,
//   importance: [
//     { part: "reader", importance: 0.9948284454152673 },
//     { part: "phone", importance: 0.969832755831969 },
//     { part: "alert", importance: 0.9649835920528093 },
//     { part: "card", importance: 0.0218731279694261 },
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

The paths, the stop sets and the smallest stop set are functions of the core: `pathSets`, `stopSets` and `smallestStop`.

## The read of JSON

`parseRisk` of the entry `/schema` reads the JSON of a layer. It gives the layer, or the faults of its form with the place of each fault.

```ts
import { parseRisk } from "@mark1russell7/stack-risk/schema";

parseRisk({ schema: "risk/1", goals: [{ part: "alert", survives: "1" }] });
// => { ok: false, errors: ['The record "risk/1" has a fault at "goals.0.survives": Invalid input: expected number, received string'] }
```

The schema examines the form of a record. `checkRisk` examines the meaning of a layer with a correct form.

## The add-on for one check of a stack

`riskAddOn` of the entry `/add-on` gives the add-on in the form of the layer contract. A host gives it to `checkStackLayers` of the core, with the add-ons of the other layers.

```ts
import { riskAddOn } from "@mark1russell7/stack-risk/add-on";
import { checkStackLayers } from "@mark1russell7/system-stack";

checkStackLayers(stack, [riskAddOn({ today: "2026-11-16" })]);
// => the faults of the stack, then the faults of `checkRisk` for the layer `risk/1`, each with the name of its layer
```

A layer with a wrong form gives one finding `layer-form` for each fault of the form, and the gate does not start. The function refuses a date of a wrong form at once, with a `RangeError`.

## License
MIT
