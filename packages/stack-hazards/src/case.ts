import { survivalAt, type CaseCuts, type Cut, type CutFollows, type FollowSide, type FollowTerm, type Survival } from "@mark1russell7/system-stack";
import type { CitedSpan, Hazard, HazardCut, HazardList, NoLaw } from "./hazard.ts";

// The bind of a hazard case to a stack: the values of `CaseCuts` of stack-endurance, with the curve of the region of the user.

/** The option of the basis of the claims, for `hazardCase` and `supplyState`. */
export interface BasisOptions {
  /**
   * What to do with the claims that a source assesses as a risk. With `keep` (the default), each claim stays.
   * With `drop`, a cut keeps only its told claims and its claims of the definition.
   * A cut with only assessed claims stays in the case with `NO_TOLD_LAW`, so its draws are no read, not a pass.
   */
  readonly assessed?: "keep" | "drop" | undefined;
}

/** A region of the user, as a code of a scheme, for example `{ scheme: "us-state-fips", code: "37" }`. */
export interface HazardRegion {
  readonly scheme: string;
  readonly code: string;
}

/** The options of `hazardCase`. */
export interface HazardCaseOptions extends BasisOptions {
  /**
   * The region of the user: one region, or one region for each scheme. A place has a code in each scheme, for example a state and the nation.
   * Each law reads the first region with its scheme. A law with no region of its scheme, or with no curve for the code, gives a cut with no curve.
   */
  readonly region?: HazardRegion | readonly HazardRegion[] | undefined;
  /**
   * The ids of the parts of the stack for each reference part, when the stack does not use the reference ids.
   * A reference part with an empty list is not in the stack, so the case has no cut of it. The default is the reference id.
   */
  readonly parts?: Readonly<Record<string, readonly string[]>> | undefined;
}

/**
 * The duration of a cut with only assessed claims, when the option `assessed` is `drop`.
 * A law needs a told cut, so the cut has no law. The cut keeps its claims, so a reader sees the reason.
 */
export const NO_TOLD_LAW: NoLaw = { read: false, reason: "Each claim of this cut is assessed, and the option drops the assessed claims. A law needs a told cut." };

/** The state of a supply in a case: the cut, or no read when no source that the dataset read names the cut. */
export type SupplyState = { readonly state: "cut"; readonly cut: HazardCut } | { readonly state: "no-read" };

/** The side of a term of a dependent cut: `FollowSide` of the core. Since 0.7.0. The core has the type since 0.1.13. */
export type TermSide = FollowSide;

/** The terms of a dependent cut with a curve, in the output of `hazardCase`: `CutFollows` of the core. Since 0.7.0. */
export type FollowRead = CutFollows;

export type { FollowTerm };

/** A cut in the output of `hazardCase`: a `Cut` of the core, with the terms of a dependent cut with a curve. Since 0.7.0. */
export interface HazardCaseCut extends Cut {
  /**
   * The bound of the curve, on each cut with a curve. Since 0.7.2.
   * `law` for a cut with a law of its own. For a dependent cut, the `bound` of `follows`: `upper` or `none`.
   * The terms give no `lower`, because each onset is an upper bound.
   */
  readonly bound?: "law" | FollowRead["bound"] | undefined;
  readonly follows?: FollowRead | undefined;
}

/** The output of `hazardCase`: the values of `CaseCuts` of the core, with the cuts of `HazardCaseCut`. Since 0.7.0. */
export interface HazardCaseCuts extends CaseCuts {
  readonly cuts: readonly HazardCaseCut[];
}

/** This function gives the case of a code, or `undefined`. */
export function hazardOf(list: HazardList, code: string): Hazard | undefined {
  return list.hazards.find((hazard) => hazard.case === code);
}

/**
 * This function gives the state of a reference part in a case. A part with no cut is no read, not a pass.
 * The option `assessed` changes the cut as in `hazardCase`, so the two functions agree.
 */
export function supplyState(hazard: Hazard, part: string, options: BasisOptions = {}): SupplyState {
  const cut = hazard.cuts.find((item) => item.part === part);
  return cut === undefined ? { state: "no-read" } : { state: "cut", cut: basisCut(cut, options) };
}

