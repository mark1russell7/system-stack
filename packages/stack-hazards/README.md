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
| `Follows` | The cause of a dependent cut: the cut of another part in the same case, with an onset and a recovery. Since 0.7.0. |
| `CitedSpan` | A cited span of a time: its two ends, a unit of `SPAN_UNITS`, a basis of `SPAN_BASES`, a text and the claims of its sources. Since 0.7.0. |
| `Hazard` | A case: its code, its name, its cuts and the sources that the dataset examined for it. |

## The rules of the data

1. A cut is in a case only when a source names it, or when the case is the stop of the part by definition.
2. A supply with no cut in a case is no read, not a pass. `supplyState` tells it.
3. Each cut has a law with its source, its license and its fit, or an explicit no read.
4. Each claim of a source has a basis of `CLAIM_BASES`. A claim of the definition has no basis, because the definition is its basis.
5. A regional law covers each region of its source, not only one chosen region. The region of the user is input data.
6. The fits come from `@mark1russell7/rigor-statistics`. The fetches of a source go through `polite-crawler`.

`checkHazards` is the gate of the rules. The fields of each source go through `checkSources`, the source gate of the guidebook. With the option `at`, the gate also examines the check date of each source. A check after `at` is an error. A check older than `maxAgeDays` (365 by default) is a warning.

The gate refuses a law with no source or no license, and a law with no curve for a region of its source. It gives a warning for each cut with no law. Since 0.7.0, a cut that follows a cause with a law gets no warning.

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

## The cuts that follow another cut

Since 0.7.0, a cut can have the field `follows`: a stop of another part of the same case causes it. Before 0.7.0, such a cut had no curve. A caller that dropped it then counted the water cut only for the time of the grid cut, which is too short.

| Field of `follows` | What it tells |
| --- | --- |
| `part` | The reference part of the cause cut, for example `power.grid`. |
| `onset` | The time from the start of the cause to the start of the dependent cut, as a `CitedSpan`. |
| `recovery` | The time from the end of the cause to the end of the dependent cut, as a `CitedSpan`. |

The dependent cut occurs only when the cause lasts longer than the onset. Then its duration is the time of the cause after the onset, plus the recovery. `followCurve(cause, onset, recovery)` gives the curve in days:

- The cause curve is shifted down by the onset and then up by the recovery.
- The law has a mass at 0: the chance that the cause ends at or before the onset. A curve of the core has no step, so the curve falls linearly from [0, 1] to its next point. That part is above the law, thus an upper bound. With an onset of 0, the curve is exact.
- A span has a basis. With `range`, the sources give the range of the value. With `minimum`, they give a least value, for example a rule minimum.
- A `range` onset takes its low end, and a `range` recovery takes its high end. Each one is an upper bound, for its span.
- A `minimum` term takes its low end, because the real value is at least that value. A longer onset gives a shorter cut, so a minimum onset is an upper bound. A minimum recovery is a lower bound.
- A missing onset is 0, which can only make the cut longer: an upper bound. A missing recovery is 0, which can only make the cut shorter: a lower bound.

`hazardCase` finds the cause by its reference part, before the option `parts`. When the cause has a curve for the region of the user, the dependent cut gets the shifted curve and the field `follows` (`FollowRead`):

| Field | What it tells |
| --- | --- |
| `part` | The reference part of the cause. |
| `onset`, `recovery` | Each term (`FollowTerm`): its days, `cited`, its side (`upper` or `lower`) and a text, for example "recovery not cited: 0, a lower bound". |
| `bound` | `upper` when each term is an upper bound and the cause is a law or an upper bound. Else `none`: the curve is not a bound of the days of the cut. |

Since 0.7.4, the types of `follows` are the types `CutFollows`, `FollowTerm` and `FollowSide` of the core. The schema of stack-endurance reads the field, so a case of `hazardCase` goes through `parseEndurance` as JSON.

Since 0.7.2, each cut with a curve also has the field `bound` of the core (`CutBound`). A cut with a law of its own has `law`. A dependent cut has the `bound` of `follows`: `upper` or `none`. Each onset is an upper bound, so no cut gets `lower`. A reader of the core record alone, for example the shortfall of stack-endurance, can thus tell a law from a curve that is no bound.

The source of the cut is the source of the cause curve, and then the sources of the claims of its terms. A cause with no curve gives the dependent cut no `duration` and no field `follows`, as before 0.7.0. A chain of cuts is permitted.

