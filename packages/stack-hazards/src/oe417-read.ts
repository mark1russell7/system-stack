import { OE417_CYBER_TERMS, OE417_SPACE_WEATHER_TERMS, oe417Count, oe417IsAttack, type Oe417Event, type Oe417Year } from "./oe417.ts";

// The pure reader of the OE-417 annual summaries: the rows of a sheet or of the text of a PDF file. It has no network and no process.
// A script reads the files and gives the cells or the text to these functions.

/** One cell of a sheet: its value and the text that the sheet shows. */
export interface Oe417Cell {
  /** The value of the cell: a number for a number, a date or a time, a text, or `null` for an empty cell. */
  readonly value: string | number | null;
  /** The text that the sheet shows, for example `2,000` for the number 2000 with a thousands format. */
  readonly text: string;
}

/** The cells of a sheet, row by row. A cell that is not there is `undefined` or `null`. */
export type Oe417Grid = readonly (readonly (Oe417Cell | undefined | null)[])[];

/** The events of one summary, and the count of its second rows. */
export interface Oe417Rows {
  /** The events in the order of the summary. A second row of an event is not in the list. */
  readonly events: readonly Oe417Event[];
  /** The count of the second rows: rows with no start date that equal an earlier row in each other field. */
  readonly copies: number;
}

/** The columns of a sheet, as the index of each field in a row. A field that the sheet does not have is `-1`. */
interface Columns {
  readonly beganDate: number;
  readonly beganTime: number;
  readonly restoredDate: number;
  readonly restoredTime: number;
  readonly area: number;
  readonly type: number;
  readonly megawatts: number;
  readonly customers: number;
}

const MINUTE = 60_000;
const DAY_MINUTES = 1440;
/** The zero of the dates of a sheet in the 1900 system: Excel counts 1900 as a leap year, so the zero is 1899-12-30. */
const SHEET_ZERO = Date.UTC(1899, 11, 30);
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const clean = (text: string): string => text.replace(/[\r\n ]+/gu, " ").trim();
const textOf = (cell: Oe417Cell | undefined | null): string => (cell === undefined || cell === null ? "" : clean(cell.text !== "" ? cell.text : String(cell.value ?? "")));
const valueOf = (cell: Oe417Cell | undefined | null): string | number | null => cell?.value ?? null;

/** This function gives the local time `YYYY-MM-DDTHH:MM` of a count of minutes since 1970. */
function stamp(minutes: number): string {
  return new Date(minutes * MINUTE).toISOString().slice(0, 16);
}

/** This function gives the day of a date of a sheet as a count of minutes since 1970, or `undefined`. A date is a serial number, or a text `MM/DD/YYYY`. */
function dayOf(value: string | number | null): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? (SHEET_ZERO / MINUTE) + Math.floor(value) * DAY_MINUTES : undefined;
  const match = typeof value === "string" ? /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\s*$/u.exec(value) : null;
  if (match === null) return undefined;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return Date.UTC(year, Number(match[1]) - 1, Number(match[2])) / MINUTE;
}

/** This function gives the minutes of a day from a time, a fraction of a day or a text such as `3:45 p.m.`, or `undefined`. */
function clockOf(value: string | number | null): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round((value % 1) * DAY_MINUTES) : undefined;
  const match = typeof value === "string" ? /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?:\s|$)/iu.exec(value) : null;
  if (match === null) return undefined;
  const hour = Number(match[1]) % 12 + (match[3]?.toLowerCase() === "p" ? 12 : 0);
  return hour * 60 + Number(match[2] ?? 0);
}

/** This function gives the time of an event from its date and its time, or `null` when one of them is missing. */
function timeOf(date: string | number | null, time: string | number | null): string | null {
  const day = dayOf(date);
  const clock = clockOf(time);
  return day === undefined || clock === undefined ? null : stamp(day + clock);
}

/** This function reads a restoration of the old sheets, as `5:30 p.m. January 16`, as a time after the start. */
function textRestoration(text: string, began: string | null): string | null {
  const match = /^(\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?)\s+([A-Za-z]+)\.?\s+(\d{1,2})\b/u.exec(text);
  const month = MONTHS.findIndex((name) => name.startsWith((match?.[2] ?? "?").toLowerCase().slice(0, 3)));
  const clock = clockOf(match?.[1] ?? null);
  if (match === null || month < 0 || clock === undefined || began === null) return null;
  const year = Number(began.slice(0, 4));
  const beganMonth = Number(began.slice(5, 7)) - 1;
  const day = Date.UTC(month < beganMonth ? year + 1 : year, month, Number(match[3])) / MINUTE;
  return stamp(day + clock);
}

