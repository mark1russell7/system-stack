import type { CaseCuts, Cut } from "@mark1russell7/system-stack";
import type { Hazard, HazardCut, HazardList, NoLaw } from "./hazard.ts";

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

/** The options of `hazardCase`. */
export interface HazardCaseOptions extends BasisOptions {
  /** The region of the user, as a code of a scheme. A law with no curve for it gives a cut with no curve. */
  readonly region?: { readonly scheme: string; readonly code: string } | undefined;
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
 * The option `assessed` can drop the claims of assessed risks. A cut with only assessed claims then has no `duration`. The function is pure.
 */
export function hazardCase(list: HazardList, hazard: Hazard, options: HazardCaseOptions = {}): CaseCuts {
  const cuts = hazard.cuts.flatMap((cut): Cut[] => {
    const item = basisCut(cut, options);
    const ids = options.parts?.[item.part] ?? [item.part];
    const law = item.duration.read ? item.duration : undefined;
    const curve = law !== undefined && options.region !== undefined && options.region.scheme === law.scheme ? law.curves[options.region.code] : undefined;
    const source = curve !== undefined && law !== undefined ? sourceUrl(list, law.source) : claimSources(list, item);
    return ids.map((part) => ({ part, title: item.title, ...(curve === undefined ? {} : { duration: curve }), source }));
  });
  return { case: hazard.case, title: hazard.title, cuts };
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
