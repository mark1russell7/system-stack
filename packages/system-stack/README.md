# @mark1russell7/system-stack

A system stack as data: the parts of a system, and what each part needs. The package has the format of a stack, the parts that work when some parts are down, and the checks of a stack. It also gives the paths of a part and the sets of parts whose failure stops it.

The package names no topic. A topic, for example cost, is an add-on package that keeps its records in a layer of the stack. The add-ons are [`@mark1russell7/stack-spend`](../stack-spend/README.md) and [`@mark1russell7/stack-risk`](../stack-risk/README.md).

Each function is a plain function with no clock and no network.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/system-stack` | The records of a stack, the parts that work, the paths and the stop sets, the checks and a sample stack. |
| `@mark1russell7/system-stack/schema` | `stackSchema`, the zod schema of a stack, `parseStack`, and `formErrors` for the layers of add-ons. |

The root entry has no schema library. Thus a page that only asks which parts work gets no zod.

## Install

```sh
npm install @mark1russell7/system-stack
```

## A stack

A stack is one record with a list of parts. Its format has the name `stack/1`.

```ts
import { working, works, type Stack } from "@mark1russell7/system-stack";

const stack: Stack = {
  schema: "stack/1",
  parts: [
    { id: "power", kind: "power" },
    { id: "host-a", kind: "host", needs: ["power"] },
    { id: "host-b", kind: "host" },
    { id: "program", kind: "service", needs: [{ any: ["host-a", "host-b"] }] },
  ],
};

works(stack, "program", ["power"]); // => true: the program has the second host
works(stack, "program", ["power", "host-b"]); // => false
[...working(stack, ["power"])]; // => ["host-b", "program"]
```

| Field of a part | What it is |
| --- | --- |
| `id` | The name of the part in the records. The ids of one stack are unique. |
| `kind` | The kind of the part, as a free text: for example `host`, `account`, `service` or `person`. The core gives no meaning to a kind. |
| `name` | A name for a reader. |
| `needs` | The needs of the part. The part works only when each need holds. |
| `owner` | The `id` of the part that answers for this part, for example a person. |

A need has three forms:

| Need | It holds when |
| --- | --- |
| `"power"` | The part `power` works. |
| `{ all: [a, b] }` | Each need of the list holds. |
| `{ any: [a, b, c], count: 2 }` | Two or more needs of the list hold. With no `count`, one need is sufficient. |

A list can contain a list. Thus `{ any: [{ all: ["a", "b"] }, "c"] }` is a need.

The field `layers` of a stack has the records of the add-ons. The key of a layer is the name of its format, for example `spend/1`. The core keeps each layer as it is.

## The parts that work

`working(stack, down)` gives the parts that work when the parts of `down` are down. `works(stack, part, down)` gives the answer for one part.

A part works when it is not down and each of its needs holds. The function starts from a stack where no part works. Then it starts each part whose needs hold, until no more part can start. Thus:

- Two parts that need each other do not work, because neither can start first.
- A need that names no part of the stack does not hold.
- The result has the parts in the sequence in which they start.

The sample stack shows an alert that gets to its reader. It has two copies of a program and two message services:

```ts
import { SAMPLE_STACK, works } from "@mark1russell7/system-stack";

works(SAMPLE_STACK, "alert", ["home-power"]); // => true: the copy in the cloud sends the alert
works(SAMPLE_STACK, "alert", ["card"]); // => true: the copy at home and the push service need no card
works(SAMPLE_STACK, "alert", ["home-power", "card"]); // => false
works(SAMPLE_STACK, "alert", ["phone"]); // => false: each path needs the phone
```

## The paths and the stop sets

Three functions tell why a part works, and which failures stop it. They read only the parts and their needs.

| Function | What it gives |
| --- | --- |
| `pathSets(stack, part)` | Each smallest set of other parts with which the part works. |
| `stopSets(stack, part, { size })` | Each smallest set of other parts whose failure stops the part, up to `size` parts. The default of `size` is 1. |
| `smallestStop(stack, part)` | One stop set with the smallest count of parts. |

```ts
import { pathSets, smallestStop, stopSets } from "@mark1russell7/system-stack";

pathSets(stack, "program"); // => { kind: "exact", sets: [["host-b"], ["power", "host-a"]] }
stopSets(stack, "program"); // => { kind: "exact", sets: [] }: no failure of one part stops the program
stopSets(stack, "program", { size: 2 }); // => { kind: "exact", sets: [["power", "host-b"], ["host-a", "host-b"]] }
smallestStop(stack, "program"); // => { kind: "exact", parts: ["power", "host-b"] }
```

A stop set of one part is a single point of failure. The sample alert has two:

```ts
import { SAMPLE_STACK, stopSets } from "@mark1russell7/system-stack";

stopSets(SAMPLE_STACK, "alert"); // => { kind: "exact", sets: [["reader"], ["phone"]] }
stopSets(SAMPLE_STACK, "alert", { down: ["program-cloud"] });
// => { kind: "exact", sets: [["reader"], ["phone"], ["home-power"], ["home-network"], ["home-host"], ["program-home"]] }
```

- The option `down` names the parts that are down at this time. The sets then have only parts that are not down.
- A set does not contain the part itself, and no set of a result contains a second set of it.
- The sets agree with `working`. The part works with the parts of a path set. It does not work without the parts of a stop set.
- `smallestStop` gives `{ kind: "none" }` for a part that no failure of other parts stops.

The count of the sets can grow fast with the size of a stack. The option `maxSets` is the largest count of sets in one step of a search, and its default is 4096. A search that passes it gives `{ kind: "budget" }`. That result is not an answer: do not read it as "no stop set".

[`@mark1russell7/stack-risk`](../stack-risk/README.md) puts goals on these sets, and it has a gate.

## The checks

`checkStack(stack)` gives the faults of a stack. An empty list tells that the stack is correct.

| Code | The fault |
| --- | --- |
| `id-duplicate` | Two parts have one `id`. |
| `need-part` | A need names no part of the stack. |
| `need-count` | The `count` of a need is not a whole number from 1 to the size of its list. |
| `need-cycle` | Parts need each other, so none of them can start. |
| `owner-part` | An `owner` names no part of the stack. |

```ts
import { checkStack } from "@mark1russell7/system-stack";

checkStack({
  schema: "stack/1",
  parts: [
    { id: "a", kind: "service", needs: ["b"] },
    { id: "b", kind: "service", needs: ["a", "c"] },
  ],
});
// => [
//   { level: "error", code: "need-cycle", at: "a", other: "b", message: 'The parts "a", "b" need each other, so none of them can start.' },
//   { level: "error", code: "need-part", at: "b", other: "c", message: 'The part "b" needs "c", which is no part of the stack.' },
// ]
```

A fault has a `level`, a `code`, the `id` of its part in `at`, and a `message` for a reader. The checks of the add-ons give faults of the same form.

`dayNumber(date)` gives the count of days of a date `YYYY-MM-DD` from 1970-01-01. The gates of the add-ons compare dates with it, so they have no clock.

## The read of JSON

`parseStack` of the entry `/schema` reads the JSON of a stack. It gives the stack, or the faults of its form with the place of each fault.

```ts
import { parseStack } from "@mark1russell7/system-stack/schema";

parseStack({ schema: "stack/1", parts: [{ id: "a" }] });
// => { ok: false, errors: ['The record "stack/1" has a fault at "parts.0.kind": Invalid input: expected string, received undefined'] }
```

The schema examines the form of a record, and it refuses a field that the format does not have. `checkStack` examines the meaning of a stack with a correct form.

## License

MIT
