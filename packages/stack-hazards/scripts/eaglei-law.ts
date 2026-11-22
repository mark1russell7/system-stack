import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { countOf } from "@mark1russell7/text";
import type { DurationLaw, Source } from "../src/hazard.ts";
import { LAWS_SCHEMA, type CauseLaws, type EagleLaws } from "./eaglei-fit.ts";
import { ZONE_FILE } from "./storm-files.ts";

// The step after the fit job: the artifact eaglei-laws becomes the source and the law of the module src/eaglei-law.ts.
// The module is the data of the grid cut of the case of a power outage. A person runs this script and commits the module.

/** The id of the source of EAGLE-I in the table of the sources. */
export const EAGLEI_SOURCE_ID = "eaglei.outages";

/** The least count of events of a state for a curve. A state with fewer events gets no curve, and it is not a region of the source. */
export const MIN_EVENTS = 30;

/** The license that the converter accepts. A change of the license of the dataset stops the converter. */
export const EAGLEI_LICENSE = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" } as const;

const FEDERAL = "Public domain (a work of the United States federal government)";
// NOAA is a federal agency. The law 17 U.S.C. 105 puts each work of the federal government in the public domain.
const STORMS_LICENSE = { name: FEDERAL, url: "https://www.copyright.gov/title17/92chap1.html#105" } as const;
const ZONES_LICENSE = { name: FEDERAL, url: "https://www.weather.gov/disclaimer" } as const;

/** This function gives the id of the source of the law of a storm case, for example `eaglei.met.tornado`. */
export const causeSourceId = (name: string): string => `eaglei.${name}`;

/**
 * The law of the grid cut of one storm case, and its source. The source is the outages of EAGLE-I in the storm events of the case.
 * Its regions are the states with `MIN_EVENTS` events of the case or more, so the law has a curve for each region of its source.
 */
export interface CauseLaw {
  readonly id: string;
  readonly source: Source;
  readonly law: DurationLaw;
}

/** The laws of the grid cut of the storm cases, and the sources of the causes. */
export interface CauseLawSet {
  /** The law of each case with one state of `MIN_EVENTS` events or more, by the code of the case. */
  readonly laws: Readonly<Record<string, CauseLaw>>;
  readonly storms: Source;
  readonly zones: Source;
}

/** The source and the laws of the grid cut from one fit, and the states with too few events. */
export interface EagleLaw {
  readonly source: Source;
  readonly law: DurationLaw;
  /** The codes of the states with fewer than `MIN_EVENTS` events. */
  readonly dropped: readonly string[];
  readonly causes: CauseLawSet;
}

const hours = (seconds: number): string => countOf(seconds / 3600, "hour");

/** This function gives the law of each storm case with one state of `MIN_EVENTS` events or more, and the sources of the causes. */
function causeLaws(causes: CauseLaws, eaglei: Source, scheme: string): CauseLawSet {
  const { before, after } = causes.options;
  const { read } = eaglei;
  const method = `product limit with right censoring, over the outages that start in a county from ${hours(before)} before to ${hours(after)} after a storm event of the case`;
  const laws = Object.entries(causes.cases).flatMap(([name, entry]): [string, CauseLaw][] => {
    const kept = Object.keys(entry.regions)
      .sort()
      .filter((code) => (entry.regions[code]?.count ?? 0) >= MIN_EVENTS);
    if (kept.length === 0) return [];
    const id = causeSourceId(name);
    const count = kept.reduce((sum, code) => sum + (entry.regions[code]?.count ?? 0), 0);
    const curves = Object.fromEntries(kept.map((code) => [code, entry.regions[code]?.curve ?? []]));
    const source: Source = { ...eaglei, name: `${eaglei.name}, in the storm events of the case ${name}`, regions: { scheme, codes: kept } };
    return [[name, { id, source, law: { read: true, source: id, fit: { family: "kaplan-meier", method, count }, scheme, curves } }]];
  });
  const updated = causes.storms.files
    .flatMap((file) => {
      const date = /_c(\d{4})(\d{2})(\d{2})\.csv\.gz$/u.exec(file.name);
      return date === null ? [] : [`${String(date[1])}-${String(date[2])}-${String(date[3])}`];
    })
    .sort()
    .at(-1);
  return {
    laws: Object.fromEntries(laws),
    storms: { name: "NOAA Storm Events Database", url: "https://www.ncei.noaa.gov/stormevents/", publisher: "NOAA National Centers for Environmental Information", license: { ...STORMS_LICENSE }, updated, read },
    zones: { name: `The zone-county file of the NWS (${causes.storms.zones})`, url: ZONE_FILE, publisher: "National Weather Service", license: { ...ZONES_LICENSE }, read },
  };
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
  if (laws.causes === undefined) throw new RangeError("eagleLaw: the record has no causes. The fit job gives them with the storm events.");
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
  return { source, law, dropped: codes.filter((code) => !kept.includes(code)), causes: causeLaws(laws.causes, source, laws.scheme) };
}

