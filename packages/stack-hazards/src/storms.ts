import type { OutageEvent } from "./outages.ts";

// The cause of an outage from NOAA Storm Events: an outage that starts in a county while a storm event covers the county.
// The match is in time and place only. It does not prove that the storm caused the outage.

/**
 * The event types of NOAA Storm Events for each hazard case, by the names of NWS Instruction 10-1605.
 * A type that is not in the table gives no case. A type is in one case only.
 */
export const STORM_CLASSES: Readonly<Record<string, readonly string[]>> = {
  "met.winter.storm": ["Blizzard", "Heavy Snow", "Ice Storm", "Lake-Effect Snow", "Winter Storm"],
  "met.heat.extreme": ["Excessive Heat", "Heat"],
  "met.tropical.hurricane": ["Hurricane", "Hurricane (Typhoon)", "Tropical Depression", "Tropical Storm"],
  "met.flood": ["Coastal Flood", "Flash Flood", "Flood", "Lakeshore Flood"],
  "met.tornado": ["Tornado"],
};

/** The kind of the area of a row of Storm Events: a county (`C`), a public forecast zone (`Z`) or a marine zone (`M`). */
export type StormArea = "C" | "Z" | "M";

/** One row of a details file of Storm Events. */
export interface StormRow {
  /** The event type, for example `Tornado`. */
  readonly type: string;
  readonly kind: StormArea;
  /** The FIPS code of the state (2 digits) and the code of the county or the zone (3 digits). */
  readonly area: string;
  /** The start of the event, in seconds of UTC. */
  readonly begin: number;
  /** The end of the event, in seconds of UTC. */
  readonly end: number;
}

/** The fields of a row before the narratives: the reader reads only these. */
const FIELDS = 19;

const isArea = (kind: string): kind is StormArea => kind === "C" || kind === "Z" || kind === "M";

/**
 * The codes of the territories in the field `STATE_FIPS` of Storm Events, and their FIPS codes of the Census Bureau.
 * Storm Events gives Puerto Rico the code 99 and the Virgin Islands the code 96. EAGLE-I and the zone-county file use 72 and 78.
 * Without this table, no row of a territory has a county or a zone, and the territory has no storm event.
 */
export const STORM_STATE_CODES: Readonly<Record<string, string>> = { "96": "78", "97": "60", "98": "66", "99": "72" };

/** This function gives the first fields of a line of CSV. A field in quotes can have commas and doubled quotes. */
function fieldsOf(line: string, count: number): string[] | undefined {
  const fields: string[] = [];
  let at = 0;
  while (fields.length < count) {
    let value = "";
    if (line[at] === '"') {
      at += 1;
      for (;;) {
        const close = line.indexOf('"', at);
        if (close < 0) return undefined;
        value += line.slice(at, close);
        at = close + 1;
        if (line[at] !== '"') break;
        value += '"';
        at += 1;
      }
    } else {
      const comma = line.indexOf(",", at);
      const stop = comma < 0 ? line.length : comma;
      value = line.slice(at, stop);
      at = stop;
    }
    fields.push(value);
    if (fields.length < count) {
      if (line[at] !== ",") return undefined;
      at += 1;
    }
  }
  return fields;
}

/** This function gives the seconds of UTC of a local time of Storm Events, or undefined for a wrong date or time. */
function instant(month: string, day: string, time: string, offset: number): number | undefined {
  if (!/^\d{6}$/u.test(month) || !/^\d{1,2}$/u.test(day) || !/^\d{1,4}$/u.test(time)) return undefined;
  const clock = Number(time);
  const hour = Math.floor(clock / 100);
  const minute = clock % 100;
  if (hour > 23 || minute > 59) return undefined;
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(4)) - 1, Number(day), hour, minute));
  if (date.getUTCDate() !== Number(day) || date.getUTCMonth() !== Number(month.slice(4)) - 1) return undefined;
  return date.getTime() / 1000 - offset * 3600;
}

/**
 * This function reads one line of a details file of Storm Events. It reads only the first 19 fields, before the narratives.
 * The file gives each time in the local standard time of the area. The field `CZ_TIMEZONE` has the offset, for example `CST-6`.
 * The area of a territory has the FIPS code of the Census Bureau, from `STORM_STATE_CODES`.
 *
 * @returns The row, or undefined for the header, a part of a broken line or a line with a wrong field
 */
export function stormLine(line: string): StormRow | undefined {
  const fields = fieldsOf(line, FIELDS);
  if (fields === undefined) return undefined;
  const [beginMonth = "", beginDay = "", beginTime = "", endMonth = "", endDay = "", endTime = "", , , , state = "", , , type = "", kind = "", cz = "", , , , zone = ""] = fields;
  const offset = /^[A-Z]+([+-]?\d{1,2})$/u.exec(zone)?.[1];
  if (offset === undefined || !/^\d{1,2}$/u.test(state) || !/^\d{1,3}$/u.test(cz) || !isArea(kind) || type === "") return undefined;
  const begin = instant(beginMonth, beginDay, beginTime, Number(offset));
  const end = instant(endMonth, endDay, endTime, Number(offset));
  if (begin === undefined || end === undefined || end < begin) return undefined;
  const code = state.padStart(2, "0");
  return { type, kind, area: (STORM_STATE_CODES[code] ?? code) + cz.padStart(3, "0"), begin, end };
}

