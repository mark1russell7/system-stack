# @mark1russell7/stack-hazards

Hazard cases as reference data. Each case tells the public supplies that it can stop, and the source of each claim. Each cut has a law of the duration of the stop, or no read.

It is an add-on of [`@mark1russell7/system-stack`](../system-stack/README.md). It gives the values of `CaseCuts` of the core, and [`@mark1russell7/stack-endurance`](../stack-endurance/README.md) calculates with them. The cases have generic names and codes of an alert taxonomy, for example `met.winter.storm`. The data names no person and no place.

Each function is a plain function with no clock, no network and no file.

## The records

| Record | What it tells |
| --- | --- |
| `SUPPLY_PARTS` | The reference parts: the public supplies that a case can stop, for example `power.grid` and `water.main`. Each one is a failure domain of many stacks. |
| `HazardSource` | A public page or dataset. It is the `Source` record of [`@mark1russell7/guidebook`](https://github.com/mark1russell7/guidebook), with the regions of the source. |
| `Claim` | The reason for a cut: a source that tells that the case can stop the part, or the definition of the case. The text is in own words, not a quote. A claim of a source has a basis. |
| `ClaimBasis` | The basis of a claim of a source. `told`: what the event does when it happens. `assessed`: a judgment about the threat itself. |
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

`checkHazards` is the gate of the rules. The fields of each source go through `checkSources`, the source gate of the guidebook. It refuses a law with no source or no license, and a law with no curve for a region of its source. It gives a warning for each cut with no law.

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

The option `region` gives the region of the user: one region, or one region for each scheme. Each law reads the region with its scheme. The laws of EAGLE-I have the scheme `us-state-fips`, and the law of a physical attack has the scheme `us-nation` with the code `US`. A law with no region of its scheme gives a cut with no curve, which is no read.

```ts
const attack = hazardOf(HAZARD_LIST, "infra.power.physical-attack");
if (attack !== undefined) {
  // One list of regions: the state laws and the law of the nation in one call.
  const region = [
    { scheme: "us-state-fips", code: "37" },
    { scheme: "us-nation", code: "US" },
  ];
  console.log(hazardCase(HAZARD_LIST, attack, { region }).cuts[0]?.duration !== undefined); // true
}
```

A part of a stack that needs a public supply names a reference id in its needs. Or the option `parts` maps each reference id to the ids of the stack. An empty list tells that the stack does not have the supply.

## Told effects and assessed risks

A told claim and an assessed claim are not equal. The axis is the object of the claim: the effect of the event, or the threat.

- `told`: the source tells what the event does when it happens, as a fact of past events or of physics. A flood washes bridges away.
- `assessed`: the source gives a judgment about the threat itself: the intent of an actor, a prepositioning, or a chance. The advisory AA24-038A assesses that state actors prepare to disrupt four sectors in a conflict.

A source that hedges an effect, for example with the word "potential", is assessed. The record does not make a hedge into a fact.

With the option `assessed: "drop"`, a cut keeps its told claims, its claims of the definition and its law. Its source drops the URLs of the assessed claims.

A cut with only assessed claims stays in the case with no `duration` and with the sources of its claims. Thus its draws are no read in the shortfall, not 0 user-days. A case with no cut stops no supply, and that is a false pass. `supplyState` takes the same option and gives the same cut.

```ts
const war = hazardOf(HAZARD_LIST, "security.armed-conflict");
if (war !== undefined) {
  const cuts = hazardCase(HAZARD_LIST, war, { assessed: "drop" }).cuts;
  console.log(cuts.length); // 5
  console.log(cuts.filter((cut) => cut.duration === undefined).length); // 5: each cut is no read
}
```

With no option, or with `assessed: "keep"`, the output is the same as before the option.

Only three sources have assessed claims: the DHS framework for AI, the CISA page on the electromagnetic pulse and the advisory AA24-038A. The CISA page tells only a potential of damage from an attack. Each other claim of a source is told.

## The sources

The format of the list is `hazards/2`. Each source is the source record of `@mark1russell7/guidebook`, so each package that cites a source has one source gate. The table `sources` keeps each source by its id, and the field `id` of each source is its key.

| Field | What it tells |
| --- | --- |
| `id` | The id of the source. It is the key of the source in the table `sources`. |
| `title` | A short name of the source. |
| `url` | The HTTPS address of the page or the dataset. |
| `by` | The organization that publishes the source. A list of hazards must have it, because it is the credit of a CC BY source. |
| `license` | A license of the guidebook, for example `us-public-domain` or `cc-by-4.0`. |
| `terms` | The HTTPS address of the page that tells the terms of the reuse. A list of hazards must have it, because it is the evidence of the license. |
| `updated` | The date that the source shows as its last change. It is not after the date `checked`. |
| `checked` | The date of the read of the source. |
| `regions` | The regions that the source covers. A source of a law of a duration must have its regions. This field is the extension of stack-hazards. |

The gate gives the code `hazards-license` for a license that the guidebook does not know. It also gives this code for a license that does not permit a summary, because the claims are summaries in own words. The license of the source of a law or a table of priors must permit a fact. Each other fault of the source gate has the code `hazards-source`, and its message ends with the code of the guidebook.

The list has three rules that the source gate of the guidebook does not have at this time. A source has an HTTPS address and a publisher (`by`), else the code is `hazards-source`. A source has an HTTPS page of its terms, else the code is `hazards-license`. A source with a fault of its license gives one finding: its laws and tables of priors give no second finding.

In the format `hazards/1`, a source had the fields `name`, `publisher`, `read` and a license with a name and a URL. The format `hazards/2` has the fields `title`, `by`, `checked`, `license` and `terms` in their place.

The claims of the cases of 0.1.0 come from the hazard pages of FEMA (Ready.gov) and of the National Weather Service. Each is a work of the United States federal government, in the public domain. The record of each source has the page of its terms of reuse.

The law of the grid cut of a power outage comes from EAGLE-I of Oak Ridge National Laboratory (CC BY 4.0, DOI `10.6084/m9.figshare.24237376`). It has one curve for each state, the District of Columbia, Puerto Rico and the US Virgin Islands. The curves are a derived work.

This law is for all causes. The grid cut of each storm case has a law of its own, from the outages that start in a storm event of the case. The law has a source of its own. Its regions are the states with 30 such outages or more. The grid cut of a physical attack has the law of the OE-417 summaries. Each other cut has no law.

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
| `NO_COLLAPSE_LAW` | The grid cut of a long collapse of the grid | The event summaries of DOE tell of one such collapse: Puerto Rico after Hurricane Maria in 2017. The OE-417 summary of 2017 has no row of Puerto Rico. The OE-417 summaries give the last restoration of each event, and their long storms are not a collapse. One event gives no law. |
| `NO_CYBER_LAW` | The grid cut of a cyberattack | The CISA alert IR-ALERT-H-16-056-01 tells of one grid outage from a cyberattack, in Ukraine in 2015, with no duration. Of the 42 cyber events of the OE-417 summaries, one tells of a loss, with an unknown count of customers. Two events give no law. |
| `NO_GEOMAGNETIC_LAW` | The grid cut of a solar storm | The page of NOAA SWPC names three blackouts from space weather. Only one has a duration: 9 hours in Canada in 1989. No type of an event of the OE-417 summaries names a geomagnetic, solar, magnetic or space weather cause. |
| `NO_FOLLOW_LAW` | The cuts that follow the stop of the grid in a collapse or a solar storm | The grid cut of the case has no law, and no source read gives a duration of its own. |
| `NO_EVENT_LAW` | Each other cut | No source read gives a duration of the cut or a record of its events. |

- The law of EAGLE-I comes from usual outages, so it does not tell the duration of a long collapse of the grid. The early counts of DOE for Puerto Rico are estimates from the load, not counts of customers.
- The OE-417 summaries of DOE have the outages of each cause, cyber events included. The site of DOE did not answer the reads of 2026-11-22 and 2026-11-24. The dataset read the archived copies of the summaries of 2000 to 2023 in the Wayback Machine.

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

## The yearly priors from outage records

`HAZARD_LIST` has the table of the yearly priors of each state (`us-state-fips`) from EAGLE-I. The table of each county (`us-county-fips`) is large, so it has its own entry. Add it to the list when the user gives a county:

```ts
const { EAGLEI_COUNTY_PRIORS } = await import("@mark1russell7/stack-hazards/county-priors");
const list = { ...HAZARD_LIST, priors: [EAGLEI_COUNTY_PRIORS, ...(HAZARD_LIST.priors ?? [])] };
```

`hazardPriors(list, { region })` gives the prior of each case for the first region of the option with a table of the case.

- `perYear` is the count of the events of the case in one year in the region. `reach` is the mean share of the customers of the region that an event puts out of power.
- The case `infra.power.outage` counts the outages in no storm case. Each storm case counts the outages that start in a storm event of the case.
- An event starts at 1% of the customers of a county, so a smaller outage is not counted. That makes a rate too low.
- One outage that crosses the line of 1% more than one time counts more than one time. A year with no count of a county is not one of its years. Each of these makes a rate too high. So a rate is not a bound in either direction.
- A region with more than 12 events at one customer in one year (`perYear * reach`) in a case is not in its table. Its prior is no read. The limit is one a month. For the United States as a whole, the utilities report one or two interruptions a year at a customer to EIA. The method is not reliable above the limit, but a true rate can also be above it, for example in Puerto Rico. EIA and the table count in different ways, so the comparison holds only for the order of the number. 31 counties and the states 72 and 78 are not in the tables.
- A region that the table observes with no event of a case has a prior of 0. A region that the table does not observe has no prior: that is no read.
- The place of each prior is the option `place`, for example `hazardPriors(list, { region, place: "home" })`. With no option, the place is the region of the table, for example `us-state-fips:01` after the fall back from a county. `yearShortfall` of stack-endurance finds a prior by its place, so give the place that it reads.
- A county prior of 0 comes before the prior of its state. Many counties have 0 for a rare case, for example a hurricane, and many tornado rates come from one event. A pooled rate of a county and its state is a next step.
- Give a county first and its state next. Then a county with no table of a case gets the prior of its state.

The workflow `hazards-fit` gives the counts in the artifact `eaglei-laws`. The script `scripts/eaglei-priors.ts` makes the modules `src/eaglei-county-priors.ts` and `src/eaglei-state-priors.ts` from them. The header of each module tells the run, the version and the DOI of the dataset, and the options of the fit. The rates are a derived work of EAGLE-I (CC BY 4.0) and of the storm events of NOAA (public domain).

## The law of a physical attack

The OE-417 annual summaries of DOE list the electric disturbance events of each year. They are a work of the United States federal government, in the public domain.

| Entry | What it is |
| --- | --- |
| `OE417_ATTACK_EVENTS` | The 112 events of 2011 to 2023 of a physical attack, vandalism, sabotage or theft, with a loss of customers or load. Each row is as its summary prints it. The summaries of 2000 to 2010 have no such event. |
| `OE417_YEARS` | The counts of each summary: the events, the second rows of an event, the attacks, the kept events, the cyber events and the events from space weather. |
| `OE417_FILES` | The summary of each year: its id at DOE, its address and the archived copy that the dataset read. |
| `oe417IsAttack(type)` | It tells if a type is a proved attack, by the terms `OE417_ATTACK_TERMS` and `OE417_NOT_ATTACK_TERMS`. |
| `oe417Count(text)` | It gives the first number of a count of a summary, or `NaN` for a text with no number. |
| `oe417Hours(event)` | It gives the hours from the start of an event to its restoration, from the local times of the summary. |
| `oe417AttackLaw(events)` | It gives the law of the time for which the customers have no power, with one Kaplan-Meier curve for the nation. |
| `OE417_ATTACK_LAW` | The law of the 70 events with customers: 62 ends of 15 minutes or more and 8 open events. |

The law reads only the events with more than 0 customers. The question of a home is how long its power is off.

- The other 34 events give 0 customers or no count. Some give a count of megawatts that cannot be a loss of load with no customers, for example 9,760 MW in California in 2018. Such a count can be a load or a rating.
- An event of a suspicion, a threat or a possible attack is not in the set. The attack is not proved.
- The 8 open events have a start and no time of the restoration. Each was most likely open when its form was sent. The law reads each one as censored at the longest read duration, 3.5 days. The curve then falls to 0 at 7 days.
- One of the open events is the attack in Moore County, North Carolina, in December 2022, with 45,000 customers.
- The summary of 2023 prints 32 events two times, the second time with no start. The set and the counts read each such event one time.
- The times are local times. An event across a change of the clock can be one hour off.
- The case `infra.power.physical-attack` uses this law on its grid cut. Its other cuts are the cuts of a power outage, with no law.

The open events change the tail of the law:

| Duration | The share of the events that last longer | The share with the open events left out |
| --- | --- | --- |
| 1 hour | 81% | 79% |
| 4 hours | 36% | 27% |
| 12 hours | 20% | 10% |
| 1 day | 14% | 3% |
| 3 days | 13% | 2% |

To leave the open events out gives a lower curve, and a lower curve makes a plan too small.

The reader of the archived files is not in this repository yet. Each row names the year of its summary, and `OE417_FILES` gives the archived copy of each year. Thus a reader can check each row and each count.

## The entries

| Entry | What it has |
| --- | --- |
| `@mark1russell7/stack-hazards` | The records, the reference data, the gate and `hazardCase`. |
