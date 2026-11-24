import { curveFault, dayNumber, type Fault, type Part } from "@mark1russell7/system-stack";
import { CLAIM_BASES, SUPPLY_PARTS, type Claim, type DurationLaw, type HazardList, type Source } from "./hazard.ts";
import { priorTableFaults } from "./priors.ts";

// The gate of a list of hazard cases: each cut has a claim, each claim and each law has a source with a license.
// Each claim of a source has a basis.

/**
 * These are the codes of the gate. Each code is an error, except `hazards-no-law`, which is a warning.
 *
 * - `hazards-twice`: two cases have one code, or a case cuts one part two times.
 * - `hazards-part-unknown`: a cut names a part that is not a reference part.
 * - `hazards-no-claim`: a cut has no claim.
 * - `hazards-source`: a claim, a law or the list `examined` names a source that the table does not have.
 *   Or a source has no name, no URL, no publisher or a wrong date.
 *   Or a claim of a source has no basis of `CLAIM_BASES`, or a claim of the definition has a basis.
 * - `hazards-license`: a source has no license name or no license URL.
 * - `hazards-law-region`: the source of a law has no regions, or the law has another scheme.
 *   Or the law has no curve for a region of its source.
 * - `hazards-fit`: the fit of a law has no family, no method, or a count of events that is not a whole number above 0.
 * - `hazards-curve`: a curve of a law does not have the form of a survival curve.
 * - `hazards-prior`: a table of priors names a source that the table of the sources does not have, or a source with no license.
 *   Or it has no method, a wrong date, a case that is not in the list, or a region that is not in its codes.
 *   Or it has a rate that is not a count of 0 or more with a share from 0 to 1.
 * - `hazards-no-law` (warning): a cut has no law of its duration. Its draws are no read in the shortfall.
 */
export const HAZARD_CODES: readonly [
  "hazards-twice",
  "hazards-part-unknown",
  "hazards-no-claim",
  "hazards-source",
  "hazards-license",
  "hazards-law-region",
  "hazards-fit",
  "hazards-curve",
  "hazards-prior",
  "hazards-no-law",
] = ["hazards-twice", "hazards-part-unknown", "hazards-no-claim", "hazards-source", "hazards-license", "hazards-law-region", "hazards-fit", "hazards-curve", "hazards-prior", "hazards-no-law"];

/** A code of the gate of a list of hazard cases. */
export type HazardCode = (typeof HAZARD_CODES)[number];

/** A fault of a list of hazard cases. */
export interface HazardFault extends Fault {
  readonly code: HazardCode;
}

/**
 * This function gives each fault of a list of hazard cases. A list with no error tells that the gate passes.
 * The reference parts are `SUPPLY_PARTS` by default. The faults are in the order of the list. The function is pure.
 */
export function checkHazards(list: HazardList, parts: readonly Part[] = SUPPLY_PARTS): HazardFault[] {
  const faults: HazardFault[] = [];
  const add = (level: "error" | "warning", code: HazardCode, at: string, message: string): void => {
    faults.push({ level, code, at, message });
  };
  const known = new Set(parts.map((part) => part.id));

  for (const [id, source] of Object.entries(list.sources)) {
    const at = `sources.${id}`;
    for (const fault of sourceFaults(source)) add("error", "hazards-source", at, `The source "${id}" ${fault}.`);
    if (source.license.name.trim() === "" || source.license.url.trim() === "") add("error", "hazards-license", at, `The source "${id}" has no license name or no license URL.`);
  }
  const sourceAt = (at: string, id: string): void => {
    if (list.sources[id] === undefined) add("error", "hazards-source", at, `"${at}" names the source "${id}", and the table of the sources does not have it.`);
  };

  const cases = new Set<string>();
  for (const hazard of list.hazards) {
    if (cases.has(hazard.case)) add("error", "hazards-twice", hazard.case, `Two cases have the code "${hazard.case}".`);
    cases.add(hazard.case);
    for (const id of hazard.examined) sourceAt(`${hazard.case}.examined`, id);
    const cut = new Set<string>();
    for (const item of hazard.cuts) {
      const at = `${hazard.case}.${item.part}`;
      if (cut.has(item.part)) add("error", "hazards-twice", at, `The case "${hazard.case}" cuts the part "${item.part}" two times.`);
      cut.add(item.part);
      if (!known.has(item.part)) add("error", "hazards-part-unknown", at, `The cut "${at}" names a part that is not a reference part.`);
      if (item.claims.length === 0) add("error", "hazards-no-claim", at, `The cut "${at}" has no claim.`);
      for (const claim of item.claims) {
        if (claim.source !== undefined) sourceAt(at, claim.source);
        const fault = basisFault(claim);
        if (fault !== undefined) add("error", "hazards-source", at, `A claim of the cut "${at}" ${fault}.`);
      }
      if (item.duration.read) for (const [code, message] of lawFaults(item.duration, list.sources)) add("error", code, at, `The law of the cut "${at}": ${message}`);
      else add("warning", "hazards-no-law", at, `The cut "${at}" has no law of its duration, so the draws that it can stop are no read.`);
    }
  }
  for (const [index, table] of (list.priors ?? []).entries()) {
    const at = `priors.${String(index)}`;
    const source = list.sources[table.source];
    if (source === undefined) add("error", "hazards-prior", at, `The table of priors "${at}" names the source "${table.source}", and the table of the sources does not have it.`);
    else if (source.license.name.trim() === "" || source.license.url.trim() === "") add("error", "hazards-prior", at, `The source "${table.source}" of the table of priors "${at}" has no license.`);
    if (dayNumber(table.asOf) === undefined) add("error", "hazards-prior", at, `The table of priors "${at}" has a date that is not a date YYYY-MM-DD.`);
    for (const fault of priorTableFaults(table, cases)) add("error", "hazards-prior", at, `The table of priors "${at}" ${fault}.`);
  }
  return faults;
}

