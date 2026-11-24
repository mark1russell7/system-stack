/**
 * The fit job of the laws of EAGLE-I. The workflow `hazards-fit` starts it in CI. The package on npm does not have it.
 *
 * The job reads the record of the figshare article of the dataset, the customers of each county and the outage file of each year.
 * Each request goes through `polite-crawler`, with one pace for each host. A file comes in range requests, and the job examines its MD5.
 * The job gives the counts to `outageReader` and writes the curve of each state to a JSON file.
 * It also writes the counts of the yearly priors: the years and the customers of each county.
 * It also writes the events and the peak shares of each case in each county.
 */
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import { arrayOf, numberOf, recordOf, textOf } from "@mark1russell7/optional/read";
import { fetchTransport, statusLine, type Pace } from "polite-crawler/api";
import { HostScheduler, realClock } from "polite-crawler/politeness";
import { EAGLE_INTERVAL, EAGLE_SCHEME, eagleCustomers, eagleLine, eagleRegion } from "../src/eaglei.ts";
import { outageCurves, type RegionCurve } from "../src/law.ts";
import { outageReader, type OutageCount, type OutageEvent, type OutageRuns, type OutageTally } from "../src/outages.ts";
import { areaCounts, coverageTally, regionRates, type AreaCount, type Observation } from "../src/priors.ts";
import { CAUSE_AFTER, CAUSE_BEFORE, STORM_CLASSES, type CauseOptions } from "../src/storms.ts";
import { TryFault, get, passing, withTries, type FitContext } from "./fetch.ts";
import { readStorms, type StormRecord } from "./storm-files.ts";

/** The id of the figshare article of EAGLE-I. */
export const EAGLE_ARTICLE = 24_237_376;
/** The bytes of one range request. */
export const CHUNK_BYTES = 128 * 1024 * 1024;
/** The User-Agent of the job. It names the repository, and no person. */
export const USER_AGENT = "system-stack-hazards/0.1 (+https://github.com/mark1russell7/system-stack)";
/** The name of the format of the output file. */
export const LAWS_SCHEMA = "eaglei-laws/1";

const ARTICLE_URL = `https://api.figshare.com/v2/articles/${String(EAGLE_ARTICLE)}`;
const OUTAGE_FILE = /^eaglei_outages_(\d{4})\.csv$/;
const CUSTOMERS_FILE = "MCC.csv";
const SOURCE = "EAGLE-I on figshare";

/** A file of the article. */
export interface DatasetFile {
  readonly id: number;
  readonly name: string;
  readonly size: number;
  readonly md5: string;
  readonly url: string;
}

/** The files of the article that the job reads, with the version and the license of the article. */
export interface EagleFiles {
  readonly version: number;
  readonly modified: string;
  readonly license: string;
  readonly doi: string;
  readonly customers: DatasetFile;
  readonly years: readonly { readonly year: number; readonly file: DatasetFile }[];
}

function datasetFile(value: unknown): DatasetFile | undefined {
  const id = numberOf(value, "id");
  const name = textOf(value, "name");
  const size = numberOf(value, "size");
  const md5 = textOf(value, "computed_md5");
  const url = textOf(value, "download_url");
  if (id === undefined || name === undefined || size === undefined || md5 === undefined || url === undefined) return undefined;
  return { id, name, size, md5, url };
}

/**
 * This function reads the files of the record of the article. The outage files are in the order of their years.
 *
 * @param article - The record of the article from the figshare API
 * @param years - The test of the years to read
 * @throws Error when the record has no version, date, license, file of the customers or outage file
 */
export function eagleFiles(article: unknown, years: (year: number) => boolean = () => true): EagleFiles {
  const files = arrayOf(article, "files", datasetFile) ?? [];
  const version = numberOf(article, "version");
  const modified = textOf(article, "modified_date");
  const license = textOf(recordOf(article, "license"), "name");
  const doi = textOf(article, "doi") ?? "";
  const customers = files.find((file) => file.name === CUSTOMERS_FILE);
  const list = files
    .flatMap((file) => {
      const year = Number(OUTAGE_FILE.exec(file.name)?.[1]);
      return Number.isInteger(year) && years(year) ? [{ year, file }] : [];
    })
    .sort((a, b) => a.year - b.year);
  if (version === undefined || modified === undefined || license === undefined) throw new Error("eagleFiles: the article has no version, date or license.");
  if (customers === undefined) throw new Error(`eagleFiles: the article has no file ${CUSTOMERS_FILE}.`);
  if (list.length === 0) throw new Error("eagleFiles: the article has no outage file of the years.");
  return { version, modified, license, doi, customers, years: list };
}