The gate gives `hazards-follows` for a cause that is not a cut of the case, or a chain that comes back to the cut. It gives the same code for a cut with `follows` and a law of its own. It gives the same code for a span with wrong ends, no text, no claim, or a claim of the definition. It also gives it for a unit that is not in `SPAN_UNITS` or a basis that is not in `SPAN_BASES`.

Three cases have a stop of the grid: a power outage, a physical attack and a long collapse of the grid. In each case, the other cuts of the stop follow the grid cut. No public source gives the time of the storage of water or of the backup fuel, so no cut has an onset.

| Cut | Onset | Recovery | Bound |
| --- | --- | --- | --- |
| `water.main` | Not cited: 0, an upper bound | `WATER_RECOVERY`: a rule minimum of 24 to 48 hours, the low end, a lower bound | `none` |
| `phone.network`, `road.local`, `food.retail`, `fuel.retail`, `cash.retail` | Not cited: 0, an upper bound | Not cited: 0, a lower bound | `none` |

`WATER_RECOVERY` is a rule minimum, not a measured time. It is the time of the samples that end the boil order after a loss of pressure:

- Texas, 30 TAC 290.46(q)(6)(A)(v): the boil water notice ends only after special samples are negative for coliform organisms. That is one round.
- Illinois, 35 Ill. Adm. Code 602.310(c): two sets of samples at least 24 hours apart verify the disinfection. 35 Ill. Adm. Code 604.135(c)(3) gives a boil order when the pressure falls below 20 psi.
- EPA 815-B-24-008 (January 2024): the results of the Colisure method can be read after an incubation of 24 hours.
- Thus the low end is 24 hours: one round with its incubation. The high end is 48 hours: two sets 24 hours apart, with the incubation of the second set.

The real recovery is at least the rule minimum of its state, and it can be longer. So the span is not a range of the real value, and its basis is `minimum`. The water main gets the cause curve plus 24 hours. The missing onset (0) is an upper side and the minimum recovery a lower side, so the curve is no bound of the days. Its bound is `none`. The other five cuts have no cited onset and no cited recovery. Onset 0 is an upper side and recovery 0 a lower side, so their bound is `none` too.

The text of a state rule has no copyright: the government edicts doctrine (Georgia v. Public.Resource.Org, 2020). Thus the license of each state rule is `public-domain`, not `us-public-domain`, which is only for a federal work.

```ts
const outage = hazardOf(HAZARD_LIST, "infra.power.outage");
if (outage !== undefined) {
  const cuts = hazardCase(HAZARD_LIST, outage, { region: { scheme: "us-state-fips", code: "48" } }).cuts;
  const water = cuts.find((cut) => cut.part === "water.main");
  console.log(water?.follows?.recovery.says); // "recovery cited as a rule minimum: the low end, 24 hours, a lower bound"
  console.log(water?.follows?.bound); // "none"
}
```

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

The list gives three rules to the source gate of the guidebook, as its options `require: ["by", "terms"]` and `https: true`. A source has an HTTPS address, a publisher (`by`) and an HTTPS page of its terms, else the code is `hazards-source`. Before 0.4.0, a fault of the page of the terms had the code `hazards-license`. A source with a fault of its license gives one finding: its laws and tables of priors give no second finding.

In the format `hazards/1`, a source had the fields `name`, `publisher`, `read` and a license with a name and a URL. The format `hazards/2` has the fields `title`, `by`, `checked`, `license` and `terms` in their place.

The claims of the cases of 0.1.0 come from the hazard pages of FEMA (Ready.gov) and of the National Weather Service. Each is a work of the United States federal government, in the public domain. The record of each source has the page of its terms of reuse.

The law of the grid cut of a power outage comes from EAGLE-I of Oak Ridge National Laboratory (CC BY 4.0, DOI `10.6084/m9.figshare.24237376`). It has one curve for each state, the District of Columbia, Puerto Rico and the US Virgin Islands. The curves are a derived work.

This law is for all causes. The grid cut of each storm case has a law of its own, from the outages that start in a storm event of the case. The law has a source of its own. Its regions are the states with 30 such outages or more. The grid cut of a physical attack has the law of the OE-417 summaries. Each other cut has no law. Since 0.7.0, the cuts that follow a grid cut with a law get its curve with the shift of their terms.

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
| `NO_FOLLOW_LAW` | The cuts that follow the stop of the grid in a collapse or a solar storm | The grid cut of the case has no law, and no source read gives a duration of its own. Since 0.7.0, the cuts of a collapse have `follows`, and they get a curve when the grid cut gets a law. |
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

