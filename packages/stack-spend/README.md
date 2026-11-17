# @mark1russell7/stack-spend

The cost of each part of a system stack as data: plans, prices and the limits of the cost of a month. The package has a gate that fails when a cost can grow with no hard limit. A second gate compares the used amount of a month with each limit. A plan that ends on a date gives a warning before the date, and a query tells which parts stop.

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
| `@mark1russell7/stack-spend` | The records of a layer, the cost formulas, the states, the gate, the steps of the owner, the used amounts and a sample. |
| `@mark1russell7/stack-spend/schema` | `spendSchema` and `parseSpend` for a layer, and `readsSchema` and `parseReads` for a list of reads. |
| `@mark1russell7/stack-spend/add-on` | `spendAddOn`, the add-on in the form of the layer contract of the core. |

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
| `endDays` | The count of days before the end of a plan from which the gate gives a warning. The default is 30. |
| `services` | The cost records, one for each part. |

| Field of a cost record | What it is |
| --- | --- |
| `part` | The `id` of the part of the stack with the cost. |
| `plan` | The name of the plan. |
| `billing` | `free`, `fixed` or `metered`. |
| `price` | The fixed price of a month. A `fixed` service must have one. |
| `limits` | The limits that are in force. Each limit has a `kind` and an `amount` for a month. |
| `wanted` | A limit that is not in force. The gate fails until the limit is in `limits`. |
| `ends` | The end of the plan, for a plan that ends on a date. Refer to [The end of a plan](#the-end-of-a-plan). |
| `proof` | The read of the account: its `date`, its reader in `by`, and its `source`. |
| `steps` | The steps of the owner in the account of the service. |

The billing tells if the cost can grow:

- `free`: the provider cannot take money. The account has no payment method, or the plan has no paid use.
- `fixed`: the price of a month is fixed. A price that was paid one time is a fixed price of 0.
- `metered`: the cost grows with the use. A free allowance with a payment method on the account is `metered`.

A limit of the kind `prepaid` can have `recharge: true`: the provider adds money automatically. A limit of the kind `code` names in `stop` the part of the stack that stops the use.

## The gate

`checkSpend(layer, stack, { today })` gives the faults of a layer. A list with no error tells that the gate passes. A warning does not stop the gate. The gate has no clock: the caller gives the date.

```ts
import { checkSpend, SAMPLE_SPEND, SAMPLE_TODAY } from "@mark1russell7/stack-spend";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

checkSpend(SAMPLE_SPEND, SAMPLE_STACK, { today: SAMPLE_TODAY }).map((fault) => `${fault.code}: ${fault.message}`);
// => [
//   'limit-alert: The cost of "cloud-account" grows with the use, and its only limit is an alert. An alert stops nothing.',
//   'limit-recharge: The prepaid balance of "call-account" gets money automatically, so it does not limit the cost.',
// ]
```

| Code | Level | The fault |
| --- | --- | --- |
| `service-part` | error | A record names no part of the stack. |
| `service-duplicate` | error | Two records name one part. |
| `part-no-service` | error | A part of a kind of `kinds` has no record. |
| `price` | error | A price is less than 0 or not finite, or a `fixed` plan has no price. |
| `amount` | error | The amount of a limit is less than 0 or not finite. |
| `limit-none` | error | The cost of a `metered` service has no limit. |
| `limit-alert` | error | The only limits of a `metered` service are alerts. |
| `limit-recharge` | error | A prepaid balance gets money automatically. |
| `limit-stop` | error | A stop by code does not name the part of the stack that stops the use. |
| `limit-wanted` | error | A wanted limit is not in force. |
| `end-date` | error | The date of the end of a plan is not a date. |
| `end-past` | error | The plan ended before the date of the check. The record gives the cost before the end. |
| `end-soon` | warning | The plan ends in `endDays` days, or fewer. |
| `end-open` | error | The cost after the end of a plan grows with the use, and it has no hard limit. |
| `proof-none` | error | A record has no proof. |
| `proof-date` | error | The date of a proof is not a date, or it is after the date of the check. |
| `proof-old` | error | A proof is older than `proofDays`. |

A record with no cost needs a proof too. Thus "this service is free" is a statement with a reader and a date, and it becomes old.

## The end of a plan

A trial, a free credit or a term ends on a date. The field `ends` of a cost record gives that date. The fields `billing`, `price` and `limits` of the record give the cost before the end.

| Field of `ends` | What it is |
| --- | --- |
| `date` | The last day of the plan, as `YYYY-MM-DD`. |
| `next` | The cost after the end: its `plan`, its `billing`, its `price` and its `limits`. A service that stops has none. |

- With no `next`, the provider stops the service after the date, and it takes no money. The part does not work after the date.
- With a `next`, the service continues after the date, with the cost of `next`.
- The rule holds for the cost of `next` too: a `metered` cost must have a hard limit.

`SAMPLE_ENDS` of the package is a layer for `SAMPLE_STACK` with two plans that end:

```ts
const proof = { date: "2026-11-10", by: "The owner", source: "The billing page of the account" };
const services = [
  {
    part: "cloud-account",
    plan: "A free trial",
    billing: "free",
    ends: { date: "2026-12-01", next: { plan: "A price for the use", billing: "metered", limits: [{ kind: "alert", amount: 5 }] } },
    proof,
  },
  {
    part: "call-account",
    plan: "A free credit, with no payment method",
    billing: "free",
    ends: { date: "2026-11-30" },
    proof,
  },
];
```

```ts
import { checkSpend, SAMPLE_ENDS, SAMPLE_TODAY } from "@mark1russell7/stack-spend";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

checkSpend(SAMPLE_ENDS, SAMPLE_STACK, { today: SAMPLE_TODAY }).map((fault) => `${fault.level} ${fault.code}: ${fault.message}`);
// => [
//   'warning end-soon: The plan of "cloud-account" ends on 2026-12-01, in 15 days. Then the cost changes.',
//   'error end-open: The plan of "cloud-account" ends on 2026-12-01. After the end, the cost grows with the use, and it has no hard limit.',
//   'warning end-soon: The plan of "call-account" ends on 2026-11-30, in 14 days. Then the provider stops the service.',
// ]
```

The free trial of the cloud account becomes a cost with no hard limit. Thus the gate fails before the first invoice, not after it.
The free credit of the call account ends with no plan after it. The provider takes no money, so the gate gives only a warning.

- The warning starts `endDays` days before the last day of the plan. The default is `END_DAYS`, 30 days.
- After the last day, the fault is `end-past`: the record gives the old plan. The owner reads the account again.
- A plan that ends later than the days of warning gives no fault. The fault `end-open` does not wait for the days of warning.
- The faults `price`, `amount` and `limit-stop` examine the cost of `next` too.

### The parts that stop

`planEnds(layer, { today })` gives the end of each plan, with the nearest date first. `endStops(layer, stack, { today })` gives the parts of the stack that stop.

```ts
import { endStops, planEnds, SAMPLE_ENDS, SAMPLE_TODAY } from "@mark1russell7/stack-spend";
import { SAMPLE_STACK } from "@mark1russell7/system-stack";

planEnds(SAMPLE_ENDS, { today: SAMPLE_TODAY });
// => [
//   { part: "call-account", date: "2026-11-30", days: 14, stops: true },
//   { part: "cloud-account", date: "2026-12-01", days: 15, stops: false },
// ]

endStops(SAMPLE_ENDS, SAMPLE_STACK, { today: SAMPLE_TODAY });
// => { ended: ["call-account"], stopped: ["call-account", "call"] }
```

- `ended` has each service that its provider stops in the days of warning. A plan that ended before the date of the check is in it too.
- `stopped` has each part of the stack that does not work without the parts of `ended`. It comes from the needs of the stack.
- A service with a `next` does not stop, so it is not in `ended`.
- The option `days` gives a different count of days. For the parts that stop with one service, use `stopped` of the core.

In the sample, the call service stops with its account. The alert still works, because it gets to its reader through the push service.

The answer is as complete as the needs of the stack. Make a key of an account a part that needs the account. Make each program that uses the key a part that needs the key. Then `stopped` has each program that stops.

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
- For a plan that ends, the largest cost is the larger of the cost before the end and the cost after it. `nextLimit` is the hard limit after the end.
- A cost with no bound after the end gives no `monthMax`, also when the plan before the end is free.

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
| `end-soon` | Decide before the date. A service with no plan after the end stops, and the cost of each other service changes. |
| `end-open` | Set a hard limit for the cost after the end, or stop the service before the date. Then `end-soon` gives no second step. |
| `end-past`, `proof-none`, `proof-old` | Read the plan and the limits in the account, and give them with the date of the read. |

The alert of the cloud account gives no step, because the records do not tell which limit to set. Add a `wanted` limit to the record. Then the fault is `limit-wanted`, and the owner gets a step.

## The used amount of a month

A limit tells the largest cost of a month. A read tells the cost until a date. `useStates(layer, reads, { today })` gives the used amount of each service in the month of `today`.

A read is live data, so it is not a record of the layer. A program makes each read, and the functions take a list of reads.

| Field of a read | What it is |
| --- | --- |
| `part` | The `id` of the part of the service. |
| `source` | `count` or `provider`. |
| `amount` | The cost of the use from the start of the month until the read. |
| `date` | The date of the read. Its month is the month of the amount. |

The source tells who gives the amount:

- `count`: a part of the stack counted the use, and it gives the cost of that use.
- `provider`: the provider of the service shows the cost of the use, on a usage page or in a usage API.

The rule: the used amount is the larger of the count of the stack and the amount of the provider.
A stop by code counts its own use. The provider can show more, because a different program used the account, or because a price changed.
Thus a stop that follows the rule does not stop too late.

```ts
import { SAMPLE_READS, SAMPLE_SPEND, SAMPLE_TODAY, useStates } from "@mark1russell7/stack-spend";

SAMPLE_READS;
// => [
//   { part: "cloud-account", source: "provider", amount: 0, date: "2026-11-15" },
//   { part: "call-account", source: "count", amount: 4, date: "2026-11-16" },
//   { part: "call-account", source: "provider", amount: 5.2, date: "2026-11-16" },
// ]

useStates(SAMPLE_SPEND, SAMPLE_READS, { today: SAMPLE_TODAY });
// => [
//   { part: "cloud-account", billing: "metered", provider: 0, used: 0, age: 1 },
//   { part: "push-account", billing: "fixed" },
//   { part: "call-account", billing: "metered", count: 4, provider: 5.2, used: 5.2, limit: 10, share: 0.52, level: 0.5, over: false, age: 0 },
// ]
```

| Field of a state | What it is |
| --- | --- |
| `count` | The largest amount that a part of the stack counted in the month. |
| `provider` | The largest amount that the provider showed in the month. |
| `used` | The used amount: the larger of `count` and `provider`. |
| `limit` | The hard limit of the service for a month. |
| `share` | The used share of the hard limit: `used` divided by `limit`. |
| `level` | The largest level that the share reached. The default levels are 0.5, 0.8 and 1. |
| `over` | `true` when the used amount is more than the hard limit. |
| `age` | The age of the newest read of the month, in days. |

- A field with no known value is absent. Thus a service with no read of the month has no `used`.
- The amount of a read is the part of the cost that grows with the use. The fixed price of a plan is not in it.
- The cost of a month does not go down. Thus the largest read of the month is the used amount, and a smaller read after it changes nothing.
- A read of a different month does not count.
- A read with a fault does not count, and the gate tells the fault.
- The option `levels` gives different levels. Each level is a share of the hard limit, above 0.

### The gate of the used amounts

`checkUse(layer, reads, { today })` gives the faults of the used amounts. An error stops the gate. A warning does not.

```ts
import { checkUse, SAMPLE_READS, SAMPLE_SPEND, SAMPLE_TODAY } from "@mark1russell7/stack-spend";

checkUse(SAMPLE_SPEND, SAMPLE_READS, { today: SAMPLE_TODAY }).map((fault) => `${fault.level} ${fault.code}: ${fault.message}`);
// => [
//   'warning use-level: The used amount of "call-account" in the month 2026-11 is 5.2 USD: 50 percent of its hard limit of 10 USD, or more.',
//   'warning use-count: The provider shows 5.2 USD for "call-account" in the month 2026-11, and the stack counted 4 USD. The count does not have all the use.',
// ]
```

| Code | Level | The fault |
| --- | --- | --- |
| `read-part` | error | A read names a part with no cost record. |
| `read-amount` | error | The amount of a read is less than 0 or not finite. |
| `read-date` | error | The date of a read is not a date, or it is after the date of the check. |
| `use-billing` | error | A read shows a cost of the use of a `free` or `fixed` service. The cost record is not correct. |
| `use-over` | error | The used amount is more than the hard limit. The limit did not hold. |
| `use-level` | warning | The used amount reached a level of the hard limit. |
| `use-count` | warning | The provider shows more than the stack counted. The count does not have all the use. |
| `use-none` | warning | A `metered` service has no read of the month, so its used amount is not known. |
| `use-old` | warning | The newest read of a `metered` service is older than the option `readDays`. |

- A used amount that is equal to the hard limit is no failure: the limit stopped the use. A used amount above the limit is a failure of the limit.
- A service with no read does not pass and does not fail. The gate tells that it has no read.
- The gate has no memory. A host that sends a message at each level keeps the last level that it sent for each service.
- The option `readDays` gives the largest age of the newest read. With no value, the gate examines no age.

## The formulas
The layer becomes a tree: the layer, then each service, then each limit in force. The plan after the end of a plan is a child of its service too, with its own limits as children.
`spendSpace(layer)` gives this tree as a space of Vex. A plan is a service node or the node of a plan after an end. The programs evaluate on the tree:

| Program | Where | What it gives |
| --- | --- | --- |
| `IS_HARD` | A limit | If the limit is hard. This program is the one definition of a hard limit. |
| `HARD_COUNT` | A plan | The count of its hard limits. |
| `HARD_LIMIT` | A plan | The smallest amount of its hard limits. With no hard limit, it gives `#N/A`. |
| `PLAN_MAX` | A plan | The largest cost of the plan in a month. With no bound, it gives `#N/A`. |
| `MONTH_MAX` | A service | The largest cost of a month, before the end of its plan or after it. With no bound, it gives `#N/A`. |
| `BOUNDED_TOTAL` | The layer | The sum of the largest costs of the services that have a bound. |
| `OPEN_SERVICES` | The layer | The keys of the services with no bound. |

A program is data, so a tool can show each step of a result. `evaluateService(program, tree, part)` evaluates a program at one service. `evaluateNext(program, tree, part)` evaluates a program at the plan after the end of the plan of a service.

The reads become a second tree: the layer, then each service, then each read. `useSpace(layer, reads, { today })` gives this tree. These programs evaluate at a service of it:

| Program | What it gives |
| --- | --- |
| `COUNT_USED` | The largest amount of the reads of the source `count` in the month. |
| `PROVIDER_USED` | The largest amount of the reads of the source `provider` in the month. |
| `USED` | The used amount: the largest amount of the reads of the month. This program is the one definition of the rule. |
| `USE_SHARE` | The used amount divided by the hard limit. |
| `USE_OVER` | If the used amount is more than the hard limit. |
| `USE_LEVEL` | The largest level that the share reached. A share below each level gives 0. |
| `READ_AGE` | The age of the newest read of the month, in days. |

`MONTH_READS` is the axis of the reads of a service in the month of the check.
A share reaches a level when it is the level less `LEVEL_TOLERANCE`, or more. Thus the rounding of a division does not hide a level.

## The read of JSON

`parseSpend` of the entry `/schema` reads the JSON of a layer. It gives the layer, or the faults of its form with the place of each fault.

```ts
import { parseSpend } from "@mark1russell7/stack-spend/schema";

parseSpend({ schema: "spend/1", currency: "USD", kinds: [], proofDays: 90, services: [{ part: "a", billing: "paid" }] });
// => { ok: false, errors: ['The record "spend/1" has a fault at "services.0.billing": Invalid option: expected one of "free"|"fixed"|"metered"'] }
```

The schema examines the form of a record. `checkSpend` examines the meaning of a layer with a correct form.

`parseReads` reads the JSON of a list of reads in the same way, and `checkUse` examines the meaning of the reads.

## The cost records of some owners

`joinSpend(pieces)` joins the spend layers of the fragments of a stack into one layer. A piece is the layer of one fragment, with the name of the fragment.

- The cost records are in the order of the fragments. The record of a part is in one fragment.
- A part with a record in two or more fragments is a fault. Equal records give the fault too.
- The layer has one `currency` and one `proofDays`. A fragment with a different value is a fault.
- The layer has one `endDays` too. A fragment with no `endDays` takes the value of the other fragments.
- The `kinds` are the kinds of each fragment, one time each.

The kinds of the joined layer hold for each part of the joined stack. Thus a kind of one fragment asks a cost record of the parts of that kind in each fragment.

```ts
import { joinSpend } from "@mark1russell7/stack-spend";

const proof = { date: "2026-11-10", by: "The owner" };
const shared = { schema: "spend/1", currency: "USD", proofDays: 90 } as const;

joinSpend([
  { from: "a.json", layer: { ...shared, kinds: ["account"], services: [{ part: "one", billing: "free", proof }] } },
  { from: "b.json", layer: { ...shared, kinds: ["account", "license"], services: [{ part: "two", billing: "free", proof }] } },
]);
// => { ok: true, layer: { schema: "spend/1", currency: "USD", kinds: ["account", "license"], proofDays: 90, services: [{ part: "one", ... }, { part: "two", ... }] } }

joinSpend([
  { from: "a.json", layer: { ...shared, kinds: ["account"], services: [{ part: "one", billing: "free", proof }] } },
  { from: "b.json", layer: { ...shared, currency: "EUR", proofDays: 30, kinds: ["account"], services: [{ part: "one", billing: "free", proof }] } },
]);
// => {
//   ok: false,
//   errors: [
//     'The fragment "a.json" has the currency "USD", and the fragment "b.json" has "EUR".',
//     'The fragment "a.json" has the largest age of a proof in days 90, and the fragment "b.json" has 30.',
//     'The fragments "a.json", "b.json" each have the cost record of the part "one".',
//   ],
// }
```

The add-on of the entry `/add-on` has the function as `join`. `joinStacks` of the core uses it for a stack in two or more documents, and the gate `checkSpend` examines the joined layer afterward.

## The add-on for one check of a stack

`spendAddOn` of the entry `/add-on` gives the add-on in the form of the layer contract. A host gives it to `checkStackLayers` of the core, with the add-ons of the other layers. A host with a stack in two or more documents gives it to `joinStacks` first.

```ts
import { spendAddOn } from "@mark1russell7/stack-spend/add-on";
import { checkStackLayers } from "@mark1russell7/system-stack";

checkStackLayers(stack, [spendAddOn({ today: "2026-11-16" })]);
// => the faults of the stack, then the faults of `checkSpend` for the layer `spend/1`, each with the name of its layer
```

A layer with a wrong form gives one finding `layer-form` for each fault of the form, and the gate does not start. The function refuses a date of a wrong form at once, with a `RangeError`.

## License
MIT
