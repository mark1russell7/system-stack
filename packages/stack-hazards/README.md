# @mark1russell7/stack-hazards

Hazard cases as reference data. Each case tells the public supplies that it can stop, and the source of each claim. Each cut has a law of the duration of the stop, or no read.

It is an add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). It gives the values of `CaseCuts` of [`@mark1russell7/stack-endurance`](../stack-endurance/README.md). The cases have generic names and codes of an alert taxonomy, for example `met.winter.storm`. The data names no person and no place.

Each function is a plain function with no clock, no network and no file.

## The records

| Record | What it tells |
| --- | --- |
| `SUPPLY_PARTS` | The reference parts: the public supplies that a case can stop, for example `power.grid` and `water.main`. Each one is a failure domain of many stacks. |
| `Source` | A public page or dataset: its URL, its publisher, its license, the date of its last change and the date of the read. |
| `Claim` | The reason for a cut: a source that tells that the case can stop the part, or the definition of the case. The text is in own words, not a quote. |
| `DurationLaw` | A survival curve of the duration for each region of its source, with its fit. |
| `NoLaw` | No law is read yet. The cut has no curve, so its draws are no read. |
| `Hazard` | A case: its code, its name, its cuts and the sources that the dataset examined for it. |

## The rules of the data

1. A cut is in a case only when a source names it, or when the case is the stop of the part by definition.
2. A supply with no cut in a case is no read, not a pass. `supplyState` tells it.
3. Each cut has a law with its source, its license and its fit, or an explicit no read.
4. A regional law covers each region of its source, not only one chosen region. The region of the user is input data.
5. The fits come from `@mark1russell7/rigor-statistics`. The fetches of a source go through `polite-crawler`.

`checkHazards` is the gate of the rules. It refuses a law with no source or no license, and a law with no curve for a region of its source. It gives a warning for each cut with no law.

## A first look

```ts
import { HAZARD_LIST, hazardCase, hazardOf, supplyState } from "@mark1russell7/stack-hazards";

const storm = hazardOf(HAZARD_LIST, "met.winter.storm");
if (storm !== undefined) {
  // The values of CaseCuts, for a stack with its own id of the grid.
  const cuts = hazardCase(HAZARD_LIST, storm, { parts: { "power.grid": ["home-power"] } });
  console.log(cuts.cuts.map((cut) => cut.part)); // ["home-power", "phone.network", "road.local"]
  console.log(supplyState(storm, "water.main")); // { state: "no-read" }
}
```

A part of a stack that needs a public supply names a reference id in its needs. Or the option `parts` maps each reference id to the ids of the stack. An empty list tells that the stack does not have the supply.

## The sources

The data of 0.1.0 comes from the hazard pages of FEMA (Ready.gov) and of the National Weather Service. Each is a work of the United States federal government, in the public domain. The record of each source has the page of its terms of reuse. No source with a law of a duration is read yet, so each cut has no law.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-hazards` | The records, the reference data, the gate and `hazardCase`. |
