import { checkSources, LICENSES, permits, type FindingCode, type GateOptions, type Use } from "@mark1russell7/guidebook";
import { curveFault, dayNumber, type Fault, type Part } from "@mark1russell7/system-stack";
import { CLAIM_BASES, SUPPLY_PARTS, type Claim, type DurationLaw, type HazardList, type HazardSource } from "./hazard.ts";
import { priorTableFaults } from "./priors.ts";

// The gate of a list of hazard cases: each cut has a claim, each claim and each law has a source with a license.
// Each claim of a source has a basis. The fields of each source go through the source gate of @mark1russell7/guidebook.

/**
 * These are the codes of the gate. Each code is an error, except `hazards-no-law`, which is a warning.
 *
 * - `hazards-twice`: two cases have one code, or a case cuts one part two times.
 * - `hazards-part-unknown`: a cut names a part that is not a reference part.
 * - `hazards-no-claim`: a cut has no claim.
 * - `hazards-source`: a claim, a law or the list `examined` names a source that the table does not have.
 *   Or the id of a source is not its key in the table.
 *   Or the source gate of the guidebook (`checkSources`) gives an error for a source, other than `unknown-license`.
 *   The message ends with the code of the guidebook, for example `(bad-url)`.
 *   Or a claim of a source has no basis of `CLAIM_BASES`, or a claim of the definition has a basis.
 * - `hazards-license`: a source has a license that the guidebook does not know (`unknown-license`).
 *   Or its license does not permit a summary, so the list can only link to it.
 *   Or the license of the source of a law does not permit a fact.
 * - `hazards-law-region`: the source of a law has no regions, or the law has another scheme.
 *   Or the law has no curve for a region of its source.
 * - `hazards-fit`: the fit of a law has no family, no method, or a count of events that is not a whole number above 0.
 * - `hazards-curve`: a curve of a law does not have the form of a survival curve.
 * - `hazards-prior`: a table of priors names a source that the table of the sources does not have.
 *   Or the license of its source does not permit a fact.
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

/** The options of the gate of a list of hazard cases: the date options of the source gate of the guidebook. */
export type HazardGateOptions = Pick<GateOptions, "at" | "maxAgeDays">;

/**
 * This function gives each fault of a list of hazard cases. A list with no error tells that the gate passes.
 * The reference parts are `SUPPLY_PARTS` by default. The faults are in the order of the list. The function is pure.
 *
 * With the option `at`, the source gate also examines the check date of each source. A check after `at` is an error.
 * A check older than `maxAgeDays` (365 by default) is a warning. Both have the code `hazards-source`.
 */
export function checkHazards(list: HazardList, parts: readonly Part[] = SUPPLY_PARTS, options: HazardGateOptions = {}): HazardFault[] {
  const faults: HazardFault[] = [];
  const add = (level: "error" | "warning", code: HazardCode, at: string, message: string): void => {
    faults.push({ level, code, at, message });
  };
  const known = new Set(parts.map((part) => part.id));

  const entries = Object.entries(list.sources);
  for (const [id, source] of entries) {
    const at = `sources.${id}`;
    if (source.id !== id) add("error", "hazards-source", at, `The source "${id}" has the id "${source.id}". The id of a source must be its key.`);
    if (knownLicense(source) && !permits(source.license, "summary")) {
      add("error", "hazards-license", at, `The license "${source.license}" of the source "${id}" does not permit a summary, so the list can only link to it.`);
    }
  }
  // The gate of the guidebook gets the key of each source as its id, so the path of each finding is a key of the table.
  const dates: HazardGateOptions = { ...(options.at === undefined ? {} : { at: options.at }), ...(options.maxAgeDays === undefined ? {} : { maxAgeDays: options.maxAgeDays }) };
  for (const finding of checkSources(entries.map(([id, source]) => ({ ...source, id })), { ...SOURCE_RULES, ...dates })) {
    add(finding.level, sourceCode(finding.code), `sources.${finding.id}`, `${finding.message} (${finding.code})`);
  }
  // A source with a fault of its license gives one finding. The laws and the tables of priors of that source give no second finding.
  const badLicense = new Set(faults.filter((fault) => fault.code === "hazards-license").map((fault) => fault.at.slice("sources.".length)));
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
      if (item.duration.read) {
        for (const [code, message] of lawFaults(item.duration, list.sources)) {
          if (code !== "hazards-license" || !badLicense.has(item.duration.source)) add("error", code, at, `The law of the cut "${at}": ${message}`);
        }
      }
      else add("warning", "hazards-no-law", at, `The cut "${at}" has no law of its duration, so the draws that it can stop are no read.`);
    }
  }
  for (const [index, table] of (list.priors ?? []).entries()) {
    const at = `priors.${String(index)}`;
    const source = list.sources[table.source];
    if (source === undefined) add("error", "hazards-prior", at, `The table of priors "${at}" names the source "${table.source}", and the table of the sources does not have it.`);
    else if (!badLicense.has(table.source) && !permitsUse(source, "fact")) add("error", "hazards-prior", at, `The license of the source "${table.source}" of the table of priors "${at}" does not permit a fact.`);
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

/**
 * The rules of a source of a list, as options of the source gate of the guidebook.
 * A source has a publisher for the credit, a page of the terms as the evidence of the license, and HTTPS addresses.
 */
const SOURCE_RULES: GateOptions = { require: ["by", "terms"], https: true };

/** This function gives the code of the gate for a code of the source gate of the guidebook. A fault of a field of a source, also of `terms`, is a `hazards-source`. */
function sourceCode(code: FindingCode): HazardCode {
  return code === "unknown-license" ? "hazards-license" : "hazards-source";
}

/** This function tells if the license of a source is a license that the guidebook knows. A list from JSON can have another value. */
function knownLicense(source: HazardSource): boolean {
  return (LICENSES as readonly unknown[]).includes(source.license);
}

/** This function tells if the license of a source is known and permits a use. */
function permitsUse(source: HazardSource, use: Use): boolean {
  return knownLicense(source) && permits(source.license, use);
}

/** This function gives the faults of a law of a duration with their codes. */
function lawFaults(law: DurationLaw, sources: HazardList["sources"]): [HazardCode, string][] {
  const faults: [HazardCode, string][] = [];
  const source = sources[law.source];
  if (source === undefined) return [["hazards-source", `the table of the sources does not have the source "${law.source}".`]];
  if (!permitsUse(source, "fact")) faults.push(["hazards-license", `the license of the source "${law.source}" does not permit a fact.`]);
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
