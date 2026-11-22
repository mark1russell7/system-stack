/**
 * The fit job of the laws of EAGLE-I. The workflow `hazards-fit` starts it in CI. The package on npm does not have it.
 *
 * The job reads the record of the figshare article of the dataset, the customers of each county and the outage file of each year.
 * Each request goes through `polite-crawler`, with one pace for each host. A file comes in range requests, and the job examines its MD5.
 * The job gives the counts to `outageReader` and writes the curve of each state to a JSON file.
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
import { outageReader, type OutageEvent, type OutageTally } from "../src/outages.ts";
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
  /** The time of the read. */
  readonly now: () => Date;
  /** The event types of each case and the margins in time. With this option, the fit also gives the curves of each case. */
  readonly storms?: { readonly classes: Readonly<Record<string, readonly string[]>>; readonly options?: CauseOptions | undefined } | undefined;
}

/** The curves of the outages of each case. An outage is in a case when a storm event of the case covers its county at its start. */
export interface CauseLaws {
  readonly storms: StormRecord;
  readonly options: { readonly before: number; readonly after: number };
  readonly cases: Readonly<Record<string, { readonly types: readonly string[]; readonly events: number; readonly regions: Readonly<Record<string, RegionCurve>> }>>;
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
  readonly options: { readonly share: number | undefined; readonly interval: number };
  readonly scheme: typeof EAGLE_SCHEME;
  readonly lines: number;
  readonly skipped: number;
  readonly tally: OutageTally;
  readonly events: number;
  readonly regions: Readonly<Record<string, RegionCurve>>;
  readonly causes?: CauseLaws | undefined;
}

/** This function reads the storm events of the years of the outage files and of the year before them. It gives the curves of each case. */
async function causeLaws(context: FitContext, events: readonly OutageEvent[], years: readonly { readonly year: number }[], storms: NonNullable<FitOptions["storms"]>): Promise<CauseLaws> {
  const first = years[0]?.year ?? 0;
  const last = years.at(-1)?.year ?? 0;
  const before = storms.options?.before ?? CAUSE_BEFORE;
  const after = storms.options?.after ?? CAUSE_AFTER;
  const { index, record } = await readStorms(context, (year) => year >= first - 1 && year <= last, storms.classes, { before, after });
  const lists = new Map<string, OutageEvent[]>(Object.keys(storms.classes).map((name) => [name, []]));
  for (const event of events) for (const name of index.causes(event)) lists.get(name)?.push(event);
  const cases = Object.fromEntries([...lists].map(([name, list]) => [name, { types: storms.classes[name] ?? [], events: list.length, regions: outageCurves(list, eagleRegion) }]));
  return { storms: { ...record, tally: index.tally() }, options: { before, after }, cases };
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
  const reader = outageReader({ customers: eagleCustomers(Buffer.concat(parts).toString("utf8")), share: options.share });
  let lines = 0;
  let skipped = 0;
  for (const { file } of files.years) {
    context.log(`${file.name}: ${String(Math.round(file.size / 1e6))} MB`);
    for await (const line of linesOf(fileChunks(context, file))) {
      lines += 1;
      const count = eagleLine(line);
      if (count === undefined) skipped += 1;
      else reader.add(count);
    }
  }
  const { events, tally } = reader.finish();
  const causes = options.storms === undefined ? undefined : await causeLaws(context, events, files.years, options.storms);
  const { version, modified, license, doi } = files;
  return {
    schema: LAWS_SCHEMA,
    source: { article: EAGLE_ARTICLE, version, modified, license, doi, files: [files.customers, ...files.years.map((entry) => entry.file)].map(({ url: _, ...file }) => file) },
    read: options.now().toISOString(),
    options: { share: options.share, interval: EAGLE_INTERVAL },
    scheme: EAGLE_SCHEME,
    lines,
    skipped,
    tally,
    events: events.length,
    regions: outageCurves(events, eagleRegion),
    causes,
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

/** This function reads the years of the option `--years`: one year, or a range, for example `2014-2025`. */
export function yearsOf(text: string): (year: number) => boolean {
  const match = /^(\d{4})(?:-(\d{4}))?$/.exec(text.trim());
  if (match === null) throw new RangeError(`The years "${text}" are not one year or a range of years.`);
  const from = Number(match[1]);
  const to = Number(match[2] ?? match[1]);
  return (year) => year >= from && year <= to;
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { years: { type: "string", default: "2014-2030" }, out: { type: "string", default: "out/eaglei-laws.json" }, share: { type: "string" } } });
  const pace: Pace = { scheduler: new HostScheduler(realClock, 1), now: realClock.now };
  const context: FitContext = { pace, transport: fetchTransport({ userAgent: USER_AGENT, timeoutMs: 600_000 }), chunkBytes: CHUNK_BYTES, log: (line) => console.log(line) };
  const laws = await fitEagle(context, { years: yearsOf(values.years), share: values.share === undefined ? undefined : Number(values.share), now: () => new Date(), storms: { classes: STORM_CLASSES } });
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(laws, null, 2)}\n`);
  const summary = `${String(laws.lines)} lines, ${String(laws.events)} events, ${String(laws.tally.truncated)} runs with no start, ${String(laws.tally.unknown)} counts of unknown counties.\n\n${lawsTable(laws)}\n${laws.causes === undefined ? "" : `\n${causesTable(laws.causes)}\n`}`;
  console.log(summary);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") appendFileSync(file, `## The laws of EAGLE-I\n\n${summary}`);
}
