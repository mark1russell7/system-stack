# @mark1russell7/system-stack

A system stack as data: the parts of a system, and what each part needs. The package has the format of a stack, the parts that work when some parts are down, and the checks of a stack. It also gives the paths of a part and the sets of parts whose failure stops it.

The package names no topic. A topic, for example cost, is an add-on package that keeps its records in a layer of the stack. The add-ons are [`@mark1russell7/stack-spend`](../stack-spend/README.md), [`@mark1russell7/stack-risk`](../stack-risk/README.md), [`@mark1russell7/stack-tofu`](../stack-tofu/README.md) and [`@mark1russell7/stack-placement`](../stack-placement/README.md).

Each function is a plain function with no clock and no network.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/system-stack` | The records of a stack, the parts that work, the paths and the stop sets, the checks, the check of the layers, the join of stacks and a sample stack. |
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

`stopped(stack, down)` gives the parts that stop: each part that works with no part down, and that does not work with the parts of `down` down. The result is in the order of the parts.

```ts
import { SAMPLE_STACK, stopped } from "@mark1russell7/system-stack";

stopped(SAMPLE_STACK, ["call-account"]); // => ["call-account", "call"]: the alert still gets to its reader through the push service
stopped(SAMPLE_STACK, ["call", "push-account"]); // => ["push-account", "push", "call", "alert"]
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

## The layers of the add-ons

An add-on keeps its records in a layer of the stack: a value in `layers`, with the name of its format as the key. The core keeps each layer, and it reads none.

`checkStackLayers(stack, addOns)` gives the findings of a whole document. A finding is a fault with the name of its layer in `layer`.

- A fault of `checkStack` has the layer `stack/1`. When the core has an error, the function examines no layer.
- `layer-name`: the name of a layer is not a word, a slash and a version, for example `spend/1`.
- `layer-unknown`: no add-on of the list reads the layer. This finding is a warning, and the stack keeps the layer.
- `layer-form`: the add-on cannot read its layer. Each fault of the form is one finding.
- Each other finding is a fault of the meaning of a layer, from its add-on.

The findings of the layers are in the order of the layer names. Thus the order of the add-ons does not change the result.

An add-on has the name of its layer, a function `parse` for the form and a function `check` for the meaning. Each add-on package gives its add-on in its entry `/add-on`. This example makes a small one.

```ts
import { checkStackLayers, partsById, type StackAddOn } from "@mark1russell7/system-stack";

// A layer with the list of the parts that a person examined.
const examined: StackAddOn<readonly string[]> = {
  schema: "examined/1",
  parse: (value) => (Array.isArray(value) && value.every((id) => typeof id === "string") ? { ok: true, layer: value } : { ok: false, errors: ['The layer "examined/1" is not a list of texts.'] }),
  check: (layer, stack) =>
    layer.filter((id) => !partsById(stack).has(id)).map((id) => ({ level: "error", code: "examined-part", at: id, message: `The list names "${id}", which is no part of the stack.` })),
};

checkStackLayers({ schema: "stack/1", parts: [{ id: "a", kind: "host" }], layers: { "examined/1": ["a", "b"], "notes/1": {} } }, [examined]);
// => [
//   { level: "error", code: "examined-part", at: "b", message: 'The list names "b", which is no part of the stack.', layer: "examined/1" },
//   { level: "warning", code: "layer-unknown", layer: "notes/1", at: "", message: 'The document has the layer "notes/1", and no add-on of the check reads it. The document keeps the layer.' },
// ]
```

`readLayer(stack, addOn)` gives the layer of one add-on, for a query of a host. A stack without the layer gives `undefined`.

The contract of the layers is the entry `@mark1russell7/coeval/layers`. The core gives its names again: `AddOn`, `LayerFault`, `LayerFinding`, `LayerParse`, `readLayer` and `isLayerName`.

## One stack from the documents of some owners

A large stack has more than one owner, and each owner keeps a document. `joinStacks(fragments, addOns)` joins the documents into one stack. A fragment is one document with a name, for example the path of its file.

