# @mark1russell7/stack-hazards

Hazard cases as reference data. Each case tells the public supplies that it can stop, and the source of each claim. Each cut has a law of the duration of the stop, or no read.

It is an add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). It gives the values of `CaseCuts` of the core, and [`@mark1russell7/stack-endurance`](../stack-endurance/README.md) calculates with them. The cases have generic names and codes of an alert taxonomy, for example `met.winter.storm`. The data names no person and no place.

Each function is a plain function with no clock, no network and no file.

## The records

| Record | What it tells |
| --- | --- |
| `SUPPLY_PARTS` | The reference parts: the public supplies that a case can stop, for example `power.grid` and `water.main`. Each one is a failure domain of many stacks. |
| `Source` | A public page or dataset: its URL, its publisher, its license, the date of its last change and the date of the read. |
| `Claim` | The reason for a cut: a source that tells that the case can stop the part, or the definition of the case. The text is in own words, not a quote. A claim of a source has a basis. |
| `ClaimBasis` | The basis of a claim of a source. `told`: the source tells the effect as a fact of past events or of physics. `assessed`: the source assesses a risk or a threat. |
| `DurationLaw` | A survival curve of the duration for each region of its source, with its fit. |
| `NoLaw` | No law is read yet. The cut has no curve, so its draws are no read. |
| `Hazard` | A case: its code, its name, its cuts and the sources that the dataset examined for it. |

## The rules of the data

1. A cut is in a case only when a source names it, or when the case is the stop of the part by definition.
2. A supply with no cut in a case is no read, not a pass. `supplyState` tells it.
3. Each cut has a law with its source, its license and its fit, or an explicit no read.
4. Each claim of a source has a basis of `CLAIM_BASES`. A claim of the definition has no basis, because the definition is its basis.
5. A regional law covers each region of its source, not only one chosen region. The region of the user is input data.
6. The fits come from `@mark1russell7/rigor-statistics`. The fetches of a source go through `polite-crawler`.

`checkHazards` is the gate of the rules. It refuses a law with no source or no license, and a law with no curve for a region of its source. It gives a warning for each cut with no law.

The gate refuses a claim of a source with no basis or with a basis that is not in `CLAIM_BASES`. It also refuses a claim of the definition with a basis. Each of these faults has the code `hazards-source`.

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

## Told effects and assessed risks

A told claim and an assessed claim are not equal. A flood washes bridges away: the page on floods tells this as a fact. The advisory AA24-038A assesses a threat: state actors can disrupt four sectors in a conflict.

With the option `assessed: "drop"`, `hazardCase` uses only the told claims and the claims of the definition. A cut with no other claim is not in the output. With no option, or with `assessed: "keep"`, the output has each cut.

```ts
const war = hazardOf(HAZARD_LIST, "security.armed-conflict");
if (war !== undefined) {
  console.log(hazardCase(HAZARD_LIST, war).cuts.length); // 5
  console.log(hazardCase(HAZARD_LIST, war, { assessed: "drop" }).cuts.length); // 0
}
```

Only three sources have assessed claims: the DHS framework for AI, the CISA page on the electromagnetic pulse and the advisory AA24-038A. The CISA page tells only a potential of damage from an attack. Each other claim of a source is told.

## The sources

The claims of the cases of 0.1.0 come from the hazard pages of FEMA (Ready.gov) and of the National Weather Service. Each is a work of the United States federal government, in the public domain. The record of each source has the page of its terms of reuse.

The law of the grid cut of a power outage comes from EAGLE-I of Oak Ridge National Laboratory (CC BY 4.0, DOI `10.6084/m9.figshare.24237376`). It has one curve for each state, the District of Columbia, Puerto Rico and the US Virgin Islands. The curves are a derived work.

This law is for all causes. The grid cut of each storm case has a law of its own, from the outages that start in a storm event of the case. The law has a source of its own. Its regions are the states with 30 such outages or more. Each other cut has no law.

## The catastrophic cases

Since 0.1.1, the list also has 12 catastrophic cases. The claims of these cases come from pages of FEMA (Ready.gov), of CDC, of CISA and of the Department of Homeland Security. Each is a work of the United States federal government, in the public domain. The advisory AA24-038A also has foreign partners, so its claims are facts in own words, not quotes.

| Code | Case | The sources of its cuts |
| --- | --- | --- |
| `civic.ai-collapse` | Collapse driven by AI | The DHS framework for AI in critical infrastructure (2024) |
| `security.nuclear-war` | Nuclear war | The CISA page on the electromagnetic pulse, the Ready.gov page on radiation emergencies |
| `cbrne.nuclear-detonation` | Nuclear detonation | The Ready.gov page on radiation emergencies |
| `health.outbreak.pandemic` | Severe pandemic | No cut: 3 sources read, none names a cut |
| `infra.power.grid-collapse` | Long collapse of the power grid | The definition, and the Ready.gov page on power outages |
| `cyber.infrastructure-attack` | Cyberattack on the infrastructure | The Ready.gov page on cybersecurity |
| `infra.supply-chain.food` | Failure of the food supply | The definition |
| `civic.economy.collapse` | Financial collapse | The definition, and the Ready.gov page on financial preparedness |
| `security.civil-unrest` | Civil unrest | No cut: 3 sources read, none names a cut |
| `security.armed-conflict` | War | The CISA advisory AA24-038A (2024): the energy, communications, transportation, and water and wastewater sectors |
| `cbrne.emp` | Electromagnetic pulse | The CISA page on the electromagnetic pulse |
| `geo.space-weather.geomagnetic-storm` | Solar storm | The Ready.gov page on space weather |

- A catastrophic case with no cut is a gap, and each of its supplies is no read. For each of these cases, the dataset read sources, and none of them names a cut. For the severe pandemic, the guidelines of CDC name the closure of schools, child care, workplaces and mass gatherings. These are not public supplies. For civil unrest, Ready.gov has no page, and the pages on mass gatherings and on physical security name no cut. The text of FEMA CPG 201 does not have the words civil, riot or unrest.
- No cut of these cases has a law of its duration. No source read gives a law, and a number from no source is not a law. Each cut has a no read with its reason:

| No read | Its cuts | The reason |
| --- | --- | --- |
| `NO_COLLAPSE_LAW` | The grid cut of a long collapse of the grid | The event summaries of DOE tell of one such collapse: Puerto Rico after Hurricane Maria in 2017. One event gives no law. |
| `NO_CYBER_LAW` | The grid cut of a cyberattack | The CISA alert IR-ALERT-H-16-056-01 tells of one grid outage from a cyberattack, in Ukraine in 2015, with no duration. |
| `NO_GEOMAGNETIC_LAW` | The grid cut of a solar storm | The page of NOAA SWPC names three blackouts from space weather. Only one has a duration: 9 hours in Canada in 1989. |
| `NO_FOLLOW_LAW` | The cuts that follow the stop of the grid in a collapse or a solar storm | The grid cut of the case has no law, and no source read gives a duration of its own. |
| `NO_EVENT_LAW` | Each other cut | No source read gives a duration of the cut or a record of its events. |

- The law of EAGLE-I comes from usual outages, so it does not tell the duration of a long collapse of the grid. The early counts of DOE for Puerto Rico are estimates from the load, not counts of customers.
- The OE-417 summaries of DOE have the outages of each cause, cyber events included. Their site did not answer the read of 2026-11-22, so the dataset does not use them yet.

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
