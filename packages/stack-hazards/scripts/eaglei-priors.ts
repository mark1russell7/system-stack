import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { AreaUnits, CountyPooling, PoolHoldout, PoolLaw, PoolTimeHoldout, PoolTimeScore, PriorTable, StatePooling } from "../src/hazard.ts";
import { eagleRegion } from "../src/eaglei.ts";
import { areaUnits, observedRegions, pooledRates, pooledTable, PRIOR_LEVEL, PRIOR_LIMIT, rateIntervals, regionCounts, regionObservation, withoutSilentAreas, type AreaCount, type Observation } from "../src/priors.ts";
import { HELD_DAYS, LAWS_SCHEMA, OUTAGE_CASE, type CaseOverlap, type EagleLaws } from "./eaglei-fit.ts";
import { EAGLEI_LICENSE, EAGLEI_SOURCE_ID } from "./eaglei-law.ts";
import { poolHoldout, POOL_HOLDOUT_ROUNDS, POOL_HOLDOUT_SEED, regionPart, splitYears, timeHoldout } from "./eaglei-pooling.ts";

export { PRIOR_LIMIT };

// The step after the fit job: the counts of the priors in the artifact eaglei-laws become the modules
// src/eaglei-county-priors.ts and src/eaglei-state-priors.ts. A person runs this script and commits the modules.
// The law module does not change.

/** The scheme of the codes of the counties: the 5-digit FIPS code. */
export const COUNTY_SCHEME = "us-county-fips";

/** The code of the one group of the states in the pool of the state rates. */
export const NATION_GROUP = "nation";

/** The significant digits of a rate in the module. */
const DIGITS = 4;

/** The tables of the priors of one fit: one for each county, and one for each state that pools its counties. */
export interface EaglePriorTables {
  readonly county: PriorTable;
  readonly state: PriorTable;
  /** The sum of the customers of each observed county: the customers of the nation for a reach. The limit of the tables does not change it. */
  readonly nation: number;
  /** The laws of the pooled rates of the counties, and their holdout. */
  readonly pooling: CountyPooling;
  /** The laws of the pooled rates of the states, and their holdout. */
  readonly statePooling: StatePooling;
  /** The counts of the observed counties, also of a county over the limit of the table. With the laws, they give each pooled rate and its bound. */
  readonly counts: AreaUnits;
  /** The reach of each observed county in each case, in the order of the codes of `counts`. It is the mean peak share of its events, or 0 with no event. */
  readonly reach: Readonly<Record<string, readonly number[]>>;
}

/** The rates of the regions of one case, from the counts of the areas. */
type RatesOf = (name: string, counts: Readonly<Record<string, AreaCount>>, observation: Observation) => Readonly<Record<string, readonly [number, number]>>;

/** The share of the customers of a county that starts an event, when the fit has no option `share`: the default of `outageReader`. */
const DEFAULT_SHARE = 0.01;

/** This function tells that the storm cases overlap, so a sum of their priors counts an outage more than one time. */
const overlapText = (overlap: CaseOverlap | undefined): string =>
  "An outage in the storm events of two cases counts in each case. Thus a sum of the priors of the storm cases counts it two times or more" +
  ". " +
  (overlap === undefined ? "" : `In the fit, ${String(overlap.multiple)} of the ${String(overlap.events)} outages in a storm case are in two cases or more. `) +
  `The case ${OUTAGE_CASE} and one storm case do not overlap. `;

const common = (share: number): string =>
  `An event is a run of the 15-minute counts of a county at or above ${String(share * 100)}% of its customers. A smaller outage is not counted, and that makes a rate too low. ` +
  "One outage that crosses the line more than one time counts more than one time. The years of a county are the calendar years in which the files list it, so a year with no count is not a year of the county. Each of these makes a rate too high. " +
  `The case ${OUTAGE_CASE} counts the outages in no storm case. Each storm case counts the outages that start in a storm event of the case in the county, from the storm events of NOAA.`;