/** This function finds the header row of a sheet, and gives its columns. It gives `undefined` for a sheet with no header. */
function headerOf(grid: Oe417Grid): { readonly row: number; readonly columns: Columns } | undefined {
  for (const [row, cells] of grid.entries()) {
    const labels = cells.map((cell) => textOf(cell).toLowerCase());
    const find = (test: RegExp): number => labels.findIndex((label) => test.test(label));
    const area = find(/^area/u);
    const customers = find(/number of customers/u);
    if (area < 0 || customers < 0) continue;
    const separate = find(/^date of restoration/u);
    return {
      row,
      columns: {
        beganDate: find(/^date( event began)?$/u),
        beganTime: find(/^time( event began)?$/u),
        restoredDate: separate >= 0 ? separate : find(/^restoration/u),
        restoredTime: find(/^time of restoration/u),
        area,
        type: find(/^(event type|type of disturbance)/u),
        megawatts: find(/^(demand loss|loss)/u),
        customers,
      },
    };
  }
  return undefined;
}

/**
 * This function reads the events of one annual summary in a sheet. It reads the three layouts of 2002 to 2023 and finds the columns by their labels.
 * A row is an event when it has an area and a type. A row with no start date that equals an earlier row in each other field is a second row: the function counts it and leaves it out.
 *
 * @param year - The year of the summary
 * @param grid - The cells of the sheet that holds the events
 * @throws RangeError when the sheet has no header row with an area and a count of customers
 */
export function oe417SheetRows(year: number, grid: Oe417Grid): Oe417Rows {
  const header = headerOf(grid);
  if (header === undefined) throw new RangeError(`oe417SheetRows: the sheet of ${String(year)} has no header row.`);
  const { columns } = header;
  const at = (cells: Oe417Grid[number], column: number): Oe417Cell | undefined | null => (column < 0 ? undefined : cells[column]);
  const labels = grid[header.row] ?? [];
  const headerArea = textOf(labels[columns.area]);
  const headerType = textOf(labels[columns.type]);
  const events: Oe417Event[] = [];
  const seen = new Set<string>();
  let copies = 0;
  for (const cells of grid.slice(header.row + 1)) {
    const area = textOf(at(cells, columns.area));
    const type = textOf(at(cells, columns.type));
    if (area === "" || type === "") continue;
    // A sheet of 2004 to 2012 prints its header row again at each page break.
    if (area === headerArea && type === headerType) continue;
    const date = valueOf(at(cells, columns.beganDate));
    const time = valueOf(at(cells, columns.beganTime));
    const customers = textOf(at(cells, columns.customers));
    const megawatts = textOf(at(cells, columns.megawatts));
    const began = timeOf(date, time);
    const restoredDate = valueOf(at(cells, columns.restoredDate));
    const separate = columns.restoredTime >= 0;
    const whole = typeof restoredDate === "number" && restoredDate >= 1 && !separate && restoredDate % 1 !== 0;
    const restored = separate
      ? timeOf(restoredDate, valueOf(at(cells, columns.restoredTime)))
      : whole
        ? stamp((SHEET_ZERO / MINUTE) + Math.round(restoredDate * DAY_MINUTES))
        : textRestoration(textOf(at(cells, columns.restoredDate)), began);
    const rest = JSON.stringify([time, valueOf(at(cells, columns.restoredDate)), valueOf(at(cells, columns.restoredTime)), area, type, customers, megawatts]);
    if (began === null && dayOf(date) === undefined && seen.has(rest)) {
      copies += 1;
      continue;
    }
    if (dayOf(date) !== undefined) seen.add(rest);
    events.push({ year, began, restored, area, type, customers, megawatts });
  }
  return { events, copies };
}

/** The columns of the text of a PDF page, from its header lines. */
interface PageColumns {
  readonly typeFrom: number;
  readonly typeTo: number;
}

