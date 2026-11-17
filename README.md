# system-stack

A system stack as data. Each part of a system is one record: a person, a device, a host, a network, an account or a service. Each record tells what the part needs.

A question about the system is a query over these records. Nobody keeps a list of answers by hand, so an answer cannot become old when the system changes.

The site is at <https://mark1russell7.github.io/system-stack/>.

## The packages

| Package | What it has |
| --- | --- |
| [`@mark1russell7/system-stack`](packages/system-stack/README.md) | The core: the parts and their needs, the parts that work when some parts are down, the paths and the stop sets of a part, and the checks of a stack. |
| [`@mark1russell7/stack-spend`](packages/stack-spend/README.md) | The spend add-on: the cost of each part, the hard limits of its cost in a month, the used amount of a month, and a gate for each. The gate gives a warning before a plan ends. |
| [`@mark1russell7/stack-risk`](packages/stack-risk/README.md) | The risk add-on: the failures that a part must survive, the chance that it works, accepted risks, and a gate. |
| [`@mark1russell7/stack-tofu`](packages/stack-tofu/README.md) | The OpenTofu add-on: the resources of each part, a generator of the files, the planned cost of each account against its hard limit, and a gate of a plan. |

The core names no topic. Each topic is an add-on package. An add-on keeps its records in a layer of the stack, and it has its own checks and formulas. The add-ons do not know each other.

## A first look

```ts
import { works, type Stack } from "@mark1russell7/system-stack";

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
```

## One check for a whole stack

A host gives the add-ons to `checkStackLayers` of the core. The function gives the faults of the core and of each layer.

```ts
import { riskAddOn } from "@mark1russell7/stack-risk/add-on";
import { serviceStates } from "@mark1russell7/stack-spend";
import { spendAddOn } from "@mark1russell7/stack-spend/add-on";
import { tofuAddOn } from "@mark1russell7/stack-tofu/add-on";
import { checkStackLayers, readLayer, type Stack } from "@mark1russell7/system-stack";

// The parts, with the layers `spend/1`, `risk/1` and `tofu/1`
declare const stack: Stack;

const today = "2026-11-16";
const spend = spendAddOn({ today });
// The host connects two add-ons: the hard limits of the spend layer are the budgets of the OpenTofu gate.
const read = readLayer(stack, spend);
const budgets = read?.ok === true ? serviceStates(read.layer) : [];

const findings = checkStackLayers(stack, [spend, riskAddOn({ today }), tofuAddOn({ budgets })]);
const pass = !findings.some((finding) => finding.level === "error");
```

The samples of the packages have faults that show the gates. With the three sample layers, the findings are these errors.

| Layer | Code | Part | The fault |
| --- | --- | --- | --- |
| `risk/1` | `stop-set` | `alert` | The failure of the phone alone stops the alert. |
| `risk/1` | `chance-low` | `alert` | The chance that the alert works is less than its goal. |
| `spend/1` | `limit-alert` | `cloud-account` | The only limit of the cloud account is an alert. |
| `spend/1` | `limit-recharge` | `call-account` | The prepaid balance of the call account gets money automatically. |
| `tofu/1` | `limit-none` | `cloud-account` | The resources have a planned cost, and the account has no hard limit. |

The last finding comes from two layers. The spend layer has no hard limit for the cloud account, so the OpenTofu gate refuses the cost of its resources.

## A stack in the documents of some owners

A large stack has more than one owner, and each owner keeps a document. `joinStacks` of the core joins the documents into one stack, and each add-on joins its own layer.

```ts
import { riskAddOn } from "@mark1russell7/stack-risk/add-on";
import { serviceStates } from "@mark1russell7/stack-spend";
import { spendAddOn } from "@mark1russell7/stack-spend/add-on";
import { tofuAddOn } from "@mark1russell7/stack-tofu/add-on";
import { checkStackLayers, joinStacks, readLayer, type StackFragment } from "@mark1russell7/system-stack";

// One document for each owner: some parts of the stack, with the records of the layers for them
declare const files: readonly StackFragment[];

const today = "2026-11-16";
const spend = spendAddOn({ today });
const risk = riskAddOn({ today });
const join = joinStacks(files, [spend, risk, tofuAddOn()]);
if (join.ok) {
  // The joined stack is one whole document, so the check is the check of the example above.
  const read = readLayer(join.stack, spend);
  const budgets = read?.ok === true ? serviceStates(read.layer) : [];
  const findings = checkStackLayers(join.stack, [spend, risk, tofuAddOn({ budgets })]);
}
```

The sample stack in two documents gives the five errors of the table above. A part or a record of two owners is an error of the join, and the join gives no stack then.

| Layer | Code | The fault |
| --- | --- | --- |
| `stack/1` | `part-twice` | Two documents have a part with one `id`. |
| `spend/1` | `layer-join` | Two documents have the cost record of one part, or a different currency. |
| `risk/1` | `layer-join` | Two documents have the goal or the chance record of one part. |
| `tofu/1` | `layer-join` | Two documents have one resource address, or each has a backend. |

Thus no document removes or replaces a record of a different owner.

## The data

This repository has sample data only. Keep the records of a real system in a private repository: they name accounts and hosts.

## Work on the repository

- Install with `pnpm install`. Node.js 22 or later is necessary.
- Start the tests with `pnpm test`, and the type check with `pnpm typecheck`.
- `pnpm check:boundaries` examines the imports. Only the entry `/schema` of a package imports zod.
- `pnpm lint:ste` examines the prose. [`CLAUDE.md`](CLAUDE.md) has the writing rules.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) has the plan, and [`RELEASING.md`](RELEASING.md) tells how a release works.

## License

MIT