/**
 * This function gives the ranges of the bytes of a file, from the first byte to the last byte of each range.
 *
 * @throws RangeError when the size is not an integer of 0 or more, or the bytes of a range are not a positive integer
 */
export function ranges(size: number, bytes: number): [number, number][] {
  if (!(Number.isInteger(size) && size >= 0 && Number.isInteger(bytes) && bytes > 0)) throw new RangeError("ranges: the size or the bytes of a range is wrong.");
  const list: [number, number][] = [];
  for (let start = 0; start < size; start += bytes) list.push([start, Math.min(size, start + bytes) - 1]);
  return list;
}

/** This function gives the bytes of one range of a file, in one try: a fresh redirect, then the range request. */
async function rangeTry(context: FitContext, file: DatasetFile, start: number, end: number): Promise<Uint8Array> {
  const redirect = await get(context, SOURCE, file.url, `the place of ${file.name}`);
  const location = redirect.headers["location"];
  if (passing(redirect.status)) throw new TryFault(`The download of ${file.name} gave ${statusLine(redirect)}.`);
  if (!(redirect.status >= 300 && redirect.status < 400 && location !== undefined)) throw new Error(`The download of ${file.name} gave ${statusLine(redirect)}, not a redirect.`);
  const reply = await get(context, SOURCE, new URL(location, file.url).href, `the bytes ${String(start)} to ${String(end)} of ${file.name}`, { range: `bytes=${String(start)}-${String(end)}` }, "bytes");
  const whole = reply.status === 200 && start === 0 && end === file.size - 1;
  if (passing(reply.status)) throw new TryFault(`The storage gave ${statusLine(reply)} for a range of ${file.name}.`);
  if (reply.status !== 206 && !whole) throw new Error(`The storage gave ${statusLine(reply)} for a range of ${file.name}.`);
  const bytes = reply.bytes ?? new Uint8Array();
  if (bytes.length !== end - start + 1) throw new TryFault(`The storage gave ${String(bytes.length)} bytes for a range of ${String(end - start + 1)} bytes of ${file.name}.`);
  return bytes;
}

/**
 * This function gives the bytes of a file in range requests. Each try of a range has its own redirect, because a signed URL of the storage lasts for seconds only.
 * After the last range, it examines the MD5 of the file.
 *
 * @throws Error when an answer is not a redirect or a part, when a range fails `RANGE_TRIES` times, or when the MD5 is wrong
 */
export async function* fileChunks(context: FitContext, file: DatasetFile): AsyncGenerator<Uint8Array> {
  const hash = createHash("md5");
  for (const [start, end] of ranges(file.size, context.chunkBytes)) {
    const bytes = await withTries(context, `${file.name}, the bytes ${String(start)} to ${String(end)}`, () => rangeTry(context, file, start, end));
    hash.update(bytes);
    yield bytes;
  }
  const md5 = hash.digest("hex");
  if (md5 !== file.md5) throw new Error(`The MD5 of ${file.name} is ${md5}, not ${file.md5}.`);
}

/** This function gives the lines of the text of the chunks. A character of UTF-8 can be in two chunks. */
export async function* linesOf(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const input = Readable.from(chunks, { objectMode: false });
  for await (const line of createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY })) yield line;
}

/** The options of a fit. */
export interface FitOptions {
  /** The test of the years to read. The default reads each year. */
  readonly years?: ((year: number) => boolean) | undefined;
  /** The share of the customers of a county that starts an event. The default is that of `outageReader`. */
  readonly share?: number | undefined;
  /** The join time of `outageReader` in seconds. The default is 0: each run is an event. */
  readonly join?: number | undefined;
  /** More join times. For each, the fit also reads the events and gives their counts, but no curve. */
  readonly sweep?: readonly number[] | undefined;
  /** The time of the read. */
  readonly now: () => Date;
  /**
   * When this option is true, the fit reads the outage files two times. The first read gives the count `held` of each county.
   * The second read uses the larger of the customers of the file and that count as the customers of the county. The default is false.
   */
  readonly raise?: boolean | undefined;
  /** The event types of each case and the margins in time. With this option, the fit also gives the curves of each case. */
  readonly storms?: { readonly classes: Readonly<Record<string, readonly string[]>>; readonly options?: CauseOptions | undefined } | undefined;
}

