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
import { fetchTransport, send, statusLine, type Pace, type Reply, type Transport } from "polite-crawler/api";
import { HostScheduler, realClock } from "polite-crawler/politeness";
import { EAGLE_INTERVAL, EAGLE_SCHEME, eagleCustomers, eagleLine, eagleRegion } from "../src/eaglei.ts";
import { outageCurves, type RegionCurve } from "../src/law.ts";
import { outageReader, type OutageTally } from "../src/outages.ts";

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

/** The parts of a fit: the pace, the transport, the bytes of a range request and the log. */
export interface FitContext {
  readonly pace: Pace;
  readonly transport: Transport;
  readonly chunkBytes: number;
  readonly log: (line: string) => void;
}

// A signed URL of the storage is a short credential, so no message holds a query.
const noQuery = (text: string): string => text.replace(/\?\S*/g, "?<query>");

async function get(context: FitContext, url: string, what: string, headers: Readonly<Record<string, string>> = {}, read?: "bytes"): Promise<Reply> {
  const exchange = { method: "GET", url, headers: { "accept-encoding": "identity", ...headers }, body: null, read };
  const answer = await send(context.pace, context.transport, { source: "EAGLE-I on figshare", host: new URL(url).host, what, exchange, redact: noQuery });
  return answer.reply;
}

/**
 * This function gives the bytes of a file in range requests. Each range has its own redirect, because a signed URL of the storage lasts for seconds only.
 * After the last range, it examines the MD5 of the file.
 *
 * @throws Error when an answer is not a redirect or a part of the file, or when a part or the MD5 is wrong
 */
export async function* fileChunks(context: FitContext, file: DatasetFile): AsyncGenerator<Uint8Array> {
  const hash = createHash("md5");
  for (const [start, end] of ranges(file.size, context.chunkBytes)) {
    const redirect = await get(context, file.url, `the place of ${file.name}`);
    const location = redirect.headers["location"];
    if (!(redirect.status >= 300 && redirect.status < 400 && location !== undefined)) throw new Error(`The download of ${file.name} gave ${statusLine(redirect)}, not a redirect.`);
    const reply = await get(context, new URL(location, file.url).href, `the bytes ${String(start)} to ${String(end)} of ${file.name}`, { range: `bytes=${String(start)}-${String(end)}` }, "bytes");
    const whole = reply.status === 200 && start === 0 && end === file.size - 1;
    if (reply.status !== 206 && !whole) throw new Error(`The storage gave ${statusLine(reply)} for a range of ${file.name}.`);
    const bytes = reply.bytes ?? new Uint8Array();
    if (bytes.length !== end - start + 1) throw new Error(`The storage gave ${String(bytes.length)} bytes for a range of ${String(end - start + 1)} bytes of ${file.name}.`);
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
}

/**
 * This function reads the files of EAGLE-I and gives the curve of the durations of the outages of each state.
 *
 * @throws Error when a request fails, or when a file is not complete or has a wrong MD5
 */
export async function fitEagle(context: FitContext, options: FitOptions): Promise<EagleLaws> {
  const record = await get(context, ARTICLE_URL, "the record of the article");
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
  };
}

/** This function gives a table in Markdown of the curve of each state: the events, the censored events, the median and the open chance. */
export function lawsTable(laws: EagleLaws): string {
  const minutes = (days: number | undefined): string => (days === undefined ? "none" : String(Math.round(days * 1440)));
  const rows = Object.entries(laws.regions).map(([code, curve]) => `| ${code} | ${String(curve.count)} | ${String(curve.censored)} | ${minutes(curve.median)} | ${curve.open.toFixed(4)} |`);
  return ["| State | Events | Censored | Median (minutes) | Open |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
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
  const laws = await fitEagle(context, { years: yearsOf(values.years), share: values.share === undefined ? undefined : Number(values.share), now: () => new Date() });
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(laws, null, 2)}\n`);
  const summary = `${String(laws.lines)} lines, ${String(laws.events)} events, ${String(laws.tally.truncated)} runs with no start, ${String(laws.tally.unknown)} counts of unknown counties.\n\n${lawsTable(laws)}\n`;
  console.log(summary);
  const file = process.env["GITHUB_STEP_SUMMARY"];
  if (file !== undefined && file !== "") appendFileSync(file, `## The laws of EAGLE-I\n\n${summary}`);
}