/**
 * This function gives a hazard case as the values of `CaseCuts` of stack-endurance. Each cut gets the curve of the region of the user.
 * A cut with no law, or with no curve for the region, has no `duration`. Then the shortfall gives no read for its draws.
 * The source of each cut is the URL of the source of its law, or the URLs of its claims.
 *
 * Since 0.7.0, a cut with `follows` gets the curve of its cause cut in the same case, with the shift of `followCurve`.
 * Its field `follows` then tells the side of each term. Its source is the source of the cause curve and the sources of the terms.
 * A cause with no curve gives the dependent cut no `duration`, as before 0.7.0.
 *
 * Since 0.7.2, each cut with a curve has the field `bound` of the core. A cut with a law of its own has `law`.
 * A dependent cut has the `bound` of its field `follows`. A reader of `bound` alone thus tells a law from a curve that is no bound.
 *
 * The option `assessed` can drop the claims of assessed risks. A cut with only assessed claims then has no `duration`. The function is pure.
 */
export function hazardCase(list: HazardList, hazard: Hazard, options: HazardCaseOptions = {}): HazardCaseCuts {
  const regions = hazardRegions(options.region);
  const cuts = hazard.cuts.flatMap((cut): HazardCaseCut[] => {
    const item = basisCut(cut, options);
    const ids = options.parts?.[item.part] ?? [item.part];
    const read = cutCurve({ list, hazard, regions, options }, item, new Set());
    const source = read === undefined ? claimSources(list, item) : read.source;
    const follows = read?.follows === undefined ? {} : { follows: read.follows };
    return ids.map((part) => ({ part, title: item.title, ...(read === undefined ? {} : { duration: read.curve, bound: read.bound }), source, ...follows }));
  });
  return { case: hazard.case, title: hazard.title, cuts };
}

/**
 * This function gives the curve of a dependent cut from the curve of its cause, in days. Since 0.7.0.
 * The dependent cut occurs only when the cause lasts longer than `onset`. Then it lasts the time of the cause after `onset`, plus `recovery`.
 * Thus the curve is the cause curve, shifted down by `onset` and then up by `recovery`.
 *
 * The law has a mass at 0: the chance that the cause ends at or before `onset`. A curve of the core has no step.
 * So the curve falls linearly from [0, 1] to the next point. That part is above the law, thus an upper bound. With an onset of 0, the curve is exact.
 *
 * @returns The curve, or `undefined` when the cause always ends before `onset` and `recovery` is 0. Then the cut does not occur.
 * @throws RangeError when `onset` or `recovery` is not a finite number of 0 or more.
 */
export function followCurve(cause: Survival, onset: number, recovery: number): Survival | undefined {
  if (!(Number.isFinite(onset) && onset >= 0 && Number.isFinite(recovery) && recovery >= 0)) throw new RangeError("followCurve: the onset or the recovery is not a finite number of 0 or more.");
  const points: [number, number][] = [[0, 1]];
  if (recovery > 0) points.push([recovery, survivalAt(cause, onset)]);
  for (const [day, chance] of cause) if (day > onset) points.push([day - onset + recovery, chance]);
  return points.length > 1 ? points : undefined;
}

/** The inputs of the curve of a cut, which each cut of one call of `hazardCase` shares. */
interface CurveContext {
  readonly list: HazardList;
  readonly hazard: Hazard;
  readonly regions: readonly HazardRegion[];
  readonly options: BasisOptions;
}

/** The curve of a cut for the region of the user, its source and its bound. The bound `law` is the curve of a law of the cut itself. */
interface CurveRead {
  readonly curve: Survival;
  readonly source: string;
  readonly bound: "law" | FollowRead["bound"];
  readonly follows?: FollowRead | undefined;
}

/**
 * This function gives the curve of a cut, or `undefined`. A cut with a law reads the curve of the region of the user.
 * A cut with `follows` and no law reads the curve of its cause. A cause that is not in the case, or a cycle, gives no curve.
 */