/** The curves of the outages of each case. An outage is in a case when a storm event of the case covers its county at its start. */
export interface CauseLaws {
  readonly storms: StormRecord;
  readonly options: { readonly before: number; readonly after: number };
  readonly cases: Readonly<Record<string, { readonly types: readonly string[]; readonly events: number; readonly regions: Readonly<Record<string, RegionCurve>> }>>;
}

/**
 * The most events at one customer in one year (perYear * reach) that a region of a table can have in one case: one a
 * month. For the United States as a whole, the utilities report one or two interruptions a year at a customer to EIA.
 * The method of the table is not reliable above the limit. An example of a fault is one outage that crosses the line
 * of an event many times. A true rate can also be above the limit, for example in Puerto Rico. Such a region is not
 * in the table, so its prior is no read. The measures are not the same. EIA counts each interruption of more than 5
 * minutes at a customer. The table counts the events of a county at 1% or more of its customers. So the comparison
 * holds only for the order of the number.
 */
export const PRIOR_LIMIT = 12;

/** The join times of the sweep of the workflow, in seconds: none, 1 hour, 4 hours, 12 hours and 24 hours. */
export const JOIN_SWEEP: readonly number[] = [0, 3600, 4 * 3600, 12 * 3600, 24 * 3600];

/** The events of the fit with one join time of the option `sweep`. The counts are over all events, in no case. */
export interface JoinSweep {
  readonly join: number;
  readonly events: number;
  readonly joined: number;
  readonly truncated: number;
  /** The median of the events at one customer in one year (perYear * reach), over the counties with an event. A county with no event has no rate. */
  readonly median: number;
  /** The largest of these rates, and its county. */
  readonly most: { readonly area: string; readonly rate: number } | undefined;
  /** The counties with a rate above `PRIOR_LIMIT`. */
  readonly over: number;
}

/** The code of the case of a power outage. Its prior counts the events in no storm case, so that a storm outage counts in one case only. */
export const OUTAGE_CASE = "infra.power.outage";

/** The counts of the yearly priors of a fit. */
export interface EaglePriors {
  /** The years in which the files list each county, and the customers of each county. */
  readonly observation: Observation;
  /** The counts of each case in each county with customers, by the code of the case. */
  readonly counts: Readonly<Record<string, Readonly<Record<string, AreaCount>>>>;
}

/** The output of a fit: the source, the options, the counts and the curve of each state. */
export interface EagleLaws {
  readonly schema: typeof LAWS_SCHEMA;
  readonly source: {
    readonly article: number;
    readonly version: number;
    readonly modified: string;
    readonly license: string;
    readonly doi: string;
    readonly files: readonly Omit<DatasetFile, "url">[];
  };
  readonly read: string;
  readonly options: { readonly share: number | undefined; readonly interval: number; readonly join?: number | undefined; readonly raise?: boolean | undefined };
  readonly scheme: typeof EAGLE_SCHEME;
  readonly lines: number;
  readonly skipped: number;
  readonly tally: OutageTally;
  readonly events: number;
  readonly regions: Readonly<Record<string, RegionCurve>>;
  readonly causes?: CauseLaws | undefined;
  /** The counts of the yearly priors. A record of a fit before them does not have them. */
  readonly priors?: EaglePriors | undefined;
  /** The counts of the events with each join time of the option `sweep`. */
  readonly sweep?: readonly JoinSweep[] | undefined;
  /** The largest count of each county, and the times that its count is above its customers. A record of a fit before them does not have them. */
  readonly peaks?: Readonly<Record<string, CountyPeak>> | undefined;
  /** The counties whose customers the option `raise` changed: the customers of the file and the customers of the fit. A record of a fit before them does not have them. */
  readonly raised?: Readonly<Record<string, CustomerRaise>> | undefined;
}

/** The customers of a county in the file of the customers, and the customers that the fit uses in place of them. */
export interface CustomerRaise {
  readonly file: number;
  readonly fit: number;
}

/**
 * This function gives the customers of each county for a fit with the option `raise`.
 * They are the larger of the customers of the file and the count `held`.
 * A count of 4 readings is a lower bound of the customers of a county, because each count out counts customers.
 * A county that is not in the file stays out of it, as in a fit without the option.
 */