The fit record gives the outages in a storm case and the outages in two storm cases or more (`priors.overlap`). Its field `byState` gives the two counts for each state (`us-state-fips`). Thus a reader can compare the share of each state with the share of the nation.

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
- A region with more than 12 events at one customer in one year (`perYear * reach`) in a case is not in its table. Its prior is no read. The limit is one a month. For the United States as a whole, the utilities report one or two interruptions a year at a customer to EIA. The method is not reliable above the limit, but a true rate can also be above it, for example in Puerto Rico. EIA and the table count in different ways, so the comparison holds only for the order of the number.
- Five counties of Puerto Rico (72021, 72025, 72031, 72113, 72127) are not in the tables. The three counties of the U.S. Virgin Islands and the states 72 and 78 are also not in them.
- In the file of the customers of EAGLE-I, 661 counties have a count out of power above their customers. For 340 of them, that occurs on 4 or more different UTC days. The fit of the tables uses the larger of the file and the count that the county reached on 4 different days (the option `raise` of `scripts/eaglei-fit.ts`). Each count out is a count of customers, so that count is a lower bound of the customers. Before 0.4.1, 31 counties and the states 72 and 78 were not in the tables.
- A feed that is stuck for one day does not raise a county. A feed that is stuck across 4 UTC days (a little more than 48 hours) raises it. One bad count on each of 4 days also raises it. 168 raised counties have 4 to 7 such days. Of them, 4 get more than two times their customers of the file: 16025, 20085, 48089 and 48269.
- The rate of a county is pooled toward the counties of its state (`pooledRates`). The counties of a state in a case have a gamma law of their rates. The rate of a county is the mean of its rate after its events in its years. Thus a county with few events gets a rate near the mean of its state. A county with no event does not get a rate of 0.
- A state with no event in a case gets its pooled rate toward the states with events. A county with no event gets the plain mean of the reach of the counties of its state with events. In a state with no event, it gets the plain mean of the reach of all counties with events in the case. Before 0.6.0, it got the mean reach of the events of its state. That mean gives more weight to the counties with many events, and their events reach a smaller share of their customers.
- A county with no event in any case is not observed (`withoutSilentAreas`), so the prior of its state applies to it. The fit of 2026-02-25 has 76 such counties, but the laws of the states expect 5.4 of them. Thus most of them are counties that the files do not see, for example a county with the counts of one small utility. Many of them have a largest count out of 0 to 300 customers in 7 to 12 years. A pooled rate made a low rate from such a gap: 0.2% to 23% of the mean of the state. No test of one county can tell a gap from a low rate.

  The holdout cannot score such a county, because a county with no event has no event in the two halves. A test holds the gate: the laws expect at most 10% of the silent counties.
- The rate of a state is pooled toward the states of the nation (`regionCounts`, `regionObservation` and `pooledRates` with one group). The states in a case have a gamma law of their rates.
  The events of a state are the events of its counties. Its years are the plain mean of the years of its counties. Thus a state with no event of a case gets a rate near 0, not 0.

  Before 0.6.4, the table of the states kept its raw rates. Then 35 priors of states were 0, for example 29 states in the case `met.tropical.hurricane`. A region that the table does not observe has no prior: that is no read.
- The place of each prior is the option `place`, for example `hazardPriors(list, { region, place: "home" })`. With no option, the place is the region of the table, for example `us-state-fips:01` after the fall back from a county. `yearShortfall` of stack-endurance finds a prior by its place, so give the place that it reads.
- Each prior also has the field `region`: the scheme and the code of the region of the table that gives its rate. The option `place` does not change it. A page can thus tell "the rate of your state, not of your county" with one call.
- The gate refuses two tables with the same scheme, case and region (`priorTableOverlaps`). `hazardPriors` takes the first table, so the second table gives no prior there.
- `EAGLEI_COUNTY_POOLING` of the entry `county-priors` has the law of each state in each case, and a holdout. The holdout puts each event of a county in one of two halves, each with the chance 1/2 (seed 20261124). The rates come from one half, and the other half scores them. Each score is the mean of 5 such splits.

  In each case, the pooled rates have a higher Poisson log-likelihood than one rate for each state. On the counties with events in the fit half, they also have a higher log-likelihood than the raw rates. They also have the smallest squared error. A test holds this gate.

  The holdout also scores the reach of the counties with no event in the fit half and events in the score half. In 5 of the 6 cases, the plain mean of the counties has less bias than the mean over the events of the state. In the case `met.heat.extreme`, the two biases are near 0 (0.006 and 0.005). The mean absolute errors are equal to within 3%. A test holds this gate. In each case, the error of the plain mean is at most 5% above the other error. Its sum of the absolute bias over the cases is smaller. The 8 counties above the limit are in the laws and in the holdout, but not in the table.