/** This function gives the tables of the priors of a record of a fit. */
export function eaglePriors(laws: EagleLaws): EaglePriorTables {
  if (laws.schema !== LAWS_SCHEMA) throw new RangeError(`eaglePriors: the schema "${String(laws.schema)}" is not "${LAWS_SCHEMA}".`);
  if (laws.source.license !== EAGLEI_LICENSE.name) throw new RangeError(`eaglePriors: the license "${laws.source.license}" is not "${EAGLEI_LICENSE.name}".`);
  const priors = laws.priors;
  // A record of the rule of 4 readings (an earlier fit of this change, not in a release) has raised counties but no days in its peaks. Its raised customers do not follow the rule of 4 days.
  if (laws.raised !== undefined && (laws.peaks === undefined || Object.values(laws.peaks).some((peak) => peak.days === undefined)))
    throw new RangeError("eaglePriors: the record has raised counties but no days in its peaks. A fit of this version uses the rule of 4 days and gives them.");
  if (priors === undefined) throw new RangeError("eaglePriors: the record has no counts of the priors. A fit job of this version gives them.");
  // A county with no event in any case is not observed: its prior is the prior of its state (withoutSilentAreas).
  const quiet = withoutSilentAreas(priors.counts, priors.observation, eagleRegion);
  const observation = quiet.observation;
  const silentText =
    `A county with no event in any case is not observed, so the prior of its state applies: ${String(quiet.silent.length)} counties. ` +
    `The laws of the states expect ${quiet.expected.toPrecision(2)} such counties, and a county that the files do not see has no event too. `;
  const table = (scheme: string, region: (area: string) => string, ratesOf: RatesOf, method: string, intervalsOf?: () => IntervalsOf): PriorTable => {
    const codes = observedRegions(observation, region);
    const rates = Object.fromEntries(Object.entries(priors.counts).map(([name, counts]) => [name, rounded(ratesOf(name, counts, observation))]));
    // A region with a case above the limit is not in the table: its codes and its rates go.
    const over = new Set(
      codes.filter((code) =>
        Object.values(rates).some((entry) => {
          const rate = entry[code];
          return rate !== undefined && rate[0] * rate[1] > PRIOR_LIMIT;
        }),
      ),
    );
    // The customers of a county are the customers of the file, or a count that the county reached on 4 days when the fit has the option raise.
    const raise =
      laws.raised === undefined
        ? ""
        : `The file of the customers gives too few customers to some counties. For ${String(Object.keys(laws.raised).length)} counties, the customers are the count that the county reached on ${String(HELD_DAYS)} different days. `;
    const limit = `A region with more than ${String(PRIOR_LIMIT)} events at one customer in one year in a case is not in the table, so its prior is no read: ${String(over.size)} regions.`;
    const kept = Object.fromEntries(Object.entries(rates).map(([name, entry]) => [name, Object.fromEntries(Object.entries(entry).filter(([code]) => !over.has(code)))]));
    const ends = intervalsOf?.();
    return {
      source: EAGLEI_SOURCE_ID,
      asOf: laws.source.modified.slice(0, 10),
      scheme,
      method: `${method} ${common(laws.options.share ?? DEFAULT_SHARE)} ${overlapText(priors.overlap)}${raise}${silentText}${limit}`,
      codes: codes.filter((code) => !over.has(code)),
      rates: kept,
      ...(ends === undefined ? {} : { intervals: { level: PRIOR_LEVEL, rates: keptEnds(kept, ends) } }),
    };
  };
  // Each state is an area of the one group of the nation: its events over the plain mean of the years of its counties.
  const states = regionObservation(observation, eagleRegion);
  const stateCounts = Object.fromEntries(Object.entries(priors.counts).map(([name, counts]) => [name, regionCounts(counts, observation, eagleRegion)]));
  const nationGroup = (): string => NATION_GROUP;
  const statePooled = Object.fromEntries(Object.entries(stateCounts).map(([name, counts]) => [name, pooledRates(counts, states, nationGroup)]));
  // The interval of each state rate comes from the same law of the nation as the rate.
  const stateIntervals = (): IntervalsOf => rateIntervals(areaUnits(stateCounts, states), (name) => statePooled[name]?.laws[NATION_GROUP], PRIOR_LEVEL);
  const state = table(
    laws.scheme,
    eagleRegion,
    (name) => statePooled[name]?.rates ?? {},
    "perYear is the pooled rate of a state toward the states of the nation: a gamma law of the rates of the states in the case, and the mean of the rate of the state after its events. " +
      "The events of a state are the events of its counties, and its years are the plain mean of the years of its counties. A state with no event of a case gets a rate near 0, not 0. " +
      "reach is the mean share of the customers of the state that one event reaches, so perYear * reach is the expected events at one customer in one year. A state with no event gets the plain mean of the reach of the states with events. " +
      `Each rate has its ${String(PRIOR_LEVEL * 100)}% interval: the quantiles of the same gamma law after the events of the state.`,
    stateIntervals,
  );
  // Each observed county, also in a state that the limit keeps out of the table: a later fit cannot change the reach of a national prior through the limit.
  const nation = observedRegions(observation, (area) => area).reduce((sum, area) => sum + (observation.customers[area] ?? 0), 0);
  // The holdout over time: the early years fit, and the later years score. A record of a fit before 0.6.8 has no counts of each year, so it has no such holdout.
  const split = priors.yearly === undefined ? undefined : splitYears(priors.yearly, observation);
  const stateSplit = split === undefined ? undefined : { ...split, fit: regionPart(split.fit), score: regionPart(split.score) };
  const pooled = Object.fromEntries(Object.entries(priors.counts).map(([name, counts]) => [name, pooledRates(counts, observation, eagleRegion)]));
  const county = table(
    COUNTY_SCHEME,
    (area) => area,
    (name) => pooled[name]?.rates ?? {},
    "perYear is the pooled rate of a county toward the counties of its state: a gamma law of the rates of the counties of the state in the case, and the mean of the rate of the county after its events in its years. " +
      "A county with few years or few events gets a rate near the mean of its state. A state with no event in a case gets its pooled rate toward the states with events. " +
      "reach is the mean of the largest count of customers out of each event over the customers of the county. A county with no event gets the plain mean of the reach of the counties of its state with events. " +
      "In a state with no event, it gets the plain mean of the reach of all counties with events in the case. A county over the limit is in the laws and in the holdout, but not in the table. " +
      `Each rate has its ${String(PRIOR_LEVEL * 100)}% interval: the quantiles of the same gamma law after the events of the county.`,
  );
  return {
    county,
    state,
    nation,
    counts: areaUnits(priors.counts, observation),
    reach: reachOf(priors.counts, areaUnits(priors.counts, observation).codes),
    pooling: {
      laws: Object.fromEntries(Object.entries(pooled).map(([name, entry]) => [name, entry.laws])),
      holdout: poolHoldout({ ...priors, observation }),
      time: split === undefined ? undefined : timeHoldout(split),
      silent: { areas: quiet.silent.length, expected: quiet.expected },
    },
    statePooling: {
      laws: Object.fromEntries(Object.entries(statePooled).map(([name, entry]) => [name, entry.laws[NATION_GROUP] ?? { shape: Number.POSITIVE_INFINITY, mean: 0, areas: 0, events: 0, from: "group" }])),
      holdout: poolHoldout({ observation: states, counts: stateCounts }, POOL_HOLDOUT_SEED, POOL_HOLDOUT_ROUNDS, nationGroup),
      time: stateSplit === undefined ? undefined : timeHoldout(stateSplit, nationGroup),
    },
  };
}

