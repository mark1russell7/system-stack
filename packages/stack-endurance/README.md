# @mark1russell7/stack-endurance

The stores, the draws and the converters of a system stack. The package tells how many days each draw holds when a case cuts its supply. It also tells the shortfall of each level in one year.

It is the endurance add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). The core knows only parts and needs. This package tells what a part takes each day, and what the stores give when its supply stops.

The package names no topic. One query gives the battery days of a rack and the days of water of a building. The resources, the needs and the levels are data.

Each function is a plain function with no clock, no network and no file. The unit of time is the day.

## The records

| Record | What it tells |
| --- | --- |
| `Resource` | A resource of a store and its unit, for example `water.stored` in `L`. |
| `Store` | An amount of one resource, with an optional due date and an optional part that holds it. |
| `Draw` | A need that a load takes each day, its level, its count of users and the part that supplies it. |
| `DirectUse` | One unit of a resource gives an amount of a need. |
| `Converter` | A run takes some resources and gives an amount of a need, for example a stove that cooks dry rice with water and fuel. |
| `CaseCuts` | A case: the parts that it cuts, the survival curve of the duration of each cut, and factors on the rates. |
| `Prior` | The events of a case in one year at one place, and the share that reach the place. |

## The rule of endurance

- A draw takes from the stores only when the case stops its supply part.
- The draws take the resources in the order of their level, then of the codes of their needs.
- A draw takes from its direct uses first, then from its converters.
- The days of a draw are the largest `T` at which the stores give `T` days of its demand. Each higher draw takes its demand first, for `T` days or for its own days when they are fewer.
- A store gives nothing on its due date and after it. A store or a converter whose part stops gives nothing.

With a base stack, a cut also stops each part that cannot work without the cut part. Thus a pump that needs the grid stops with the grid.

## The rule of shortfall

- For one draw in one case, the shortfall is `E[max(0, D - T)] * users`. `T` is the endurance of the draw. `D` is the duration of the cut of its supply part.
- `E[max(0, D - T)]` is the area under the survival curve from `T` on. The curve is linear between its points, so the area is exact.
- For one year, the shortfall is the sum over the cases of `(1 - exp(-perYear * reach))` times the shortfall of the case.
- The query adds the draws of one level. It does not add two levels.

A draw whose supply stops only through the stack has no curve of its duration. The query puts it in `unread`, and its shortfall is not in the sum. A gate shows it as no read, not as a pass.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-endurance` | The records of a layer, the endurance and shortfall queries, the gate, the join and a sample. |
| `@mark1russell7/stack-endurance/schema` | `enduranceSchema`, the zod schema of a layer, with `parseEndurance`. |
| `@mark1russell7/stack-endurance/add-on` | `enduranceAddOn`, the add-on in the form of the layer contract of the core. |

The root entry has no schema library.

## Install

```sh
npm install @mark1russell7/stack-endurance @mark1russell7/system-stack
```

## An example

```ts
import { enduranceOf, SAMPLE_ENDURANCE, yearShortfall } from "@mark1russell7/stack-endurance";

const storm = SAMPLE_ENDURANCE.cases?.find((item) => item.case === "storm");
if (storm !== undefined) {
  const held = enduranceOf(SAMPLE_ENDURANCE, storm, { at: "2026-12-01" });
  // held.needs["food.energy"] is { days: 5.459, binding: ["food.ready", "water.stored"] }.
}
const year = yearShortfall(SAMPLE_ENDURANCE, "home", { at: "2026-12-01" });
// year.levels is { life: 0.0055, health: 0.4866, comfort: 0.2594 }, in user-days.
```

In the sample, the rice needs 2 L of water for each kg, and the drinking water comes first. So the food holds 5.459 days, not 6.889 days.

## The gate

`checkEndurance(layer, stack)` gives the faults of a layer. `ENDURANCE_CODES` lists the codes. The gate finds two records with one key, and an unknown level, resource or part. It also finds a value out of range, a bad date, an empty converter and a bad survival curve. A draw with no way to get its need is a warning.