function cutCurve(context: CurveContext, cut: HazardCut, seen: ReadonlySet<string>): CurveRead | undefined {
  if (cut.duration.read) {
    const law = cut.duration;
    const code = context.regions.find((region) => region.scheme === law.scheme)?.code;
    const curve = code === undefined ? undefined : law.curves[code];
    return curve === undefined ? undefined : { curve, source: sourceUrl(context.list, law.source), bound: "law" };
  }
  const follows = cut.follows;
  // A cut with only assessed claims and the option drop has no law, so it follows no cause.
  if (follows === undefined || cut.duration === NO_TOLD_LAW || seen.has(cut.part)) return undefined;
  const cause = context.hazard.cuts.find((item) => item.part === follows.part);
  const read = cause === undefined ? undefined : cutCurve(context, basisCut(cause, context.options), new Set([...seen, cut.part]));
  if (read === undefined) return undefined;
  const onset = followTerm("onset", follows.onset);
  const recovery = followTerm("recovery", follows.recovery);
  const curve = followCurve(read.curve, onset.days, recovery.days);
  if (curve === undefined) return undefined;
  const bound = onset.side === "upper" && recovery.side === "upper" && read.bound !== "none" ? "upper" : "none";
  const urls = [read.source, ...[follows.onset, follows.recovery].flatMap((span) => (span === undefined ? [] : spanSources(context.list, span)))];
  const source = [...new Set(urls.flatMap((url) => url.split(" ")))].join(" ");
  return { curve, source, bound, follows: { part: follows.part, onset, recovery, bound } };
}

/**
 * This function gives a term of a dependent cut. A missing onset is 0, an upper bound. A missing recovery is 0, a lower bound.
 *
 * A span of the basis `range` gives the low end of an onset and the high end of a recovery. Each one is an upper bound, for its span.
 * A span of the basis `minimum` gives its low end, because the real value is at least that value.
 * A longer onset gives a shorter cut, so a minimum onset is an upper bound. A minimum recovery is a lower bound.
 */
function followTerm(name: "onset" | "recovery", span: CitedSpan | undefined): FollowTerm {
  if (span === undefined) {
    return name === "onset" ? { days: 0, cited: false, side: "upper", says: "onset not cited: 0, an upper bound" } : { days: 0, cited: false, side: "lower", says: "recovery not cited: 0, a lower bound" };
  }
  const minimum = span.basis === "minimum";
  const [end, value]: readonly [string, number] = name === "onset" || minimum ? ["low", span.low] : ["high", span.high];
  const side: TermSide = minimum && name === "recovery" ? "lower" : "upper";
  const says = `${name} cited as ${minimum ? "a rule minimum" : "a range"}: the ${end} end, ${String(value)} ${span.unit}, ${side === "upper" ? "an upper bound" : "a lower bound"}`;
  return { days: span.unit === "hours" ? value / 24 : value, cited: true, side, says };
}

/** This function gives the URLs of the claims of a span. */
function spanSources(list: HazardList, span: CitedSpan): string[] {
  return span.claims.flatMap((claim) => (claim.source === undefined ? [] : [sourceUrl(list, claim.source)]));
}

/** This function gives the regions of the option `region` as a list: no region, one region, or the list as it is. */
export function hazardRegions(region: HazardCaseOptions["region"]): readonly HazardRegion[] {
  if (region === undefined) return [];
  return "scheme" in region ? [region] : region;
}

/**
 * This function gives a cut for the option `assessed`. With `drop`, a cut keeps its other claims and its law.
 * A cut with only assessed claims keeps its claims, and gets `NO_TOLD_LAW` in place of its law.
 */
function basisCut(cut: HazardCut, options: BasisOptions): HazardCut {
  if (options.assessed !== "drop") return cut;
  const claims = cut.claims.filter((claim) => claim.basis !== "assessed");
  if (claims.length === cut.claims.length) return cut;
  return claims.length === 0 ? { ...cut, duration: NO_TOLD_LAW } : { ...cut, claims };
}

/** This function gives the URL of a source, or its id when the table does not have it. */
function sourceUrl(list: HazardList, id: string): string {
  return list.sources[id]?.url ?? id;
}

/** This function gives the sources of the claims of a cut as one text: the URLs, and `definition` for a claim of the definition. */
function claimSources(list: HazardList, cut: HazardCut): string {
  return cut.claims.map((claim) => (claim.source === undefined ? "definition" : sourceUrl(list, claim.source))).join(" ");
}
