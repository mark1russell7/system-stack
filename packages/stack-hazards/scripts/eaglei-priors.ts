import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { PriorTable } from "../src/hazard.ts";
import { eagleRegion } from "../src/eaglei.ts";
import { observedRegions, regionRates } from "../src/priors.ts";
import { LAWS_SCHEMA, OUTAGE_CASE, PRIOR_LIMIT, type EagleLaws } from "./eaglei-fit.ts";

export { PRIOR_LIMIT };
import { EAGLEI_LICENSE, EAGLEI_SOURCE_ID } from "./eaglei-law.ts";

// The step after the fit job: the counts of the priors in the artifact eaglei-laws become the modules
// src/eaglei-county-priors.ts and src/eaglei-state-priors.ts. A person runs this script and commits the modules.
// The law module does not change.

/** The scheme of the codes of the counties: the 5-digit FIPS code. */
export const COUNTY_SCHEME = "us-county-fips";

/** The significant digits of a rate in the module. */
const DIGITS = 4;

/** The tables of the priors of one fit: one for each county, and one for each state that pools its counties. */
export interface EaglePriorTables {
  readonly county: PriorTable;
  readonly state: PriorTable;
}

/** The share of the customers of a county that starts an event, when the fit has no option `share`: the default of `outageReader`. */
const DEFAULT_SHARE = 0.01;

const common = (share: number): string =>
  `An event is a run of the 15-minute counts of a county at or above ${String(share * 100)}% of its customers. A smaller outage is not counted, and that makes a rate too low. ` +
  "One outage that crosses the line more than one time counts more than one time. The years of a county are the calendar years in which the files list it, so a year with no count is not a year of the county. Each of these makes a rate too high. " +
  `The case ${OUTAGE_CASE} counts the outages in no storm case. Each storm case counts the outages that start in a storm event of the case in the county, from the storm events of NOAA.`;

/** This function gives the tables of the priors of a record of a fit. */
export function eaglePriors(laws: EagleLaws): EaglePriorTables {
  if (laws.schema !== LAWS_SCHEMA) throw new RangeError(`eaglePriors: the schema "${String(laws.schema)}" is not "${LAWS_SCHEMA}".`);
  if (laws.source.license !== EAGLEI_LICENSE.name) throw new RangeError(`eaglePriors: the license "${laws.source.license}" is not "${EAGLEI_LICENSE.name}".`);
  const priors = laws.priors;
  if (priors === undefined) throw new RangeError("eaglePriors: the record has no counts of the priors. A fit job of this version gives them.");
  const table = (scheme: string, region: (area: string) => string, method: string): PriorTable => {
    const codes = observedRegions(priors.observation, region);
    const rates = Object.fromEntries(Object.entries(priors.counts).map(([name, counts]) => [name, rounded(regionRates(counts, priors.observation, region))]));
    // A region with a case above the limit is not in the table: its codes and its rates go.
    const over = new Set(
      codes.filter((code) =>
        Object.values(rates).some((entry) => {
          const rate = entry[code];
          return rate !== undefined && rate[0] * rate[1] > PRIOR_LIMIT;
        }),
      ),
    );
    const limit = `A region with more than ${String(PRIOR_LIMIT)} events at one customer in one year in a case is not in the table, so its prior is no read: ${String(over.size)} regions.`;
    return {
      source: EAGLEI_SOURCE_ID,
      asOf: laws.source.modified.slice(0, 10),
      scheme,
      method: `${method} ${common(laws.options.share ?? DEFAULT_SHARE)}${limit}`,
      codes: codes.filter((code) => !over.has(code)),
      rates: Object.fromEntries(Object.entries(rates).map(([name, entry]) => [name, Object.fromEntries(Object.entries(entry).filter(([code]) => !over.has(code)))])),
    };
  };
  return {
    county: table(COUNTY_SCHEME, (area) => area, "perYear is the events of a county over its years. reach is the mean of the largest count of customers out of each event over the customers of the county."),
    state: table(
      laws.scheme,
      eagleRegion,
      "perYear is the sum of the events of each county of a state over its years. reach is the mean share of the customers of the state that one event reaches, so perYear * reach is the expected events at one customer in one year.",
    ),
  };
}

