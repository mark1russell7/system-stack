/**
 * The reader of the OE-417 annual summaries of DOE. The workflow `oe417-read` starts it in CI. The package on npm does not have it.
 *
 * The job fetches the archived copy of each summary of `OE417_FILES` through `polite-crawler`, one request at a time.
 * It reads the sheets (XLS) with SheetJS and the text of the PDF files with `pdftotext`, and it gives the rows to the pure functions of `src/oe417-read.ts`.
 * It writes the counts of each year and the events to a JSON file. With `--check` it compares them with `OE417_YEARS` and `OE417_ATTACK_EVENTS`.
 *
 * Options:
 * - `--out <file>`: the JSON file. The default is `out/oe417.json`.
 * - `--check`: print each difference and exit with 1 when there is one.
 * - `--extra <file>`: a JSON file of more summaries, for example a new year: `{ "2024": { "id": 85, "format": "xls", "url": "...", "archive": "..." } }`.
 * - `--save <folder>`: keep each fetched file in the folder.
 * - `--from <folder>`: read the files `<year>.xls` and `<year>.pdf` of the folder, and fetch nothing.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { read as readBook, utils, type WorkSheet } from "@e965/xlsx";
import { recordOf, textOf } from "@mark1russell7/optional/read";
import { fetchTransport, statusLine, type Pace } from "polite-crawler/api";
import { HostScheduler, realClock } from "polite-crawler/politeness";
import { OE417_ATTACK_EVENTS, OE417_FILES, OE417_YEARS } from "../src/oe417-events.ts";
import type { Oe417Event, Oe417File, Oe417Year } from "../src/oe417.ts";
import { oe417Compare, oe417KeptEvents, oe417PdfRows, oe417SheetRows, oe417YearCounts, type Oe417Cell, type Oe417Grid, type Oe417Read, type Oe417Rows } from "../src/oe417-read.ts";
import { TryFault, get, passing, withTries, type FitContext } from "./fetch.ts";

/** The name that the job gives to the servers. */
export const USER_AGENT = "system-stack-hazards/0.1 (+https://github.com/mark1russell7/system-stack)";

/** This function gives the cells of a sheet of SheetJS as a grid, with the value and the shown text of each cell. */
export function sheetGrid(sheet: WorkSheet): Oe417Grid {
  const range = sheet["!ref"] === undefined ? undefined : utils.decode_range(sheet["!ref"]);
  if (range === undefined) return [];
  const grid: (Oe417Cell | null)[][] = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    const cells: (Oe417Cell | null)[] = [];
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[utils.encode_cell({ r: row, c: column })];
      const value = cell === undefined || (cell.t !== "n" && cell.t !== "s") ? null : (cell.v as string | number);
      cells.push(cell === undefined ? null : { value, text: typeof cell.w === "string" ? cell.w : String(value ?? "") });
    }
    grid.push(cells);
  }
  return grid;
}