/**
 * This function reads the zone-county file of the National Weather Service. The file has one line for each pair of a zone and a county, with `|` between the fields.
 *
 * @returns The FIPS codes of the counties of each zone, by the code of the state (2 digits) and of the zone (3 digits)
 */
export function zoneCounties(text: string): Map<string, readonly string[]> {
  const zones = new Map<string, Set<string>>();
  for (const line of text.split(/\r?\n/u)) {
    const fields = line.split("|");
    const zone = fields[1] ?? "";
    const county = fields[6] ?? "";
    if (!/^\d{3}$/u.test(zone) || !/^\d{5}$/u.test(county)) continue;
    const key = county.slice(0, 2) + zone;
    zones.set(key, (zones.get(key) ?? new Set<string>()).add(county));
  }
  return new Map([...zones].map(([key, counties]) => [key, [...counties].sort()]));
}

/** The default seconds before the start of a storm event in which an outage can start: 1 hour. */
export const CAUSE_BEFORE = 3600;
/** The default seconds after the end of a storm event in which an outage can start: 3 hours. */
export const CAUSE_AFTER = 10_800;

/** The options of `stormCauses`. */
export interface CauseOptions {
  /** The seconds before the start of a storm event in which an outage can start. The default is `CAUSE_BEFORE`. */
  readonly before?: number | undefined;
  /** The seconds after the end of a storm event in which an outage can start. The default is `CAUSE_AFTER`. */
  readonly after?: number | undefined;
}

/** The counts of the rows that `stormCauses` got. */
export interface CauseTally {
  readonly rows: number;
  /** The rows of a type of a case with one county or more. */
  readonly placed: number;
  /** The rows of a type of a case in a marine zone, or in a zone that the zone-county file does not have. */
  readonly unplaced: number;
  /** The count of the rows of each type that no case has. */
  readonly other: Readonly<Record<string, number>>;
}

/** The index of the storm events by county. */
export interface StormCauses {
  /** This function adds one row of Storm Events. */
  add(row: StormRow): void;
  /** This function gives the cases of the storm events that cover the county of an outage at its start, in the order of the table. */
  causes(event: Pick<OutageEvent, "area" | "start">): readonly string[];
  tally(): CauseTally;
}

interface Window {
  readonly begin: number;
  readonly end: number;
  readonly cause: number;
}

interface CountyWindows {
  readonly windows: Window[];
  sorted: boolean;
  longest: number;
}

/**
 * This function makes the index of the storm events of the cases by county. A row of a zone covers each county of the zone.
 * An outage is in a case when it starts from `before` seconds before a storm event of the case to `after` seconds after its end.
 *
 * @param classes - The event types of each case, for example `STORM_CLASSES`
 * @param zones - The counties of each zone, from `zoneCounties`
 * @throws {RangeError} When a margin is not a finite number of 0 or more, or when a type is in two cases
 */
export function stormCauses(classes: Readonly<Record<string, readonly string[]>>, zones: ReadonlyMap<string, readonly string[]>, options: CauseOptions = {}): StormCauses {
  const before = options.before ?? CAUSE_BEFORE;
  const after = options.after ?? CAUSE_AFTER;
  for (const margin of [before, after]) if (!Number.isFinite(margin) || margin < 0) throw new RangeError(`stormCauses: the margin ${String(margin)} is not a finite number of 0 or more.`);
  const cases = Object.keys(classes);
  const caseOf = new Map<string, number>();
  cases.forEach((name, index) => {
    for (const type of classes[name] ?? []) {
      if (caseOf.has(type)) throw new RangeError(`stormCauses: the type "${type}" is in two cases.`);
      caseOf.set(type, index);
    }
  });
  const counties = new Map<string, CountyWindows>();
  const other: Record<string, number> = {};
  let rows = 0;
  let placed = 0;
  let unplaced = 0;
  return {
    add(row) {
      rows += 1;
      const cause = caseOf.get(row.type);
      if (cause === undefined) {
        other[row.type] = (other[row.type] ?? 0) + 1;
        return;
      }
      const areas = row.kind === "C" ? [row.area] : row.kind === "Z" ? (zones.get(row.area) ?? []) : [];
      if (areas.length === 0) {
        unplaced += 1;
        return;
      }
      placed += 1;
      for (const area of areas) {
        const county = counties.get(area) ?? { windows: [], sorted: true, longest: 0 };
        county.windows.push({ begin: row.begin, end: row.end, cause });
        county.sorted = false;
        county.longest = Math.max(county.longest, row.end - row.begin);
        counties.set(area, county);
      }
    },
    causes({ area, start }) {
      const county = counties.get(area);
      if (county === undefined) return [];
      const { windows } = county;
      if (!county.sorted) {
        windows.sort((one, two) => one.begin - two.begin);
        county.sorted = true;
      }
      // The first window that starts too late for the outage. Each window before it starts in time.
      let low = 0;
      let high = windows.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if ((windows[middle]?.begin ?? 0) - before <= start) low = middle + 1;
        else high = middle;
      }
      // A window that starts before this bound also ends too early, because no window is longer than `longest`.
      const bound = start - after - county.longest;
      const found = new Set<number>();
      for (let index = low - 1; index >= 0; index -= 1) {
        const window = windows[index];
        if (window === undefined || window.begin < bound) break;
        if (window.end + after >= start) found.add(window.cause);
      }
      return cases.filter((_, index) => found.has(index));
    },
    tally: () => ({ rows, placed, unplaced, other: { ...other } }),
  };
}