/** This function gives the rates with `DIGITS` significant digits. */
function rounded(rates: Readonly<Record<string, readonly [number, number]>>): Record<string, readonly [number, number]> {
  return Object.fromEntries(Object.entries(rates).map(([code, [perYear, reach]]) => [code, [Number(perYear.toPrecision(DIGITS)), Number(reach.toPrecision(DIGITS))]]));
}

/** This function gives the lines of a table, with the codes on one line and the rates of each case on one line. */
function tableLines(name: string, doc: string, table: PriorTable): string[] {
  const { rates, codes, ...head } = table;
  return [
    `/** ${doc} */`,
    `export const ${name}: PriorTable = {`,
    ...Object.entries(head).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`),
    `  codes: ${JSON.stringify(codes)},`,
    "  rates: {",
    ...Object.entries(rates).map(([code, entry]) => `    ${JSON.stringify(code)}: {${Object.entries(entry).map(([region, rate]) => `${JSON.stringify(region)}:${JSON.stringify(rate)}`).join(",")}},`),
    "  },",
    "};",
  ];
}

/** The modules of the tables of a fit, by the name of their file in `src/`. */
export type PriorModules = Readonly<Record<"eaglei-county-priors.ts" | "eaglei-state-priors.ts", string>>;

/**
 * This function gives the texts of the two modules of the tables of a fit. The header of each tells the run of the fit
 * job and the options of the fit. It also tells the version, the date and the DOI of the dataset.
 */
export function priorModules(tables: EaglePriorTables, laws: EagleLaws, run: string): PriorModules {
  const head = [
    "// This module is made by `scripts/eaglei-priors.ts` from the artifact `eaglei-laws` of the workflow `hazards-fit`. Do not change it by hand.",
    `// The run of the fit: ${run}.`,
    `// The dataset: EAGLE-I version ${String(laws.source.version)}, modified ${laws.source.modified}, DOI ${laws.source.doi}, read ${laws.read}.`,
    `// The options of the fit: share ${String(laws.options.share ?? DEFAULT_SHARE)}, interval ${String(laws.options.interval)} s.`,
    "// The rates are a derived work of the EAGLE-I dataset (CC BY 4.0) and of the storm events of NOAA (public domain).",
    'import type { PriorTable } from "./hazard.ts";',
    "",
  ];
  return {
    "eaglei-county-priors.ts": [...head, ...tableLines("EAGLEI_COUNTY_PRIORS", "The yearly priors of the power outage and of each storm case in each county, from the outages of EAGLE-I.", tables.county), ""].join("\n"),
    "eaglei-state-priors.ts": [...head, ...tableLines("EAGLEI_STATE_PRIORS", "The yearly priors of the power outage and of each storm case in each state, from the outages of the counties of the state.", tables.state), ""].join("\n"),
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string", default: "src" }, run: { type: "string" } } });
  const file = positionals[0];
  if (file === undefined || values.run === undefined) throw new Error("Usage: node scripts/eaglei-priors.ts <eaglei-laws.json> --run <the URL and the attempt of the fit run> [--out src]");
  const laws = JSON.parse(readFileSync(file, "utf8")) as EagleLaws;
  const tables = eaglePriors(laws);
  for (const [name, text] of Object.entries(priorModules(tables, laws, values.run))) writeFileSync(join(values.out, name), text);
  for (const [name, table] of Object.entries(tables) as [string, PriorTable][]) {
    console.log(`${name}: ${String(table.codes.length)} regions; ${Object.entries(table.rates).map(([code, rates]) => `${code} ${String(Object.keys(rates).length)}`).join(", ")}.`);
  }
}
