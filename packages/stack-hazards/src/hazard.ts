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

/** The license of a source. */
export interface License {
  /** The name of the license, for example "Public domain". */
  readonly name: string;
  /** The page that tells the terms of the reuse. */
  readonly url: string;
}

/** The regions of a source: the scheme of the codes and each code that the source covers. */
export interface Regions {
  /** The scheme of the codes, for example `us-state`. */
  readonly scheme: string;
  readonly codes: readonly string[];
}

/** A source: a public page or a public dataset. */
export interface Source {
  /** A short name of the source. */
  readonly name: string;
  readonly url: string;
  /** The organization that publishes the source. */
  readonly publisher: string;
  readonly license: License;
  /** The date that the source shows as its last change. */
  readonly updated?: IsoDate | undefined;
  /** The date of the read of the source. */
  readonly read: IsoDate;
  /** The regions that the source covers. A source of a law of a duration must have its regions. */
  readonly regions?: Regions | undefined;
}

/**
 * The bases of a claim of a source, in a fixed order.
 *
 * - `told`: the source tells the effect as a fact of past events or of physics. For example, a flood washes bridges away.
 * - `assessed`: the source assesses a risk or a threat. For example, an advisory assesses that state actors can disrupt a sector in a conflict.
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
  /** The id of the source of the law. The source must have a license and regions. */
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

/** The name of the format of a list of hazard cases. */
export const HAZARDS_SCHEMA = "hazards/1";

/** A list of hazard cases with the table of its sources. */
export interface HazardList {
  readonly schema: typeof HAZARDS_SCHEMA;
  /** The sources, by id. */
  readonly sources: Readonly<Record<string, Source>>;
  readonly hazards: readonly Hazard[];
}
