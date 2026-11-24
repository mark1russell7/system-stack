import type { Source } from "@mark1russell7/guidebook";
import type { GammaRates } from "@mark1russell7/rigor-statistics";
import type { Part, Survival } from "@mark1russell7/system-stack";

// The model of the hazard cases: the reference parts of the public supplies, the sources, the cuts and the laws of their durations.

/** A date as `YYYY-MM-DD`. */
export type IsoDate = string;

/**
 * The reference parts: the public supplies that a hazard case can stop. Each part is one failure domain of many stacks.
 * A part of a stack that needs a public supply names one of these ids in its needs. Or the option `parts` of `hazardCase` maps the id.
 * The `kind` of each part is the kind of a part of system-stack.
 */
export const SUPPLY_PARTS: readonly Part[] = [
  { id: "power.grid", kind: "power", name: "The power grid" },
  { id: "water.main", kind: "water", name: "The public water main" },
  { id: "sewer.main", kind: "sewer", name: "The public sewer" },
  { id: "gas.main", kind: "gas", name: "The gas main" },
  { id: "phone.network", kind: "phone", name: "The telephone networks, fixed and mobile" },
  { id: "network.access", kind: "network", name: "The access to the internet" },
  { id: "road.local", kind: "road", name: "The local roads and bridges" },
  { id: "fuel.retail", kind: "fuel", name: "The fuel stations" },
  { id: "food.retail", kind: "food", name: "The food shops" },
  { id: "cash.retail", kind: "cash", name: "The banks and the cash machines" },
  { id: "care.local", kind: "care", name: "The hospitals and the pharmacies" },
  { id: "home.dwelling", kind: "dwelling", name: "The home and the things in it" },
];

/** The regions of a source: the scheme of the codes and each code that the source covers. */
export interface Regions {
  /** The scheme of the codes, for example `us-state`. */
  readonly scheme: string;
  readonly codes: readonly string[];
}

/**
 * A source: a public page or a public dataset. It is the source record of `@mark1russell7/guidebook`, with the regions of the source.
 * The field `by` is the organization that publishes the source. The field `checked` is the date of the read of the source.
 * The field `license` is a license of the guidebook, and the field `terms` is the page that tells the terms of the reuse.
 * A list of hazards must have the fields `by` and `terms`. The field `by` is the credit of a CC BY source.
 * The field `terms` is the evidence of the license.
 */
export type HazardSource = Source & {
  /** The organization that publishes the source. */
  readonly by: string;
  /** The HTTPS address of the page that tells the terms of the reuse. */
  readonly terms: string;
  /** The regions that the source covers. A source of a law of a duration must have its regions. */
  readonly regions?: Regions | undefined;
};

/**
 * The bases of a claim of a source, in a fixed order. The axis is the object of the claim: the effect of the event, or the threat.
 *
 * - `told`: the source tells what the event does when it happens, as a fact of past events or of physics.
 *   For example, a flood washes bridges away.
 * - `assessed`: the source gives a judgment about the threat itself: the intent of an actor, a prepositioning, or a chance.
 *   For example, an advisory assesses that state actors prepare to disrupt a sector in a conflict.
 *
 * A source that hedges an effect, for example with the word "potential", is assessed. The record does not make a hedge into a fact.
 */
export const CLAIM_BASES: readonly ["told", "assessed"] = ["told", "assessed"];

/** The basis of a claim of a source: an effect that the source tells, or a risk that the source assesses. */
export type ClaimBasis = (typeof CLAIM_BASES)[number];

/**
 * A claim: the reason to put a cut in a case. A claim is a source that tells that the case can stop the part.
 * Or a claim is the definition of the case, when the case is the stop of the part. The text `says` tells the claim in own words.
 * It is not a quote.
 *
 * A claim of a source has a `basis`. A claim of the definition has no basis: the definition is its basis.
 */
export type Claim =
  | { readonly source: string; readonly basis: ClaimBasis; readonly definition?: never; readonly says: string }
  | { readonly definition: true; readonly source?: never; readonly basis?: never; readonly says: string };

/** The fit of a law of a duration. */
export interface Fit {
  /** The family of the law, for example `lognormal`. */
  readonly family: string;
  /** The method of the fit, for example `maximum likelihood`. The fit comes from `@mark1russell7/rigor-statistics`. */
  readonly method: string;
  /** The count of the events of the fit. */
  readonly count: number;
}

/**
 * A law of the duration of a cut: a survival curve for each region of its source.
 * A regional law covers each region of its source, not only one chosen region. The region of a user is input data.
 */
export interface DurationLaw {
  readonly read: true;
  /** The id of the source of the law. The license of the source must permit a fact, and the source must have regions. */
  readonly source: string;
  readonly fit: Fit;
  /** The scheme of the region codes. It is the scheme of the regions of the source. */
  readonly scheme: string;
  /** The survival curve of the duration in each region, by the code of the region. */
  readonly curves: Readonly<Record<string, Survival>>;
}

