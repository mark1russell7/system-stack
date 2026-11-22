# @mark1russell7/stack-hazards

Hazard cases as reference data. Each case tells the public supplies that it can stop, and the source of each claim. Each cut has a law of the duration of the stop, or no read.

It is an add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). It gives the values of `CaseCuts` of the core, and [`@mark1russell7/stack-endurance`](../stack-endurance/README.md) calculates with them. The cases have generic names and codes of an alert taxonomy, for example `met.winter.storm`. The data names no person and no place.

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

The claims of 0.1.0 come from the hazard pages of FEMA (Ready.gov) and of the National Weather Service. Each is a work of the United States federal government, in the public domain. The record of each source has the page of its terms of reuse.

The law of the grid cut of a power outage comes from EAGLE-I of Oak Ridge National Laboratory (CC BY 4.0, DOI `10.6084/m9.figshare.24237376`). It has one curve for each state, the District of Columbia, Puerto Rico and the US Virgin Islands. The curves are a derived work. The law is for all causes, so the grid cuts of the storm cases have no law yet. Each other cut has no law.

## The laws from outage records

These functions make a law of a duration from the records of a source of outages. They do no fetch.

| Function | What it does |
| --- | --- |
| `outageReader(options)` | It reads the counts of the customers out of power in each area at each time of the collection. It gives the events and a tally. |
| `eagleLine(line)`, `eagleCustomers(text)`, `eagleRegion(area)` | They read a line of an outage file of EAGLE-I, the file of the customers of each county, and the state of a county. |
| `outageCurves(events, region)` | It gives the Kaplan-Meier curve of the durations of each region, with its counts and its median. |
| `survivalOf(curve)` | It gives a Kaplan-Meier curve in the form of the core, read at the days of `LAW_DAYS`, from 15 minutes to 90 days. |

- An event is a run of the times of an area with a count at or above the threshold of the area. The threshold is a share of the customers of the area.
- A gap of the collection, or the end of the data, censors an event. A run that starts at the start of the data or after a gap is not an event.
- A line of an area with no count stops the observation of that area. It censors an open event, and a run at the next time of the area is not an event.
- The order of the areas is free. A file in the order of the counties and a file in the order of the times give the same events.
- An open tail is a curve that does not get to 0. Its last chance falls to 0 at two times the largest observed time.

EAGLE-I is the dataset of the outages of each county of the United States from Oak Ridge National Laboratory. Its license is CC BY 4.0. A curve from it is a derived work, and it keeps the attribution of the source. The dataset does not reliably have outages of less than 15 minutes.

The workflow `hazards-fit` of the repository makes the curves of EAGLE-I in CI. The script `scripts/eaglei-fit.ts` reads each file in range requests through `polite-crawler` and examines its MD5. The output is the artifact `eaglei-laws`. Then the script `scripts/eaglei-law.ts` makes the module `src/eaglei-law.ts` from the artifact. A state with fewer than 30 events gets no curve. The package on npm does not have the scripts.

The fit job also reads the details files of NOAA Storm Events and the zone-county file of the National Weather Service. Each is in the public domain. An outage is in a case when a storm event of the case covers its county at its start. The window starts 1 hour before the event and ends 3 hours after it. The table `STORM_CLASSES` gives the event types of each case. The match is in time and place only, so it does not prove the cause of an outage.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-hazards` | The records, the reference data, the gate and `hazardCase`. |
