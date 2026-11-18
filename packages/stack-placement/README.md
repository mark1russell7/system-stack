# @mark1russell7/stack-placement

The placement of the parts of a system stack as a query. A layer gives the candidates of each slot. The package finds the choices that no other choice beats on the expected cost and on the chance that a function works.

It is the placement add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). The chance comes from [`@mark1russell7/stack-risk`](../stack-risk/README.md), and the bound of the cost from [`@mark1russell7/stack-spend`](../stack-spend/README.md). The search comes from `@mark1russell7/strategy-search`.

Nobody picks a placement by hand. Each choice is a stack, and the front is a result of a query over the candidates. When a price or a chance changes, the front changes.

Each function is a plain function with no clock and no network.

## The rule

A slot is a part that the base stack needs, for example a copy of a program. Each candidate of a slot is a stack fragment that gives that part, with its chances, its costs and its expected cost of a month.

A part of two or more candidates, for example a provider or a region, is in a shared fragment. A placed stack has each shared fragment one time. Thus two copies on one provider share one cause of failure, and the chance shows it.

The front has each choice that keeps the limits and that no other choice beats. A choice beats a different choice when it is as good on the cost and on the chance, and better on one of them.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-placement` | The records of a layer, the placed stack of a choice, the plan, the gate, the join and a sample. |
| `@mark1russell7/stack-placement/schema` | `placementSchema`, the zod schema of a layer, and `parsePlacement`. |
| `@mark1russell7/stack-placement/add-on` | `placementAddOn`, the add-on in the form of the layer contract of the core. |

The root entry has no schema library. Thus a page that only shows a plan gets no zod.

## Install

```sh
npm install @mark1russell7/stack-placement @mark1russell7/stack-risk @mark1russell7/stack-spend @mark1russell7/system-stack
```

## A layer

A placement layer has the format `placement/1`. A stack keeps it in `Stack.layers`, with the key `placement/1`.

```ts
import type { PlacementLayer } from "@mark1russell7/stack-placement";

const layer: PlacementLayer = {
  schema: "placement/1",
  part: "send",
  currency: "USD",
  slots: [
    { id: "copy-a", candidates: [/* one candidate for each offer */] },
    { id: "copy-b", optional: true, candidates: [/* one candidate for each offer */] },
  ],
  shared: [/* one fragment for each provider */],
  limits: { cost: 25, chance: 0.999 },
};
```

`SAMPLE_PLACEMENT` of the package is a full layer. It has two slots, two candidates for each slot, and two providers. `SAMPLE_BASE` is its base stack.

| Field of a layer | What it is |
| --- | --- |
| `part` | The `id` of the part to keep in work, for example a function of the system. It is a part of the base stack. |
| `currency` | The currency of each cost. |
| `slots` | The slots. Each slot is one stage of the search. |
| `shared` | The shared fragments. |
| `limits` | The largest expected cost (`cost`), the largest cost from the spend layer (`bound`), and the smallest chance (`chance`). |

| Field of a slot | What it is |
| --- | --- |
| `id` | The `id` of the part of the slot. A part of the base stack names it in a need. |
| `candidates` | The candidates of the slot. |
| `optional` | With `true`, a choice can leave the slot empty. |

| Field of a candidate | What it is |
| --- | --- |
| `key` | The key of the candidate in its slot. |
| `stack` | The stack fragment. It has the part of the slot, and its layers, for example `risk/1` and `spend/1`. |
| `cost` | The expected cost of a month. |
| `uses` | The `id` of each shared fragment that the candidate needs. |
| `source` | The source of the candidate, for example the `id` of an offer. |

## The placed stack

`placedStack(layer, stack, choice, joiners)` gives the stack of one choice. `joinStacks` of the core joins the base stack, the chosen candidates and their shared fragments. Each add-on of `joiners` joins its layer.

```ts
import { placedStack, SAMPLE_BASE, SAMPLE_PLACEMENT, SAMPLE_TODAY } from "@mark1russell7/stack-placement";
import { riskAddOn } from "@mark1russell7/stack-risk/add-on";
import { spendAddOn } from "@mark1russell7/stack-spend/add-on";