- `EAGLEI_STATE_POOLING` has the law of the states in each case, and a holdout of the same kind, with each state as one area.

  In each case, the pooled score is finite and higher than the score of one rate for the nation. The raw rates lose a state in 4 cases: it has no event in the fit half and events in the score half. Thus their score is `-Infinity`.

  On the states with events in the fit half, the pooled score is at most 0.3% under the raw score. The pooled squared error is lower in 4 cases, and at most 2.1% higher in the other 2 cases. A test holds the gate with the limits 1% and 5%.
- Each pooling also has a holdout over time (`time`, since 0.6.8). The rates come from the early years (2014 to 2019), and the later years (2020 to 2025) score them.
  The fit record has the events of each case in each county in each year (`priors.yearly`). A record from before 0.6.8 has no such counts, so its modules have no `time`.

  The two holdouts have different limits:

  - The thinning holdout puts the events of one storm in the two halves. So the fit half knows the score half, and pooled versus raw looks too good.
  - The thinning holdout fits from half of the events of each county. The holdout over time fits from all the events of the early years.
  - The holdout over time scores only the counties with years in the two parts: 2971 counties and 52 states in the fit of 2026-02-25. It does not score the reach.
  - The rates go up over time: the later years have 1.07 to 3.87 times the rate of the early years. Some of this change can come from the growth of the coverage of EAGLE-I.
    So the holdout over time also tests a change of the rates, not only the noise of the counts.

  On the counties with events in the early years, the pooled score is above the raw score in 5 of the 6 cases. In the case `met.heat.extreme`, it is 8.3% under the raw score. That case has the largest change of the rate.
  On these counties, the pooled score is above the score of one rate for each state in each case.
  On all the counties, one rate for each state scores above the pooled rates in 4 cases, by at most 7.2%. A county with no event in the early years gets a low pooled rate, and some such counties have events later.

  For the states, the pooled score is above the raw score in 5 of the 6 cases. In the other case, it is at most 0.1% under the raw score. The pooled squared error is at most 1.2% above the raw error.

  A test holds the gate of the holdout over time. Each limit is the next multiple of 5% above the worst ratio of the fit of 2026-02-25. The fit gives the same numbers for the same version of the dataset, so the margin is for a new version.
- Give a county first and its state next. Then a county with no table of a case gets the prior of its state.
- The list also has the table `OE417_NATION_PRIORS` of the scheme `us-nation`. It gives the prior of a physical attack, in the section of its law. Give the region `{ scheme: "us-nation", code: "US" }` last, for this prior.

The workflow `hazards-fit` gives the counts in the artifact `eaglei-laws`. The script `scripts/eaglei-priors.ts` makes the modules `src/eaglei-county-priors.ts` and `src/eaglei-state-priors.ts` from them. The county module also has `EAGLEI_COUNTY_POOLING`, and the state module has `EAGLEI_STATE_POOLING`.

The state module also has `EAGLEI_NATION_CUSTOMERS`, the sum of the customers of each observed county. A county in a state over the limit of the table is also in the sum. The header of each module tells the run, the version and the DOI of the dataset, and the options of the fit. The rates are a derived work of EAGLE-I (CC BY 4.0) and of the storm events of NOAA (public domain).

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
| `oe417LawEvents(events)` | It gives the events that the law reads. The prior counts the same events. |
| `oe417AttackPrior(events, { first, last, customers, note })` | It gives the table of the prior of a physical attack for the nation, from the events of the years `first` to `last`. The method tells only what it calculates, and then the text `note`. |
| `oe417PriorWindow(events, { first, last, level, draws, seed })` | It gives the first year of a prior: the year after the last window to `last` that fails the dispersion test. It also gives the yearly counts and the p value of each window. |
| `OE417_WINDOW_DRAWS`, `OE417_WINDOW_SEED` | The 100000 seeded draws of each test, and their seed. |
| `OE417_LAST_YEAR`, `OE417_COUNTS_FIRST` | The last year of the summaries (2023), and the first year with an event of the law (2011). |
| `OE417_PRIOR_FIRST` | 2015, the first year of the prior. A test calculates it again with `oe417PriorWindow`. |
| `OE417_NATION_PRIORS` | The prior of 2015 to 2023: 66 events in 9 years, with the customers `EAGLEI_NATION_CUSTOMERS`. |
| `oe417SheetRows(year, grid)` | It reads the events of a summary of 2002 to 2023 from the cells of its sheet. It finds the columns by their labels and counts the second rows. |
| `oe417PdfRows(year, text)` | It reads the events of a summary of 2000 or 2001 from its PDF text. The counts are exact. The area and the counts of customers are best effort, and the restoration is `null`. |
| `oe417YearCounts(rows)`, `oe417KeptEvents(rows)` | They give the counts of a summary by the terms of the dataset, and the events that `OE417_ATTACK_EVENTS` holds. |
| `oe417Compare(read, years, events)` | It lists each difference between a read and the dataset. |