/**
 * This function gives the fault of the basis of a claim as the end of a sentence, or `undefined`.
 * A claim of a source has a basis of `CLAIM_BASES`. A claim of the definition has no basis.
 */
function basisFault(claim: Claim): string | undefined {
  const basis: unknown = claim.basis;
  if (claim.definition === true) return basis === undefined ? undefined : "is the definition of the case, and has a basis of a source";
  if (basis === undefined) return `names the source "${claim.source}" with no basis`;
  return (CLAIM_BASES as readonly unknown[]).includes(basis) ? undefined : `has the basis "${String(basis)}", which is not one of ${CLAIM_BASES.join(", ")}`;
}

/** This function gives the faults of the fields of a source, as the ends of sentences. */
function sourceFaults(source: Source): string[] {
  const faults: string[] = [];
  if (source.name.trim() === "") faults.push("has no name");
  if (!/^https:\/\/\S+$/u.test(source.url)) faults.push("has no HTTPS URL");
  if (source.publisher.trim() === "") faults.push("has no publisher");
  if (dayNumber(source.read) === undefined) faults.push("has a date of the read that is not a date YYYY-MM-DD");
  if (source.updated !== undefined && dayNumber(source.updated) === undefined) faults.push("has a date of the last change that is not a date YYYY-MM-DD");
  return faults;
}

/** This function gives the faults of a law of a duration with their codes. */
function lawFaults(law: DurationLaw, sources: HazardList["sources"]): [HazardCode, string][] {
  const faults: [HazardCode, string][] = [];
  const source = sources[law.source];
  if (source === undefined) return [["hazards-source", `the table of the sources does not have the source "${law.source}".`]];
  if (source.license.name.trim() === "" || source.license.url.trim() === "") faults.push(["hazards-license", `the source "${law.source}" has no license.`]);
  const { family, method, count } = law.fit;
  if (family.trim() === "" || method.trim() === "" || !Number.isInteger(count) || count < 1) faults.push(["hazards-fit", "the fit has no family, no method, or no count of events above 0."]);
  if (source.regions === undefined) faults.push(["hazards-law-region", `the source "${law.source}" has no regions.`]);
  else if (source.regions.scheme !== law.scheme) faults.push(["hazards-law-region", `the scheme "${law.scheme}" is not the scheme "${source.regions.scheme}" of the source.`]);
  else {
    const missing = source.regions.codes.filter((code) => law.curves[code] === undefined);
    if (missing.length > 0) faults.push(["hazards-law-region", `the law has no curve for the regions ${missing.join(", ")} of its source.`]);
  }
  for (const [code, curve] of Object.entries(law.curves)) {
    const fault = curveFault(curve);
    if (fault !== undefined) faults.push(["hazards-curve", `the curve of the region "${code}": ${fault}`]);
  }
  return faults;
}

/** This function tells if a list of faults has an error. */
export function hasHazardError(faults: readonly HazardFault[]): boolean {
  return faults.some((fault) => fault.level === "error");
}