/** This function gives the lines of the curves of a law, in the order of the codes as text. */
function curveLines(curves: DurationLaw["curves"], codes: readonly string[], indent: string): string[] {
  return codes.map((code) => `${indent}${JSON.stringify(code)}: ${JSON.stringify(curves[code] ?? [])},`);
}

/** This function gives the JSON of a source, with its codes of regions on one line. */
const sourceText = (source: Source, indent: number): string =>
  JSON.stringify(source, null, 2)
    .replace(/"codes": \[[^\]]*\]/u, () => `"codes": ${JSON.stringify(source.regions?.codes ?? [])}`)
    .replaceAll("\n", `\n${" ".repeat(indent)}`);

/** This function gives the text of the module `src/eaglei-law.ts` for a source and a law. */
export function lawModule({ source, law, causes }: EagleLaw): string {
  // The order of the codes of the source: an object puts the keys that look like integers ("10") before the others ("01").
  const codes = source.regions?.codes ?? Object.keys(law.curves).sort();
  const curves = curveLines(law.curves, codes, "    ");
  const cases = Object.entries(causes.laws);
  const caseLines = cases.flatMap(([name, { law: one }]) => [
    `  ${JSON.stringify(name)}: {`,
    "    read: true,",
    `    source: ${JSON.stringify(one.source)},`,
    `    fit: ${JSON.stringify(one.fit)},`,
    `    scheme: ${JSON.stringify(one.scheme)},`,
    "    curves: {",
    ...curveLines(one.curves, Object.keys(one.curves).sort(), "      "),
    "    },",
    "  },",
  ]);
  const sourceLines = cases.map(([, one]) => `  ${JSON.stringify(one.id)}: ${sourceText(one.source, 2)},`);
  return [
    "// This module is made by `scripts/eaglei-law.ts` from the artifact `eaglei-laws` of the workflow `hazards-fit`. Do not change it by hand.",
    "// The curves are a derived work of the EAGLE-I dataset (CC BY 4.0). They read no outage under 15 minutes.",
    'import type { DurationLaw, Source } from "./hazard.ts";',
    "",
    "/** The source of the law of the grid cut: the county outage records of EAGLE-I. */",
    `export const EAGLEI_SOURCE: Source = ${sourceText(source, 0)};`,
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
    "/** The source of the causes of the storm cases: the storm events of NOAA. */",
    `export const STORM_EVENTS_SOURCE: Source = ${JSON.stringify(causes.storms, null, 2)};`,
    "",
    "/** The source of the counties of each forecast zone of the storm events. */",
    `export const ZONE_COUNTY_SOURCE: Source = ${JSON.stringify(causes.zones, null, 2)};`,
    "",
    "/** The source of the law of each storm case, by its id: the outages of EAGLE-I in the storm events of the case. */",
    "export const EAGLEI_CAUSE_SOURCES: Readonly<Record<string, Source>> = {",
    ...sourceLines,
    "};",
    "",
    "/** The law of the duration of a stop of the grid in each storm case, by the code of the case: the outages that start in a storm event of the case. */",
    "export const EAGLEI_CAUSE_LAWS: Readonly<Record<string, DurationLaw>> = {",
    ...caseLines,
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
  for (const [name, { law }] of Object.entries(result.causes.laws)) console.log(`${name}: ${String(Object.keys(law.curves).length)} states, ${String(law.fit.count)} events.`);
}