/** This function finds the type column of the page of a PDF, from the two header lines `Type of` and `Disturbance`. */
function pageColumns(lines: readonly string[], from: number): PageColumns {
  let typeFrom = -1;
  let typeTo = -1;
  for (const line of lines.slice(from, from + 4)) {
    const disturbance = line.indexOf("Disturbance");
    const kind = line.indexOf("Type of");
    if (disturbance >= 0) typeFrom = typeFrom < 0 ? disturbance : Math.min(typeFrom, disturbance);
    if (kind >= 0) typeFrom = typeFrom < 0 ? kind : Math.min(typeFrom, kind);
    const loss = line.indexOf("Loss");
    if (loss >= 0) typeTo = loss;
  }
  return { typeFrom: Math.max(0, typeFrom - 3), typeTo: typeTo < 0 ? Number.MAX_SAFE_INTEGER : typeTo - 1 };
}

const PDF_ROW = /^\s{0,12}(\d{1,2})\/(\d{1,2})\/(\d{2})\b/u;
const PDF_TIME = /(\d{1,2}:\d{2}\s*[ap]\.m\.)/iu;

/** This function gives the words of a line of a PDF page in the type column. It drops a word that the cut of the column splits. */
function typeCut(line: string, columns: PageColumns): string {
  const end = Math.min(line.length, columns.typeTo);
  if (end <= columns.typeFrom) return "";
  const cut = line.slice(columns.typeFrom, end);
  const split = columns.typeFrom > 0 && /\S/u.test(line.charAt(columns.typeFrom - 1)) && /\S/u.test(cut.charAt(0));
  return clean(split ? cut.replace(/^\S+/u, "") : cut);
}

/**
 * This function reads the events of one annual summary of 2000 or 2001 in the text of its PDF file, from `pdftotext -layout`.
 * A row starts at a line with a date `M/D/YY`. A line of text goes to the nearest row, and to the next row when two are at the same distance.
 * The type is the text of the column of the type. The start is the date and the first time of the row. The restoration is `null`: the file prints its times beside the rows, not in them.
 *
 * @param year - The year of the summary
 * @param text - The text of the PDF file
 */
export function oe417PdfRows(year: number, text: string): Oe417Rows {
  const lines = text.split("\n").map((line) => line.replace(/\r$/u, ""));
  const marks: { readonly line: number; readonly day: number; readonly page: PageColumns }[] = [];
  let page: PageColumns = { typeFrom: 0, typeTo: Number.MAX_SAFE_INTEGER };
  const pages: PageColumns[] = [];
  for (const [index, line] of lines.entries()) {
    if (/^Table\s+B/u.test(line)) page = pageColumns(lines, index + 1);
    pages.push(page);
    const match = PDF_ROW.exec(line);
    if (match === null) continue;
    const day = dayOf(`${match[1] ?? ""}/${match[2] ?? ""}/${match[3] ?? ""}`);
    if (day !== undefined) marks.push({ line: index, day, page });
  }
  const types = marks.map(() => [] as string[]);
  const times = marks.map(() => undefined as number | undefined);
  for (const [index, line] of lines.entries()) {
    if (marks.length === 0) break;
    let best = 0;
    for (const [number, mark] of marks.entries()) {
      const distance = Math.abs(mark.line - index);
      const nearest = Math.abs((marks[best]?.line ?? 0) - index);
      if (distance < nearest || (distance === nearest && mark.line > (marks[best]?.line ?? 0))) best = number;
    }
    const mark = marks[best];
    if (mark === undefined || /^Source:|Energy Information Administration|^Table\s+B/u.test(line.trim()) || mark.page !== pages[index]) continue;
    const fragment = typeCut(line, mark.page);
    if (fragment !== "" && !/^(Type of|Disturbance|Loss|\(mega-|watts\)|Affected)$/u.test(fragment)) types[best]?.push(fragment);
    const clock = PDF_TIME.exec(line.slice(0, mark.page.typeFrom));
    if (clock !== null && times[best] === undefined && index >= mark.line - 1 && index <= mark.line + 1) times[best] = clockOf(clock[1] ?? null);
  }
  const events = marks.map((mark, number): Oe417Event => {
    const clock = times[number];
    const row = lines[mark.line] ?? "";
    const before = row.slice(0, mark.page.typeFrom);
    const after = row.slice(mark.page.typeTo).split(/\s{2,}/u).map(clean).filter((token) => token !== "");
    return {
      year,
      began: clock === undefined ? null : stamp(mark.day + clock),
      restored: null,
      area: clean(/(?:\d{1,2}:\d{2}\s*[ap]\.m\.|\bNA\b)\s+(.*)$/iu.exec(before)?.[1] ?? ""),
      type: (types[number] ?? []).join(" "),
      megawatts: after[0] ?? "",
      customers: after[1] ?? "",
    };
  });
  return { events, copies: 0 };
}

