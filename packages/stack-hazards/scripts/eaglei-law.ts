import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { DurationLaw, Source } from "../src/hazard.ts";
import { LAWS_SCHEMA, type EagleLaws } from "./eaglei-fit.ts";

// The step after the fit job: the artifact eaglei-laws becomes the source and the law of the module src/eaglei-law.ts.
// The module is the data of the grid cut of the case of a power outage. A person runs this script and commits the module.

/** The id of the source of EAGLE-I in the table of the sources. */
export const EAGLEI_SOURCE_ID = "eaglei.outages";

/** The least count of events of a state for a curve. A state with fewer events gets no curve, and it is not a region of the source. */
export const MIN_EVENTS = 30;

/** The license that the converter accepts. A change of the license of the dataset stops the converter. */
export const EAGLEI_LICENSE = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" } as const;

/** The source and the law of the grid cut from one fit, and the states with too few events. */
export interface EagleLaw {
  readonly source: Source;
  readonly law: DurationLaw;
  /** The codes of the states with fewer than `MIN_EVENTS` events. */
  readonly dropped: readonly string[];
}

/**
 * This function gives the source and the law of the grid cut from the record of a fit.
 *
 * @param laws - The record of `fitEagle`, for example the artifact `eaglei-laws`
 * @returns The source, the law, and the codes of the states with too few events
 * @throws {RangeError} When the record has another schema, another license or no DOI, or when no state has enough events
 */
export function eagleLaw(laws: EagleLaws): EagleLaw {
  if (laws.schema !== LAWS_SCHEMA) throw new RangeError(`eagleLaw: the schema "${String(laws.schema)}" is not "${LAWS_SCHEMA}".`);
  if (laws.source.license !== EAGLEI_LICENSE.name) throw new RangeError(`eagleLaw: the license "${laws.source.license}" is not "${EAGLEI_LICENSE.name}".`);
  if (!/^10\.\d+\/\S+$/u.test(laws.source.doi)) throw new RangeError(`eagleLaw: the record has no DOI of the dataset.`);
  const codes = Object.keys(laws.regions).sort();
  const kept = codes.filter((code) => (laws.regions[code]?.count ?? 0) >= MIN_EVENTS);
  if (kept.length === 0) throw new RangeError(`eagleLaw: no state has ${String(MIN_EVENTS)} events or more.`);
  const source: Source = {
    name: `EAGLE-I outage records of the counties of the United States (version ${String(laws.source.version)})`,
    url: `https://doi.org/${laws.source.doi}`,
    publisher: "Oak Ridge National Laboratory",
    license: { ...EAGLEI_LICENSE },
    updated: laws.source.modified.slice(0, 10),
    read: laws.read.slice(0, 10),
    regions: { scheme: laws.scheme, codes: kept },
  };
  const curves = Object.fromEntries(kept.map((code) => [code, laws.regions[code]?.curve ?? []]));
  const count = kept.reduce((sum, code) => sum + (laws.regions[code]?.count ?? 0), 0);
  const law: DurationLaw = {
    read: true,
    source: EAGLEI_SOURCE_ID,
    fit: { family: "kaplan-meier", method: "product limit with right censoring", count },
    scheme: laws.scheme,
    curves,
  };
  return { source, law, dropped: codes.filter((code) => !kept.includes(code)) };
}

/** This function gives the text of the module `src/eaglei-law.ts` for a source and a law. */
export function lawModule({ source, law }: EagleLaw): string {
  // The order of the codes of the source: an object puts the keys that look like integers ("10") before the others ("01").
  const codes = source.regions?.codes ?? Object.keys(law.curves).sort();
  const curves = codes.map((code) => `    ${JSON.stringify(code)}: ${JSON.stringify(law.curves[code] ?? [])},`);
  return [
    "// This module is made by `scripts/eaglei-law.ts` from the artifact `eaglei-laws` of the workflow `hazards-fit`. Do not change it by hand.",
    "// The curves are a derived work of the EAGLE-I dataset (CC BY 4.0). They read no outage under 15 minutes.",
    'import type { DurationLaw, Source } from "./hazard.ts";',
    "",
    "/** The source of the law of the grid cut: the county outage records of EAGLE-I. */",
    `export const EAGLEI_SOURCE: Source = ${JSON.stringify(source, null, 2).replace(/"codes": \[[^\]]*\]/u, () => `"codes": ${JSON.stringify(source.regions?.codes ?? [])}`)};`,
    "",
    "/** The law of the duration of a stop of the grid, for all causes: one survival curve in days for each state. */",
    "export const EAGLEI_GRID_LAW: DurationLaw = {",
    "  read: true,",
    `  source: ${JSON.stringify(law.source)},`,
    `  fit: ${JSON.stringify(law.fit)},`,
    `  scheme: ${JSON.stringify(law.scheme)},`,
    "  curves: {",
    ...curves,
    "  },",
    "};",
    "",
  ].join("\n");
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string", default: "src/eaglei-law.ts" } } });
  const file = positionals[0];
  if (file === undefined) throw new Error("Usage: node scripts/eaglei-law.ts <eaglei-laws.json> [--out src/eaglei-law.ts]");
  const result = eagleLaw(JSON.parse(readFileSync(file, "utf8")) as EagleLaws);
  writeFileSync(values.out, lawModule(result));
  console.log(`${values.out}: ${String(result.source.regions?.codes.length ?? 0)} states, ${String(result.law.fit.count)} events, dropped ${result.dropped.join(" ") || "none"}.`);
}