export function raiseCustomers(file: ReadonlyMap<string, number>, peaks: Readonly<Record<string, CountyPeak>>): { customers: Map<string, number>; raised: Record<string, CustomerRaise> } {
  const customers = new Map(file);
  const raised: Record<string, CustomerRaise> = {};
  for (const [area, total] of [...file].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const held = peaks[area]?.held ?? 0;
    if (held > total) {
      customers.set(area, held);
      raised[area] = { file: total, fit: held };
    }
  }
  return { customers, raised };
}

/** The largest counts out of a county, and the number of its counts above its customers in the file of the customers. */
export interface CountyPeak {
  /** The largest count. One bad line can give it. */
  readonly peak: number;
  /** The largest count that `HELD_READINGS` readings or more reach: the count at that place from the top. It is 0 for a county with fewer readings. */
  readonly held: number;
  readonly over: number;
}

/** The number of readings that a count `held` must have at or above it. */
export const HELD_READINGS = 4;

/**
 * This function gives a tally of the largest count out of each county.
 * A count above the customers of the county shows that the file of the customers gives too few customers for that county.
 * A county with no customers in the file has a peak and no count above its customers.
 */
export function peakTally(customers: ReadonlyMap<string, number>): { add(count: OutageCount): void; peaks(): Record<string, CountyPeak> } {
  // The largest counts of each county, the largest first, no more than HELD_READINGS of them.
  const peaks = new Map<string, { top: number[]; over: number }>();
  return {
    add(count) {
      if (count.out === undefined) return;
      const entry = peaks.get(count.area) ?? { top: [], over: 0 };
      const { top } = entry;
      if (top.length < HELD_READINGS || count.out > (top[top.length - 1] ?? 0)) {
        let index = top.length;
        while (index > 0 && (top[index - 1] ?? 0) < count.out) index -= 1;
        top.splice(index, 0, count.out);
        if (top.length > HELD_READINGS) top.pop();
      }
      const total = customers.get(count.area);
      if (total !== undefined && count.out > total) entry.over += 1;
      peaks.set(count.area, entry);
    },
    peaks: () =>
      Object.fromEntries(
        [...peaks].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([area, { top, over }]) => [area, { peak: top[0] ?? 0, held: top.length < HELD_READINGS ? 0 : (top[HELD_READINGS - 1] ?? 0), over }]),
      ),
  };
}

/**
 * This function gives a table in Markdown of the counties with a count above their customers, with no more than `most` rows.
 * The order is by the count `held` over the customers, the largest first, and then by the code of the county.
 */
export function peaksTable(laws: EagleLaws, most = 40): string {
  const customers = laws.priors?.observation.customers ?? {};
  // With the option raise, the customers of the priors are the customers of the fit. The table compares each count with the customers of the file.
  const rows = Object.entries(laws.peaks ?? {})
    .filter(([, entry]) => entry.over > 0)
    .map(([area, entry]) => ({ area, ...entry, customers: laws.raised?.[area]?.file ?? customers[area] ?? 0 }))
    .sort((a, b) => b.held / Math.max(b.customers, 1) - a.held / Math.max(a.customers, 1) || (a.area < b.area ? -1 : 1));
  const lines = rows.slice(0, most).map((row) => `| ${row.area} | ${String(row.customers)} | ${String(row.peak)} | ${String(row.held)} | ${String(row.over)} |`);
  const head = `| County | Customers | Largest count | Count of ${String(HELD_READINGS)} readings | Counts above the customers |`;
  const raised = laws.raised === undefined ? "" : ` The fit uses the count of ${String(HELD_READINGS)} readings as the customers of ${String(Object.keys(laws.raised).length)} counties.`;
  return [`${String(rows.length)} counties have a count above their customers.${raised}`, "", head, "| --- | --- | --- | --- | --- |", ...lines].join("\n");
}