- The parts of the stack are the parts of each fragment, in the order of the fragments.
- `part-twice`: two or more fragments have a part with one `id`. Equal parts give the finding too.
- `fragment-name`: two fragments have one name.
- A layer of one fragment stays as it is, and no add-on reads it.
- A layer of two or more fragments goes to the function `join` of its add-on.
- `layer-twice`: two or more fragments have a layer, and no add-on of the list joins it.
- `layer-form`: the add-on cannot read the layer of a fragment.
- `layer-join`: the add-on cannot join the layers. Each fault of the join is one finding.

A join with a finding gives no stack. Thus no document removes or replaces a record of a different owner.

```ts
import { joinStacks, type StackFragment } from "@mark1russell7/system-stack";

// One owner has the function. A different owner has the host that the function needs.
const service: StackFragment = { name: "service.json", stack: { schema: "stack/1", parts: [{ id: "web", kind: "function", needs: ["host"] }] } };
const platform: StackFragment = { name: "platform.json", stack: { schema: "stack/1", parts: [{ id: "host", kind: "host" }] } };

joinStacks([service, platform], []);
// => { ok: true, stack: { schema: "stack/1", parts: [{ id: "web", kind: "function", needs: ["host"] }, { id: "host", kind: "host" }] } }

joinStacks([service, platform, { name: "copy.json", stack: platform.stack }], []);
// => {
//   ok: false,
//   findings: [
//     { level: "error", code: "part-twice", layer: "stack/1", at: "host", from: ["platform.json", "copy.json"], message: 'The fragments "platform.json", "copy.json" each have the part "host".' },
//   ],
// }
```

A finding has the names of its fragments in `from`. The findings are in this order: the names of the fragments, the parts, then the layers in the order of their names.

The join does not examine the meaning of the stack. Thus a fragment can need a part of a different fragment. Give the joined stack to `checkStackLayers` afterward.

An add-on that joins its layer is a `StackJoiner`: an add-on with the function `join`. The function gets the layer of each fragment, with the name of the fragment. Two tools do the usual work. `joinRecords` joins lists of records with a key, and a key in two or more fragments is a fault. `joinSetting` joins a setting, and two different values are a fault. This example adds a join to the add-on `examined`.

```ts
import { joinRecords, joinStacks, type StackFragment, type StackJoiner } from "@mark1russell7/system-stack";

// A part is in the list of one fragment.
const joiner: StackJoiner<readonly string[]> = {
  ...examined,
  join: (pieces) => {
    const ids = joinRecords(pieces, (layer) => layer, (id) => id, "examined part");
    return ids.errors.length > 0 ? { ok: false, errors: ids.errors } : { ok: true, layer: ids.items };
  },
};
const withList = (fragment: StackFragment, list: readonly string[]): StackFragment => ({ name: fragment.name, stack: { ...fragment.stack, layers: { "examined/1": list } } });

joinStacks([withList(service, ["web"]), withList(platform, ["host"])], [joiner]);
// => { ok: true, stack: { schema: "stack/1", parts: [...], layers: { "examined/1": ["web", "host"] } } }

joinStacks([withList(service, ["web", "host"]), withList(platform, ["host"])], [joiner]);
// => {
//   ok: false,
//   findings: [
//     { level: "error", code: "layer-join", layer: "examined/1", at: "", from: ["service.json", "platform.json"], message: 'The fragments "service.json", "platform.json" each have the examined part "host".' },
//   ],
// }
```

Each add-on package gives a `StackJoiner` in its entry `/add-on`. Thus a host gives one list of add-ons to `joinStacks` and to `checkStackLayers`.

A join of joined stacks gives the stack of one join of all the fragments. A fragment with no parts and no layers changes nothing. A layer has these two properties when the join of its add-on has them.

The join of the layers is `joinLayers` of the entry `@mark1russell7/coeval/layers`. The core gives its names again: `LayerJoiner`, `LayerPiece`, `joinRecords`, `joinSetting` and the types of their results.

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
