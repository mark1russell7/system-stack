# @mark1russell7/stack-spend

The cost of each part of a system stack as data: plans, prices and the limits of the cost of a month. The package has a gate that fails when a cost can grow with no hard limit.

It is the spend add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). The core knows only parts and needs. This package puts a cost record on a part.

Each function is a plain function with no clock and no network. Each formula is a Vex program.

## The rule

A cost that grows with the use must have a hard limit for a month. A limit is hard when something stops the use at the amount:

| Kind of limit | What stops the use | Hard |
| --- | --- | --- |
| `provider` | The provider stops the service at the amount. | Yes |
| `prepaid` | The provider stops the service when the prepaid balance is empty. | Yes, with no automatic recharge |
| `code` | A part of the stack counts the cost and stops the use at the amount. | Yes |
| `alert` | Nothing. A message comes at the amount. | No |

An alert stops nothing, so an alert is not a limit. A balance that gets money automatically is not a limit.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-spend` | The records of a layer, the cost formulas, the states, the gate, the steps of the owner and a sample. |
| `@mark1russell7/stack-spend/schema` | `spendSchema`, the zod schema of a layer, and `parseSpend`. |

The root entry has no schema library. Thus a page that only shows the cost of a month gets no zod.

## Install

```sh
npm install @mark1russell7/stack-spend @mark1russell7/system-stack
```

## A layer

A spend layer is one record with a list of cost records. Its format has the name `spend/1`. A stack keeps it in `Stack.layers`, with the key `spend/1`.

```ts
import type { SpendLayer } from "@mark1russell7/stack-spend";

const layer: SpendLayer = {
  schema: "spend/1",
  currency: "USD",
  kinds: ["account"],
  proofDays: 90,
  services: [
    {
      part: "cloud-account",
      plan: "A free allowance, then a price for the use",
      billing: "metered",
      limits: [{ kind: "alert", amount: 5 }],
      proof: { date: "2026-11-10", by: "The owner", source: "The billing page of the account" },
    },
    {
      part: "push-account",
      plan: "A license that was paid one time",
      billing: "fixed",
      price: 0,
      proof: { date: "2026-11-10", by: "The owner", source: "The license page of the account" },
    },
    {
      part: "call-account",
      plan: "A price for each call",
      billing: "metered",
      limits: [
        { kind: "prepaid", amount: 20, recharge: true },
        { kind: "code", amount: 10, stop: "program-home" },
      ],
      proof: { date: "2026-11-10", by: "The owner", source: "The billing page of the account" },
      steps: ["Open the billing page of the account.", "Stop the automatic recharge.", "Save the change."],
    },
  ],
};
```

This layer is `SAMPLE_SPEND` of the package. It is for `SAMPLE_STACK` of the core.

| Field of the layer | What it is |
| --- | --- |
| `currency` | The currency of each amount, as a code of ISO 4217. |
| `kinds` | The kinds of the parts that can have a cost. Each part of one of these kinds must have a record. |
| `proofDays` | The largest age of a proof, in days. |
| `services` | The cost records, one for each part. |

| Field of a cost record | What it is |
| --- | --- |
| `part` | The `id` of the part of the stack with the cost. |
| `plan` | The name of the plan. |
| `billing` | `free`, `fixed` or `metered`. |
| `price` | The fixed price of a month. A `fixed` service must have one. |
| `limits` | The limits that are in force. Each limit has a `kind` and an `amount` for a month. |
| `wanted` | A limit that is not in force. The gate fails until the limit is in `limits`. |
| `proof` | The read of the account: its `date`, its reader in `by`, and its `source`. |
| `steps` | The steps of the owner in the account of the service. |

The billing tells if the cost can grow:

- `free`: the provider cannot take money. The account has no payment method, or the plan has no paid use.
- `fixed`: the price of a month is fixed. A price that was paid one time is a fixed price of 0.
- `metered`: the cost grows with the use. A free allowance with a payment method on the account is `metered`.

A limit of the kind `prepaid` can have `recharge: true`: the provider adds money automatically. A limit of the kind `code` names in `stop` the part of the stack that stops the use.

## The gate

`checkSpend(layer, stack, { today })` gives the faults of a layer. An empty list tells that the gate passes. The gate has no clock: the caller gives the date.

```ts
import { checkSpend, SAMPLE_SPEND, SAMPLE_TODAY } from "@mark1russell7/stack-spend";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