/** This function gives the counts of the events of one join time. */
export function joinSweep(join: number, runs: OutageRuns, observation: Observation, customers: ReadonlyMap<string, number>): JoinSweep {
  const rates = Object.entries(regionRates(areaCounts(runs.events, customers), observation, (area) => area)).map(([area, [perYear, reach]]) => ({ area, rate: perYear * reach }));
  const sorted = rates.map((item) => item.rate).sort((a, b) => a - b);
  const middle = sorted.length / 2;
  const median = sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? (sorted[Math.floor(middle)] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  const most = rates.reduce<JoinSweep["most"]>((best, item) => (best === undefined || item.rate > best.rate ? item : best), undefined);
  return { join, events: runs.events.length, joined: runs.tally.joined, truncated: runs.tally.truncated, median, most, over: rates.filter((item) => item.rate > PRIOR_LIMIT).length };
}

/** This function reads the storm events of the years of the outage files and of the year before them. It gives the curves of each case. */
async function causeLaws(
  context: FitContext,
  events: readonly OutageEvent[],
  years: readonly { readonly year: number }[],
  storms: NonNullable<FitOptions["storms"]>,
): Promise<{ laws: CauseLaws; lists: ReadonlyMap<string, readonly OutageEvent[]> }> {
  const first = years[0]?.year ?? 0;
  const last = years.at(-1)?.year ?? 0;
  const before = storms.options?.before ?? CAUSE_BEFORE;
  const after = storms.options?.after ?? CAUSE_AFTER;
  const { index, record } = await readStorms(context, (year) => year >= first - 1 && year <= last, storms.classes, { before, after });
  const lists = new Map<string, OutageEvent[]>(Object.keys(storms.classes).map((name) => [name, []]));
  for (const event of events) for (const name of index.causes(event)) lists.get(name)?.push(event);
  const cases = Object.fromEntries([...lists].map(([name, list]) => [name, { types: storms.classes[name] ?? [], events: list.length, regions: outageCurves(list, eagleRegion) }]));
  return { laws: { storms: { ...record, tally: index.tally() }, options: { before, after }, cases }, lists };
}

/**
 * This function reads the files of EAGLE-I and gives the curve of the durations of the outages of each state.
 *
 * @throws Error when a request fails, or when a file is not complete or has a wrong MD5
 */
export async function fitEagle(context: FitContext, options: FitOptions): Promise<EagleLaws> {
  const record = await get(context, SOURCE, ARTICLE_URL, "the record of the article");
  if (record.status !== 200) throw new Error(`The figshare API gave ${statusLine(record)} for the record of the article.`);
  const files = eagleFiles(JSON.parse(record.body), options.years);
  const parts: Uint8Array[] = [];
  for await (const bytes of fileChunks(context, files.customers)) parts.push(bytes);
  const fileCustomers = eagleCustomers(Buffer.concat(parts).toString("utf8"));
  // The peaks compare each count with the customers of the file, also with the option raise.
  const peaks = peakTally(fileCustomers);
  let customers: ReadonlyMap<string, number> = fileCustomers;
  let raised: Record<string, CustomerRaise> | undefined;
  if (options.raise === true) {
    for (const { file } of files.years) {
      context.log(`${file.name}: the first read, for the count of 4 readings of each county`);
      for await (const line of linesOf(fileChunks(context, file))) {
        const count = eagleLine(line);
        if (count !== undefined) peaks.add(count);
      }
    }
    ({ customers, raised } = raiseCustomers(fileCustomers, peaks.peaks()));
    context.log(`${String(Object.keys(raised).length)} counties have more customers than the file gives.`);
  }
  const reader = outageReader({ customers, share: options.share, join: options.join });
  const joins = [options.join ?? 0, ...(options.sweep ?? []).filter((join) => join !== (options.join ?? 0))];
  const coverage = coverageTally();
  let lines = 0;
  let skipped = 0;
  for (const { file } of files.years) {
    context.log(`${file.name}: ${String(Math.round(file.size / 1e6))} MB`);
    for await (const line of linesOf(fileChunks(context, file))) {
      lines += 1;
      const count = eagleLine(line);
      if (count === undefined) skipped += 1;
      else {
        reader.add(count);
        coverage.add(count);
        if (options.raise !== true) peaks.add(count);
      }
    }
  }
  const results = reader.finishEach(joins);
  const main = results[0];
  if (main === undefined) throw new Error("fitEagle: the reader gave no result.");
  const { events, tally } = main;
  const causes = options.storms === undefined ? undefined : await causeLaws(context, events, files.years, options.storms);
  const inCase = new Set([...(causes?.lists.values() ?? [])].flat());
  const counts: Record<string, Readonly<Record<string, AreaCount>>> = { [OUTAGE_CASE]: areaCounts(events.filter((event) => !inCase.has(event)), customers) };
  for (const [name, list] of causes?.lists ?? []) counts[name] = areaCounts(list, customers);
  const priors: EaglePriors = { observation: { years: Object.fromEntries(coverage.years()), customers: Object.fromEntries(customers) }, counts };
  const sweep =
    options.sweep === undefined
      ? undefined
      : joins.map((join, index) => ({ join, runs: results[index] ?? main }))
          .sort((a, b) => a.join - b.join)
          .map(({ join, runs }) => joinSweep(join, runs, priors.observation, customers));
  const { version, modified, license, doi } = files;
  return {
    schema: LAWS_SCHEMA,
    source: { article: EAGLE_ARTICLE, version, modified, license, doi, files: [files.customers, ...files.years.map((entry) => entry.file)].map(({ url: _, ...file }) => file) },
    read: options.now().toISOString(),
    options: { share: options.share, interval: EAGLE_INTERVAL, join: options.join, raise: options.raise },
    scheme: EAGLE_SCHEME,
    lines,
    skipped,
    tally,
    events: events.length,
    regions: outageCurves(events, eagleRegion),
    causes: causes?.laws,
    priors,
    sweep,
    peaks: peaks.peaks(),
    raised,
  };
}

/** This function gives a table in Markdown of the curve of each state: the events, the censored events, the median and the open chance. */
export function lawsTable(laws: EagleLaws): string {
  const minutes = (days: number | undefined): string => (days === undefined ? "none" : String(Math.round(days * 1440)));
  const rows = Object.entries(laws.regions).map(([code, curve]) => `| ${code} | ${String(curve.count)} | ${String(curve.censored)} | ${minutes(curve.median)} | ${curve.open.toFixed(4)} |`);
  return ["| State | Events | Censored | Median (minutes) | Open |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
}

/** This function gives a table in Markdown of the events and the states with a curve of each case, then the counts of Storm Events. */
export function causesTable(causes: CauseLaws): string {
  const rows = Object.entries(causes.cases).map(([name, entry]) => `| ${name} | ${String(entry.events)} | ${String(Object.keys(entry.regions).length)} |`);
  const { lines, skipped, tally } = causes.storms;
  const counts = `Storm Events: ${String(lines)} lines, ${String(skipped)} skipped, ${String(tally.placed)} rows of a case in a county, ${String(tally.unplaced)} rows of a case in no county.`;
  return ["| Case | Events | States |", "| --- | --- | --- |", ...rows, "", counts].join("\n");
}

/** This function gives a table in Markdown of the sweep of join times: the events, the joined runs and the rates of the counties. */
export function sweepTable(sweep: readonly JoinSweep[]): string {
  const rows = sweep.map((row) => `| ${String(row.join / 3600)} | ${String(row.events)} | ${String(row.joined)} | ${String(row.truncated)} | ${row.median.toFixed(3)} | ${row.most === undefined ? "none" : `${row.most.area} ${row.most.rate.toFixed(1)}`} | ${String(row.over)} |`);
  return ["| Join (hours) | Events | Joined runs | Runs with no start | Median rate | Largest rate | Counties over the limit |", "| --- | --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
}

/** This function reads the years of the option `--years`: one year, or a range, for example `2014-2025`. */
export function yearsOf(text: string): (year: number) => boolean {
  const match = /^(\d{4})(?:-(\d{4}))?$/.exec(text.trim());
  if (match === null) throw new RangeError(`The years "${text}" are not one year or a range of years.`);
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  return (year) => year >= from && year <= to;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { years: { type: "string", default: "2014-2030" }, out: { type: "string", default: "out/eaglei-laws.json" }, share: { type: "string" }, join: { type: "string" }, sweep: { type: "boolean", default: false }, raise: { type: "boolean", default: false } } });
  const pace: Pace = { scheduler: new HostScheduler(realClock, 1), now: realClock.now };
  const context: FitContext = { pace, transport: fetchTransport({ userAgent: USER_AGENT, timeoutMs: 600_000 }), chunkBytes: CHUNK_BYTES, log: (line) => console.log(line) };
  const laws = await fitEagle(context, { years: yearsOf(values.years), share: values.share === undefined ? undefined : Number(values.share), join: values.join === undefined ? undefined : Number(values.join), sweep: values.sweep ? JOIN_SWEEP : undefined, raise: values.raise, now: () => new Date(), storms: { classes: STORM_CLASSES } });
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(laws, null, 2)}\n`);
  const summary = `${String(laws.lines)} lines, ${String(laws.events)} events, ${String(laws.tally.truncated)} runs with no start, ${String(laws.tally.unknown)} counts of unknown counties.\n\n${lawsTable(laws)}\n${laws.causes === undefined ? "" : `\n${causesTable(laws.causes)}\n`}${laws.sweep === undefined ? "" : `\n${sweepTable(laws.sweep)}\n`}\n${peaksTable(laws)}\n`;
  console.log(summary);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") appendFileSync(file, `## The laws of EAGLE-I\n\n${summary}`);
}