/** This function gives the reach of each area in each case, in the order of `codes`. It is the mean peak share of its events, or 0 with no event. */
function reachOf(counts: Readonly<Record<string, Readonly<Record<string, AreaCount>>>>, codes: readonly string[]): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(counts).map(([name, entry]) => [
      name,
      codes.map((code) => {
        const count = entry[code];
        return count !== undefined && count.events > 0 ? count.share / count.events : 0;
      }),
    ]),
  );
}

/**
 * This function is the gate of the county module: `pooledTable` of the rounded counts, laws and reach gives the table of the fit.
 * The codes and the keys of the rates are the same. Each value has the same 4 significant digits, less the error of the rounding of the laws.
 *
 * @throws RangeError when the made table is not the table of the fit
 */
function checkMadeTable(made: PriorTable, fit: PriorTable): void {
  if (JSON.stringify(made.codes) !== JSON.stringify(fit.codes)) throw new RangeError("priorModules: the made table of the counties does not have the codes of the fit. The limit moved a county.");
  for (const [name, entry] of Object.entries(fit.rates)) {
    const madeEntry = made.rates[name] ?? {};
    if (JSON.stringify(Object.keys(madeEntry)) !== JSON.stringify(Object.keys(entry))) throw new RangeError(`priorModules: the made table of the counties does not have the rates of the fit in the case ${name}.`);
    for (const [code, rate] of Object.entries(entry)) {
      const madeRate = madeEntry[code] ?? [0, 0];
      if (rate.some((value, at) => Math.abs((madeRate[at] ?? 0) / value - 1) > MADE_TOLERANCE)) {
        throw new RangeError(`priorModules: the made rate of ${code} in the case ${name} is ${JSON.stringify(madeRate)}, not ${JSON.stringify(rate)}.`);
      }
    }
  }
}