/**
 * This function gives the counts of one summary by the terms of `oe417IsAttack`, `OE417_CYBER_TERMS` and `OE417_SPACE_WEATHER_TERMS`.
 * A cyber event has a loss when it has more than 0 customers or more than 0 megawatts, as the events of `OE417_ATTACK_EVENTS` do.
 */
export function oe417YearCounts(rows: Oe417Rows): Oe417Year {
  const loss = (event: Oe417Event): boolean => oe417Count(event.customers) > 0 || oe417Count(event.megawatts) > 0;
  const attacks = rows.events.filter((event) => oe417IsAttack(event.type));
  const cyber = rows.events.filter((event) => OE417_CYBER_TERMS.test(event.type));
  return {
    rows: rows.events.length,
    copies: rows.copies,
    attacks: attacks.length,
    kept: attacks.filter(loss).length,
    cyber: cyber.length,
    cyberLoss: cyber.filter(loss).length,
    spaceWeather: rows.events.filter((event) => OE417_SPACE_WEATHER_TERMS.test(event.type)).length,
  };
}

/** This function gives the events of an attack with a loss of customers or load: the events that `OE417_ATTACK_EVENTS` holds. */
export function oe417KeptEvents(rows: Oe417Rows): Oe417Event[] {
  return rows.events.filter((event) => oe417IsAttack(event.type) && (oe417Count(event.customers) > 0 || oe417Count(event.megawatts) > 0));
}

/** The record of the events that a read of the summaries gave, for the check against the dataset. */
export interface Oe417Read {
  /** The counts of each year, by the year. */
  readonly years: Readonly<Record<string, Oe417Year>>;
  /** The events of an attack with a loss, in the order of the years and of the summaries. */
  readonly events: readonly Oe417Event[];
}

const FIELDS = ["rows", "copies", "attacks", "kept", "cyber", "cyberLoss", "spaceWeather"] as const;
const EVENT_FIELDS = ["year", "began", "restored", "area", "type", "customers", "megawatts"] as const;

/**
 * This function lists each difference between a read and the dataset: a year that the read lacks, a count that is not equal, an event that is not equal.
 * A year that the read has and the dataset lacks is a new year, not a difference. The function adds such a year to `fresh`.
 *
 * @param read - The counts and the events that the reader gave
 * @param years - The counts of the dataset, for example `OE417_YEARS`
 * @param events - The events of the dataset, for example `OE417_ATTACK_EVENTS`
 * @param fresh - A list that gets the years of the read that the dataset does not have
 * @returns One line for each difference. The list is empty when the read equals the dataset.
 */
export function oe417Compare(read: Oe417Read, years: Readonly<Record<string, Oe417Year>>, events: readonly Oe417Event[], fresh: string[] = []): string[] {
  const lines: string[] = [];
  for (const year of Object.keys(read.years)) if (!(year in years)) fresh.push(year);
  for (const [year, expected] of Object.entries(years)) {
    const got = read.years[year];
    if (got === undefined) {
      lines.push(`${year}: the read has no counts for this year.`);
      continue;
    }
    for (const field of FIELDS) if (got[field] !== expected[field]) lines.push(`${year}: ${field} is ${String(got[field])}, the dataset has ${String(expected[field])}.`);
  }
  const known = new Set(Object.keys(years));
  const mine = read.events.filter((event) => known.has(String(event.year)));
  const length = Math.max(mine.length, events.length);
  for (let index = 0; index < length; index += 1) {
    const got = mine[index];
    const expected = events[index];
    if (got === undefined || expected === undefined) {
      lines.push(`event ${String(index)}: ${got === undefined ? "the read has no event, the dataset has" : "the dataset has no event, the read has"} ${JSON.stringify(got ?? expected)}.`);
      continue;
    }
    for (const field of EVENT_FIELDS) {
      if (got[field] !== expected[field]) lines.push(`event ${String(index)} (${String(expected.year)} ${expected.area}): ${field} is ${JSON.stringify(got[field])}, the dataset has ${JSON.stringify(expected[field])}.`);
    }
  }
  return lines;
}