/** This function reads the events of an XLS file: the first sheet that has the header of a summary. */
export function readXls(year: number, bytes: Uint8Array): Oe417Rows {
  const book = readBook(bytes, { type: "buffer", raw: true });
  const faults: string[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (sheet === undefined) continue;
    try {
      return oe417SheetRows(year, sheetGrid(sheet));
    } catch (error) {
      faults.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`The file of ${String(year)} has no sheet with the header of a summary (${faults.join("; ")}).`);
}

/** This function reads the events of a PDF file with `pdftotext -layout`, started with argv and no shell. It writes the file to a temporary folder, because not each version of `pdftotext` reads a file from its input. */
export function readPdf(year: number, bytes: Uint8Array): Oe417Rows {
  const folder = mkdtempSync(join(tmpdir(), "oe417-"));
  try {
    const path = join(folder, `${String(year)}.pdf`);
    writeFileSync(path, bytes);
    const run = spawnSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    if (run.error !== undefined) throw new Error(`pdftotext did not start for ${String(year)}: ${run.error.message}`);
    if (run.status !== 0) throw new Error(`pdftotext gave status ${String(run.status)} for ${String(year)}: ${run.stderr}`);
    return oe417PdfRows(year, run.stdout);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/** This function reads the file of the extra summaries: a JSON object from a year to an `Oe417File`. */
export function extraFiles(path: string): Record<string, Oe417File> {
  const files: Record<string, Oe417File> = {};
  const root = recordOf(JSON.parse(readFileSync(path, "utf8")) as unknown);
  if (root === undefined) throw new RangeError(`The file ${path} is not a JSON object from a year to a summary.`);
  for (const [year, value] of Object.entries(root)) {
    const entry = recordOf(value);
    const id = entry?.["id"];
    const format = textOf(entry?.["format"]);
    const url = textOf(entry?.["url"]);
    const archive = textOf(entry?.["archive"]);
    if (!/^\d{4}$/u.test(year) || typeof id !== "number" || (format !== "xls" && format !== "pdf") || url === undefined || archive === undefined) {
      throw new RangeError(`The entry "${year}" of ${path} needs a number id, a format xls or pdf, a url and an archive address.`);
    }
    files[year] = { id, format, url, archive };
  }
  return files;
}

/** This function fetches the archived copy of one summary in one GET request, with the tries of `withTries`. */
async function fetchFile(context: FitContext, year: string, file: Oe417File): Promise<Uint8Array> {
  return await withTries(context, year, async () => {
    const reply = await get(context, "the Internet Archive", file.archive, `the summary of ${year}`, {}, "bytes");
    if (passing(reply.status)) throw new TryFault(`The Internet Archive gave ${statusLine(reply)} for ${year}.`);
    if (reply.status !== 200) throw new Error(`The Internet Archive gave ${statusLine(reply)} for ${year}.`);
    return reply.bytes ?? new Uint8Array();
  });
}

/** This function reads each summary and gives the counts and the events of an attack with a loss. */
export async function readSummaries(files: Readonly<Record<string, Oe417File>>, source: (year: string, file: Oe417File) => Promise<Uint8Array>): Promise<{ read: Oe417Read; rows: Record<string, Oe417Rows> }> {
  const years: Record<string, Oe417Year> = {};
  const rows: Record<string, Oe417Rows> = {};
  const events: Oe417Event[] = [];
  for (const [year, file] of Object.entries(files).sort(([one], [two]) => Number(one) - Number(two))) {
    const bytes = await source(year, file);
    const read = file.format === "pdf" ? readPdf(Number(year), bytes) : readXls(Number(year), bytes);
    rows[year] = read;
    years[year] = oe417YearCounts(read);
    events.push(...oe417KeptEvents(read));
  }
  return { read: { years, events }, rows };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { out: { type: "string", default: "out/oe417.json" }, check: { type: "boolean", default: false }, extra: { type: "string" }, save: { type: "string" }, from: { type: "string" } } });
  const files = { ...OE417_FILES, ...(values.extra === undefined ? {} : extraFiles(values.extra)) };
  const pace: Pace = { scheduler: new HostScheduler(realClock, 1), now: realClock.now };
  const context: FitContext = { pace, transport: fetchTransport({ userAgent: USER_AGENT, timeoutMs: 120_000 }), chunkBytes: 0, log: (line) => console.log(line) };
  const source = async (year: string, file: Oe417File): Promise<Uint8Array> => {
    const name = `${year}.${file.format}`;
    if (values.from !== undefined) return new Uint8Array(readFileSync(join(values.from, name)));
    const bytes = await fetchFile(context, year, file);
    context.log(`${name}: ${String(bytes.length)} bytes`);
    if (values.save !== undefined) {
      mkdirSync(values.save, { recursive: true });
      writeFileSync(join(values.save, name), bytes);
    }
    return bytes;
  };
  const { read, rows } = await readSummaries(files, source);
  mkdirSync(dirname(values.out), { recursive: true });
  const output = { files, counts: read.years, attackEvents: read.events, rows: Object.fromEntries(Object.entries(rows).map(([year, entry]) => [year, entry.events])) };
  writeFileSync(values.out, `${JSON.stringify(output, null, 2)}\n`);
  const fresh: string[] = [];
  const differences = oe417Compare(read, OE417_YEARS, OE417_ATTACK_EVENTS, fresh);
  const total = Object.values(read.years).reduce((sum, year) => sum + year.rows, 0);
  const lines = [
    `${String(Object.keys(read.years).length)} years, ${String(total)} events, ${String(read.events.length)} events of an attack with a loss.`,
    fresh.length === 0 ? "No year is new." : `New years, not in the dataset: ${fresh.join(", ")}.`,
    differences.length === 0 ? "The read equals the dataset." : `${String(differences.length)} differences with the dataset:\n${differences.join("\n")}`,
  ];
  const summary = lines.join("\n");
  console.log(summary);
  const stepSummary = process.env["GITHUB_STEP_SUMMARY"];
  if (stepSummary !== undefined && stepSummary !== "") appendFileSync(stepSummary, `## OE-417 summaries\n\n\`\`\`\n${summary}\n\`\`\`\n`);
  if (values.check && differences.length > 0) process.exitCode = 1;
}