/** The most relative change of a rate of the table from the rounding of the laws and the reach to `DIGITS` digits. */
const MADE_TOLERANCE = 2e-3;

/** The interval of each rate of each area in each case, by the code of the case and the code of the area (`rateIntervals`). */
type IntervalsOf = Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>>;

/** This function gives the intervals of the kept rates of a table only, with `DIGITS` significant digits. Rounding keeps the order of the low end and the rate. */
function keptEnds(rates: PriorTable["rates"], ends: IntervalsOf): Record<string, Record<string, readonly [number, number]>> {
  return Object.fromEntries(
    Object.entries(rates).map(([name, entry]) => [
      name,
      Object.fromEntries(Object.keys(entry).map((code) => {
        const pair = ends[name]?.[code];
        if (pair === undefined) throw new RangeError(`eaglePriors: the rate of ${code} in the case ${name} has no interval.`);
        return [code, [digits(pair[0]), digits(pair[1])] as const];
      })),
    ]),
  );
}

/** This function gives the rates with `DIGITS` significant digits. */
function rounded(rates: Readonly<Record<string, readonly [number, number]>>): Record<string, readonly [number, number]> {
  return Object.fromEntries(Object.entries(rates).map(([code, [perYear, reach]]) => [code, [Number(perYear.toPrecision(DIGITS)), Number(reach.toPrecision(DIGITS))]]));
}