const joiners = [riskAddOn({ today: SAMPLE_TODAY }), spendAddOn({ today: SAMPLE_TODAY })];
const placed = placedStack(SAMPLE_PLACEMENT, SAMPLE_BASE, { "copy-a": "small-x", "copy-b": "small-x" }, joiners);
// placed.ok === true
// placed.stack.parts.map((part) => part.id) => ["send", "copy-a", "copy-b", "provider-x"]
// placed.cost => 10
```

A fault of the choice gives no stack. The codes are `slot-unknown`, `slot-empty`, `candidate-unknown` and `shared-unknown`.

## The plan

`planPlacement(layer, stack, { joiners })` gives the front of the choices.

```ts
import { planPlacement, SAMPLE_BASE, SAMPLE_PLACEMENT } from "@mark1russell7/stack-placement";

const plan = planPlacement(SAMPLE_PLACEMENT, SAMPLE_BASE, { joiners });
plan.front.map((row) => [row.choice["copy-a"], row.choice["copy-b"], row.cost, row.chance.toFixed(6)]);
// => [
//   ["small-x", null, 5, "0.989010"],
//   ["small-x", "small-x", 10, "0.998900"],
//   ["small-x", "small-y", 11, "0.999726"],
//   ["small-y", "small-x", 11, "0.999726"],
// ]
```

Two copies on the provider `provider-x` cost 10 and give 0.998900. A copy on each provider costs 11 and gives 0.999726. The shared provider is the difference.

- A space with 2000 choices or less gets a grid of each choice. A larger space gets a seeded genetic search. The option `evaluations` sets the count.
- A choice that breaks a limit is not on the front. `plan.breaks` counts the choices with each break: `join`, `layer`, `cost`, `bound` and `chance`.
- Each row has the sources of its candidates and its shared fragments. It also has the bound from the spend layer and the most important parts for the chance.
- The search compares a cost to 1e-9 and a chance to 1e-12 (`OBJECTIVE_STEPS`). Thus two choices with one true value tie, and the front keeps each.

The result is deterministic: one layer, one stack and one set of options give one plan.

## The gate

`checkPlacement(layer, stack)` gives the faults of a layer for its base stack. An empty list tells that the gate passes.

| Code | The fault |
| --- | --- |
| `part-unknown` | The part of the layer is not a part of the base stack. |
| `slot-twice` | Two or more slots have one `id`. |
| `slot-part` | The `id` of a slot is a part of the base stack. |
| `slot-unneeded` | No part of the base stack names a slot in a need. It is a warning. |
| `slot-no-candidate` | A slot has no candidate. |
| `candidate-twice` | Two or more candidates of a slot have one key. |
| `candidate-part` | The stack of a candidate has no part with the `id` of its slot. |
| `cost-range` | A cost is not a finite number of 0 or more. |
| `shared-twice` | Two or more shared fragments have one `id`. |
| `shared-unknown` | A candidate uses a shared fragment that the layer does not have. |
| `shared-unused` | No candidate uses a shared fragment. It is a warning. |
| `limit-range` | A limit of cost is less than 0, or the limit of chance is not from 0 to 1. |
| `currency` | The spend layer of the base stack has a different currency. |

The gate does not examine the layers of a fragment. The gates of their add-ons examine each placed stack.

The base stack is not whole before a placement. A part of the base names each slot in a need, and the base has no part for a slot. Thus `checkStack` of the core gives the fault `need-part` for each slot of the base stack. A placed stack has the part of each slot with a candidate. An empty optional slot has no part, and the chance counts that part as down.

## The add-on

`placementAddOn()` gives the add-on for `checkStackLayers` and `joinStacks` of the core. Its `join` is `joinPlacement`: the slots and the shared fragments of each fragment, with one part, one currency and one value for each limit.

## License

MIT