/** No law of a duration: no source with a law is read yet. A cut with no law has no curve, so its draws are no read, not a pass. */
export interface NoLaw {
  readonly read: false;
  /** The reason, in plain words. */
  readonly reason: string;
}

/** A cut of a hazard case: a reference part that the case can stop, the claims of the cut and the law of the duration. */
export interface HazardCut {
  /** The `id` of a reference part of `SUPPLY_PARTS`. */
  readonly part: string;
  /** The printed name of the cut, for example "No power from the grid". */
  readonly title: string;
  /** The claims of the cut. A cut has one claim or more. */
  readonly claims: readonly Claim[];
  readonly duration: DurationLaw | NoLaw;
}

/**
 * A hazard case: an event that can stop some public supplies at the same time.
 * A supply with no cut in the case is no read: no source that the dataset read tells that the case can stop it. It is not a pass.
 */
export interface Hazard {
  /** The code of the case, a code of the alert taxonomy, for example `met.winter.storm`. */
  readonly case: string;
  /** The printed name of the case. */
  readonly title: string;
  readonly cuts: readonly HazardCut[];
  /** The ids of the sources that the dataset read for the case, also the sources that name no cut. */
  readonly examined: readonly string[];
}

/**
 * A table of the yearly priors of some cases from one source, in one scheme of regions.
 * The rate of a case in a region is `[perYear, reach]`. `perYear` is the events in one year in the region.
 * `reach` is the mean share of the region that one event reaches.
 */
export interface PriorTable {
  /** The id of the source. The license of the source must permit a fact. */
  readonly source: string;
  /** The date of the data of the source. */
  readonly asOf: IsoDate;
  /** The scheme of the region codes, for example `us-county-fips`. */
  readonly scheme: string;
  /** The method of the rates, in plain words. */
  readonly method: string;
  /** The regions that the source observes. An observed region with no rate of a case has no event of the case, so its prior is 0. */
  readonly codes: readonly string[];
  /** The rate of each case in each region with one event or more. The keys are the code of the case, then the code of the region. */
  readonly rates: Readonly<Record<string, Readonly<Record<string, readonly [perYear: number, reach: number]>>>>;
}

/** The name of the format of a list of hazard cases. */
export const HAZARDS_SCHEMA = "hazards/2";

/** A list of hazard cases with the table of its sources. */
export interface HazardList {
  readonly schema: typeof HAZARDS_SCHEMA;
  /** The sources, by id. The field `id` of each source is its key. */
  readonly sources: Readonly<Record<string, HazardSource>>;
  readonly hazards: readonly Hazard[];
  /** The tables of the yearly priors of the cases. A case with no table for the region of the user has no prior. */
  readonly priors?: readonly PriorTable[] | undefined;
}

/** The gamma law of the rates of the areas of one group, with the count of its areas and of their events. */
export interface PoolLaw extends GammaRates {
  /** The count of the observed areas of the group. */
  readonly areas: number;
  /** The sum of the events of the areas of the group. */
  readonly events: number;
  /** `group` for a law of the fit of the group. `nation` for a group with no event: its mean is its pooled rate toward the groups with events. */
  readonly from: "group" | "nation";
}

/** The scores of the methods of one case in a holdout of the pooled rates (`scripts/eaglei-pooling.ts`). Each score is a sum over the counties. */
export interface PoolScore {
  /** The Poisson log-likelihood of the score half with the rate of each county from its own events: its events over its years. */
  readonly raw: number;
  /** The pooled rate of each county toward the counties of its state (`pooledRates`). */
  readonly pooled: number;
  /**
   * One rate for each county of a state: the events of the state over the years of its counties.
   * A state with no event in the fit half gets the mean of its law in `pooledRates`. Thus the two methods have the same rate for it.
   */
  readonly state: number;
  /** The count of the counties with a raw rate of 0 and one event or more in the score half. Each one gives a raw score of `-Infinity`. */
  readonly lost: number;
  /** The sums of the squared errors of the counts of the score half: `(count - rate * years)^2`. They are finite for each method. */
  readonly squared: { readonly raw: number; readonly pooled: number; readonly state: number };
}

/** The holdout of each case of a fit, with its seed. */
export interface PoolHoldout {
  readonly seed: number;
  readonly cases: Readonly<Record<string, PoolScore>>;
}

/** The pooling of the county rates of one fit: the law of each state in each case, and the holdout. The holdout is the gate of the pooled rates. */
export interface CountyPooling {
  /** The law of each state with an observed county, by the code of the case and the code of the state. */
  readonly laws: Readonly<Record<string, Readonly<Record<string, PoolLaw>>>>;
  readonly holdout: PoolHoldout;
}