/** This function gives the lines of a table, with the codes on one line and the rates of each case on one line. */
function tableLines(name: string, doc: string, table: PriorTable): string[] {
  const { rates, codes, intervals, ...head } = table;
  return [
    `/** ${doc} */`,
    `export const ${name}: PriorTable = {`,
    ...Object.entries(head).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`),
    `  codes: ${JSON.stringify(codes)},`,
    "  rates: {",
    ...pairLines(rates),
    "  },",
    ...(intervals === undefined ? [] : ["  intervals: {", `    level: ${JSON.stringify(intervals.level)},`, "    rates: {", ...pairLines(intervals.rates, "      "), "    },", "  },"]),
    "};",
  ];
}

/** This function gives one line for each case of a record of pairs, with the pairs of its regions on the line. */
function pairLines(pairs: PriorTable["rates"], indent = "    "): string[] {
  return Object.entries(pairs).map(([code, entry]) => `${indent}${JSON.stringify(code)}: {${Object.entries(entry).map(([region, pair]) => `${JSON.stringify(region)}:${JSON.stringify(pair)}`).join(",")}},`);
}

/** This function gives a value as a literal of TypeScript: JSON, with `Infinity` and `-Infinity`, which JSON does not have. */
function literal(value: unknown): string {
  const mark = "@infinity@";
  const text = JSON.stringify(value, (_key, item: unknown) => (item === Number.POSITIVE_INFINITY ? `${mark}+` : item === Number.NEGATIVE_INFINITY ? `${mark}-` : item));
  return text.replaceAll(`"${mark}+"`, "Infinity").replaceAll(`"${mark}-"`, "-Infinity");
}

/** This function gives a number with `DIGITS` significant digits. A number that is not finite does not change. */
function digits(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(DIGITS)) : value;
}

/** This function gives a number with one decimal. A number that is not finite does not change. */
function tenth(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : value;
}

/** This function gives a law with `DIGITS` significant digits in its shape and its mean. */
function roundedLaw(law: PoolLaw): PoolLaw {
  return { ...law, shape: digits(law.shape), mean: digits(law.mean) };
}

/** This function gives a holdout with one decimal in each score, and `DIGITS` significant digits in each score of the reach. */
function roundedHoldout(holdout: PoolHoldout): PoolHoldout {
  const cases = Object.fromEntries(
    Object.entries(holdout.cases).map(([name, score]) => [
      name,
      {
        raw: tenth(score.raw),
        pooled: tenth(score.pooled),
        state: tenth(score.state),
        lost: tenth(score.lost),
        squared: { raw: tenth(score.squared.raw), pooled: tenth(score.squared.pooled), state: tenth(score.squared.state) },
        seen: { raw: tenth(score.seen.raw), pooled: tenth(score.seen.pooled), state: tenth(score.seen.state), areas: tenth(score.seen.areas) },
        reach: {
          areas: tenth(score.reach.areas),
          plain: { bias: digits(score.reach.plain.bias), error: digits(score.reach.plain.error) },
          events: { bias: digits(score.reach.events.bias), error: digits(score.reach.events.error) },
        },
      },
    ]),
  );
  return { seed: holdout.seed, rounds: holdout.rounds, cases };
}

/** This function gives a holdout over time with one decimal in each score. A missing holdout stays missing. */
function roundedTime(time: PoolTimeHoldout | undefined): PoolTimeHoldout | undefined {
  if (time === undefined) return undefined;
  const score = (item: PoolTimeScore): PoolTimeScore => ({
    raw: tenth(item.raw),
    pooled: tenth(item.pooled),
    state: tenth(item.state),
    lost: tenth(item.lost),
    squared: { raw: tenth(item.squared.raw), pooled: tenth(item.squared.pooled), state: tenth(item.squared.state) },
    seen: { raw: tenth(item.seen.raw), pooled: tenth(item.seen.pooled), state: tenth(item.seen.state), areas: tenth(item.seen.areas) },
  });
  return { ...time, cases: Object.fromEntries(Object.entries(time.cases).map(([name, item]) => [name, score(item)])) };
}

/** This function gives the pooling with `DIGITS` significant digits in each law and one decimal in each score. Thus a new fit changes few lines. */
function roundedPooling(pooling: CountyPooling): CountyPooling {
  const laws = Object.fromEntries(Object.entries(pooling.laws).map(([name, entry]) => [name, Object.fromEntries(Object.entries(entry).map(([code, law]) => [code, roundedLaw(law)]))]));
  return { laws, holdout: roundedHoldout(pooling.holdout), time: roundedTime(pooling.time), silent: { areas: pooling.silent.areas, expected: digits(pooling.silent.expected) } };
}

/** This function gives the pooling of the states with `DIGITS` significant digits in each law and one decimal in each score. */
function roundedStatePooling(pooling: StatePooling): StatePooling {
  return { laws: Object.fromEntries(Object.entries(pooling.laws).map(([name, law]) => [name, roundedLaw(law)])), holdout: roundedHoldout(pooling.holdout), time: roundedTime(pooling.time) };
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
  const pooling = roundedPooling(tables.pooling);
  const statePooling = roundedStatePooling(tables.statePooling);
  const reach = Object.fromEntries(Object.entries(tables.reach).map(([name, values]) => [name, values.map(digits)]));
  const { codes: _codes, rates: _rates, ...countyHead } = tables.county;
  checkMadeTable(pooledTable({ head: countyHead, units: tables.counts, laws: pooling.laws, reach, group: eagleRegion, limit: PRIOR_LIMIT, level: PRIOR_LEVEL }), tables.county);
  return {
    "eaglei-county-priors.ts": [
      ...head.slice(0, -2),
      'import { eagleRegion } from "./eaglei.ts";',
      'import type { AreaUnits, CountyPooling, PriorTable } from "./hazard.ts";',
      'import { pooledTable, PRIOR_LEVEL, PRIOR_LIMIT } from "./priors.ts";',
      "",
      "/**",
      " * The gamma law of the rates of the counties of each state in each case. The holdout compares the pooled rates with the raw rates and the state rates.",
      " * The holdout `holdout` splits the events of each county by thinning. The holdout `time` fits the early years and scores the later years.",
      " */",
      "export const EAGLEI_COUNTY_POOLING: CountyPooling = {",
      `  holdout: ${literal(pooling.holdout)},`,
      ...(pooling.time === undefined ? [] : [`  time: ${literal(pooling.time)},`]),
      `  silent: ${literal(pooling.silent)},`,
      "  laws: {",
      ...Object.entries(pooling.laws).map(([name, entry]) => `    ${JSON.stringify(name)}: ${literal(entry)},`),
      "  },",
      "};",
      "",
      "/**",
      " * The counts of the observed counties of the fit. The arrays give the years of each county and the events of each case in each county, in the order of `codes`.",
      " * With the laws of `EAGLEI_COUNTY_POOLING`, they give each pooled rate of the table and its upper bound (`upperRates`). A county over the limit of the table is here too.",
      " */",
      "export const EAGLEI_COUNTY_COUNTS: AreaUnits = {",
      `  codes: ${JSON.stringify(tables.counts.codes)},`,
      `  years: ${JSON.stringify(tables.counts.years)},`,
      "  events: {",
      ...Object.entries(tables.counts.events).map(([name, events]) => `    ${JSON.stringify(name)}: ${JSON.stringify(events)},`),
      "  },",
      "};",
      "",
      "/** The reach of each observed county in each case, in the order of the codes of `EAGLEI_COUNTY_COUNTS`. It is the mean peak share of its events, or 0 with no event. */",
      "export const EAGLEI_COUNTY_REACH: Readonly<Record<string, readonly number[]>> = {",
      ...Object.entries(reach).map(([name, values]) => `  ${JSON.stringify(name)}: ${JSON.stringify(values)},`),
      "};",
      "",
      "/**",
      " * The yearly priors of the power outage and of each storm case in each county, from the outages of EAGLE-I.",
      " * The import makes the table from the counts, the laws and the reach (`pooledTable`). Thus the table cannot differ from them.",
      " */",
      "export const EAGLEI_COUNTY_PRIORS: PriorTable = pooledTable({",
      `  head: ${JSON.stringify(countyHead)},`,
      "  units: EAGLEI_COUNTY_COUNTS,",
      "  laws: EAGLEI_COUNTY_POOLING.laws,",
      "  reach: EAGLEI_COUNTY_REACH,",
      "  group: eagleRegion,",
      "  limit: PRIOR_LIMIT,",
      "  level: PRIOR_LEVEL,",
      "});",
      "",
    ].join("\n"),
    "eaglei-state-priors.ts": [
      ...head.slice(0, -2),
      'import type { PriorTable, StatePooling } from "./hazard.ts";',
      "",
      ...tableLines("EAGLEI_STATE_PRIORS", "The yearly priors of the power outage and of each storm case in each state, from the outages of the counties of the state.", tables.state),
      "",
      "/**",
      " * The gamma law of the rates of the states in each case. The holdout compares the pooled rates with the raw rates and the rate of the nation.",
      " * The holdout `holdout` splits the events of each state by thinning. The holdout `time` fits the early years and scores the later years.",
      " */",
      "export const EAGLEI_STATE_POOLING: StatePooling = {",
      `  holdout: ${literal(statePooling.holdout)},`,
      ...(statePooling.time === undefined ? [] : [`  time: ${literal(statePooling.time)},`]),
      `  laws: ${literal(statePooling.laws)},`,
      "};",
      "",
      "/** The sum of the customers of each observed county of the fit, also in a state over the limit of the table. A table of priors for the nation divides by it for a reach. */",
      `export const EAGLEI_NATION_CUSTOMERS = ${String(tables.nation)};`,
      "",
    ].join("\n"),
  };
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: "string", default: "src" }, run: { type: "string" } } });
  const file = positionals[0];
  if (file === undefined || values.run === undefined) throw new Error("Usage: node scripts/eaglei-priors.ts <eaglei-laws.json> --run <the URL and the attempt of the fit run> [--out src]");
  const laws = JSON.parse(readFileSync(file, "utf8")) as EagleLaws;
  const tables = eaglePriors(laws);
  for (const [name, text] of Object.entries(priorModules(tables, laws, values.run))) writeFileSync(join(values.out, name), text);
  for (const [name, table] of [["county", tables.county], ["state", tables.state]] as const) {
    console.log(`${name}: ${String(table.codes.length)} regions; ${Object.entries(table.rates).map(([code, rates]) => `${code} ${String(Object.keys(rates).length)}`).join(", ")}.`);
  }
  console.log(`nation: ${String(tables.nation)} customers.`);
}
