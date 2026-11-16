# system-stack

A system stack as data. Each part of a system is one record: a person, a device, a host, a network, an account or a service. Each record tells what the part needs.

A question about the system is a query over these records. Nobody keeps a list of answers by hand, so an answer cannot become old when the system changes.

The site is at <https://mark1russell7.github.io/system-stack/>.

## The packages

| Package | What it has |
| --- | --- |
| [`@mark1russell7/system-stack`](packages/system-stack/README.md) | The core: the parts and their needs, the parts that work when some parts are down, the paths and the stop sets of a part, and the checks of a stack. |
| [`@mark1russell7/stack-spend`](packages/stack-spend/README.md) | The spend add-on: the cost of each part, the hard limits of its cost in a month, and a gate. |
| [`@mark1russell7/stack-risk`](packages/stack-risk/README.md) | The risk add-on: the failures that a part must survive, the chance that it works, accepted risks, and a gate. |

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