The script `scripts/oe417-read.ts` fetches the archived summaries and gives them to these functions. The workflow `oe417-read` starts it in CI with `--check`. The check passes when the read equals `OE417_YEARS` and `OE417_ATTACK_EVENTS`.
To add a new year, give the option `--extra` a JSON file of entries like those of `OE417_FILES`. The input `extra` of the workflow takes the same JSON. The script then lists the new year and its events.

The law reads only the events with more than 0 customers. The question of a home is how long its power is off.

- 8 events with customers are not in the law. 5 are shorter than 15 minutes (14,725 customers, one with 11,479). The restoration of 3 is at their start (2,002 customers).
- The other 34 events give 0 customers or no count. Some give a count of megawatts that cannot be a loss of load with no customers, for example 9,760 MW in California in 2018. Such a count can be a load or a rating.
- An event of a suspicion, a threat or a possible attack is not in the set. The attack is not proved.
- The 8 open events have a start and no time of the restoration. Each was most likely open when its form was sent. The law reads each one as censored at the longest read duration, 3.5 days. The curve then falls to 0 at 7 days.
- One of the open events is the attack in Moore County, North Carolina, in December 2022, with 45,000 customers.
- The summary of 2023 prints 32 events two times, the second time with no start. The set and the counts read each such event one time.
- The times are local times. An event across a change of the clock can be one hour off.
- The case `infra.power.physical-attack` uses this law on its grid cut. Its other cuts are the cuts of a power outage, with no law of their own. Since 0.7.0, they follow the grid cut, so they get its curve.

The prior of a physical attack is one rate for the nation:

- `perYear` is 66 events in the 9 years of 2015 to 2023, 7.3 events in one year.
- `reach` is the mean of the customers of an event (7,481) over the customers of each observed county of EAGLE-I.
- Thus one customer has an event once in approximately 2,800 years (`perYear * reach` is 3.5e-4).
- An event with no count of customers is not in the rate. That makes the rate too low.

The years of the prior come from a rule:

- The counts of the years 2011 to 2023 are 1, 0, 3, 0, 4, 6, 6, 5, 8, 8, 7, 14 and 8. The summaries of 2000 to 2010 list no such event.
- The rule: the years are the longest window to the last year that passes the test, with each shorter window to the last year. The test asks if the yearly counts agree with one rate. It is `dispersionTest` of `@mark1russell7/rigor-statistics` at 5%: the Pearson statistic, with seeded draws given the total.
- The window from 2014 fails the test (the exact p is 0.0447). The window from 2015 passes it (the exact p is 0.3526).
- With 2011 to 2023, the rate is 5.4 events in one year, below each year from 2016 but one. The mean of years that do not agree with one rate is not the rate of the next year.
- A gate calculates the window from the events with `oe417PriorWindow`. A new summary changes the counts. Then the gate moves the window, or it fails until `OE417_PRIOR_FIRST` changes.

The choice is close, but its effect is small. With one more event in 2014, the exact p is 0.086, and the window starts in 2014. With one fewer, the p is 0.020. The rate then changes from 7.33 to 7.1 events in one year, by 3%.

`OE417_LAST_YEAR` is the last year of `OE417_YEARS`, and `OE417_COUNTS_FIRST` is the first year with an event of the law. The prior and the gate use both.

The product rests on few events:

- The largest event (110,000 customers, 2016) is 22% of the customers of the window, and the 3 largest are 42%. The median event has 1,842 customers.
- Without the largest event, the product is 2.7e-4. With a second event of that size, it is 4.3e-4.
- A bootstrap of the 9 yearly sums of the customers gives 1.5e-4 to 6.4e-4 (95%, 10,000 draws, seed 20261124).
- The rate is for the nation. A state or a county can have a higher rate, and the summaries name places in words that are not codes.

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