checkSpend(SAMPLE_SPEND, SAMPLE_STACK, { today: SAMPLE_TODAY }).map((fault) => `${fault.code}: ${fault.message}`);
// => [
//   'limit-alert: The cost of "cloud-account" grows with the use, and its only limit is an alert. An alert stops nothing.',
//   'limit-recharge: The prepaid balance of "call-account" gets money automatically, so it does not limit the cost.',
// ]
```

| Code | The fault |
| --- | --- |
| `service-part` | A record names no part of the stack. |
| `service-duplicate` | Two records name one part. |
| `part-no-service` | A part of a kind of `kinds` has no record. |
| `price` | A price is less than 0 or not finite, or a `fixed` service has no price. |
| `amount` | The amount of a limit is less than 0 or not finite. |
| `limit-none` | The cost of a `metered` service has no limit. |
| `limit-alert` | The only limits of a `metered` service are alerts. |
| `limit-recharge` | A prepaid balance gets money automatically. |
| `limit-stop` | A stop by code does not name the part of the stack that stops the use. |
| `limit-wanted` | A wanted limit is not in force. |
| `proof-none` | A record has no proof. |
| `proof-date` | The date of a proof is not a date, or it is after the date of the check. |
| `proof-old` | A proof is older than `proofDays`. |

A record with no cost needs a proof too. Thus "this service is free" is a statement with a reader and a date, and it becomes old.

## The largest cost of a month

`serviceStates(layer)` gives the hard limit and the largest cost of each service. `monthTotal(layer)` gives the largest cost of the layer.

```ts
import { monthTotal, SAMPLE_SPEND, serviceStates } from "@mark1russell7/stack-spend";

serviceStates(SAMPLE_SPEND);
// => [
//   { part: "cloud-account", billing: "metered" },
//   { part: "push-account", billing: "fixed", monthMax: 0 },
//   { part: "call-account", billing: "metered", hardLimit: 10, monthMax: 10 },
// ]

monthTotal(SAMPLE_SPEND);
// => { bounded: 10, open: ["cloud-account"] }
```

- The largest cost of a `free` service is 0, and that of a `fixed` service is its price.
- The largest cost of a `metered` service is its price plus its hard limit. The hard limit is the smallest amount of its hard limits.
- A service with no bound has no `monthMax`. Its part is in `open` of the total.

The cost of the layer has a bound only when `open` is empty. Then `bounded` is that bound.

## The steps of the owner

A program cannot change the settings of an account. `ownerSteps(layer, stack, { today })` gives the work of the owner of the accounts, from the faults of the gate.

```ts
import { ownerSteps, SAMPLE_SPEND, SAMPLE_TODAY } from "@mark1russell7/stack-spend";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

ownerSteps(SAMPLE_SPEND, SAMPLE_STACK, { today: SAMPLE_TODAY });
// => [{
//   part: "call-account",
//   name: "The account of the call service",
//   code: "limit-recharge",
//   text: "Stop the automatic recharge of the prepaid balance.",
//   steps: ["Open the billing page of the account.", "Stop the automatic recharge.", "Save the change."],
// }]
```

| Code | The work of the owner |
| --- | --- |
| `limit-wanted` | Set the wanted limit in the account. A wanted stop by code is the work of a programmer, so it gives no step. |
| `limit-recharge` | Stop the automatic recharge of the balance. |
| `proof-none`, `proof-old` | Read the plan and the limits in the account, and give them with the date of the read. |

The alert of the cloud account gives no step, because the records do not tell which limit to set. Add a `wanted` limit to the record. Then the fault is `limit-wanted`, and the owner gets a step.

## The formulas

The layer becomes a tree: the layer, then each service, then each limit in force. `spendSpace(layer)` gives this tree as a space of Vex. The programs evaluate on it:

| Program | Where | What it gives |
| --- | --- | --- |
| `IS_HARD` | A limit | If the limit is hard. This program is the one definition of a hard limit. |
| `HARD_COUNT` | A service | The count of its hard limits. |
| `HARD_LIMIT` | A service | The smallest amount of its hard limits. With no hard limit, it gives `#N/A`. |
| `MONTH_MAX` | A service | The largest cost of a month. With no bound, it gives `#N/A`. |
| `BOUNDED_TOTAL` | The layer | The sum of the largest costs of the services that have a bound. |
| `OPEN_SERVICES` | The layer | The keys of the services with no bound. |

A program is data, so a tool can show each step of a result. `evaluateService(program, tree, part)` evaluates a program at one service.

## The read of JSON

`parseSpend` of the entry `/schema` reads the JSON of a layer. It gives the layer, or the faults of its form with the place of each fault.

```ts
import { parseSpend } from "@mark1russell7/stack-spend/schema";

parseSpend({ schema: "spend/1", currency: "USD", kinds: [], proofDays: 90, services: [{ part: "a", billing: "paid" }] });
// => { ok: false, errors: ['The record "spend/1" has a fault at "services.0.billing": Invalid option: expected one of "free"|"fixed"|"metered"'] }
```

The schema examines the form of a record. `checkSpend` examines the meaning of a layer with a correct form.

## License

MIT
