import { gunzipSync } from "node:zlib";
import { statusLine } from "polite-crawler/api";
import { stormCauses, stormLine, zoneCounties, type CauseOptions, type CauseTally, type StormCauses } from "../src/storms.ts";
import { TryFault, get, passing, withTries, type FitContext } from "./fetch.ts";

// The storm events of the fit job: the details files of NOAA Storm Events (public domain) and the zone-county file of the NWS.

/** The folder of the bulk files of NOAA Storm Events at NCEI. */
export const STORM_BASE = "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/";
/** The zone-county file of the National Weather Service. The job reads this one version, so each run has the same zones. */
export const ZONE_FILE = "https://www.weather.gov/source/gis/Shapefiles/County/bp16ap26.dbx";

const DETAILS = /^StormEvents_details-ftp_v1\.0_d(\d{4})_c(\d{8})\.csv\.gz$/u;

/** The details file of one year. */
export interface StormFile {
  readonly year: number;
  readonly name: string;
}

/** This function gives the details file of each year of the test from the listing of the folder. Of two files of a year, it gives the newer one. */
export function stormFiles(listing: string, years: (year: number) => boolean): StormFile[] {
  const latest = new Map<number, string>();
  for (const match of listing.matchAll(/href="([^"]+)"/gu)) {
    const name = match[1] ?? "";
    const year = Number(DETAILS.exec(name)?.[1]);
    if (!Number.isInteger(year) || !years(year)) continue;
    const other = latest.get(year);
    if (other === undefined || other < name) latest.set(year, name);
  }
  return [...latest].sort(([one], [two]) => one - two).map(([year, name]) => ({ year, name }));
}

/** The record of the storm events of a fit. */
export interface StormRecord {
  readonly files: readonly { readonly name: string; readonly bytes: number }[];
  /** The name of the zone-county file. */
  readonly zones: string;
  /** The lines of the details files. Each header line is a skipped line. */
  readonly lines: number;
  readonly skipped: number;
  readonly tally: CauseTally;
}

/** This function gives the text of a file in one GET request, with `RANGE_TRIES` tries. It decompresses a file in gzip. */
async function fileText(context: FitContext, source: string, url: string, what: string, gzip: boolean): Promise<{ text: string; bytes: number }> {
  return await withTries(context, what, async () => {
    const reply = await get(context, source, url, what, {}, "bytes");
    if (passing(reply.status)) throw new TryFault(`${source} gave ${statusLine(reply)} for ${what}.`);
    if (reply.status !== 200) throw new Error(`${source} gave ${statusLine(reply)} for ${what}.`);
    const bytes = reply.bytes ?? new Uint8Array();
    return { text: (gzip ? gunzipSync(bytes) : Buffer.from(bytes)).toString("utf8"), bytes: bytes.length };
  });
}

/**
 * This function reads the details files of Storm Events of the years and the zone-county file. It gives the index of the storm events by county.
 *
 * @param classes - The event types of each case, for example `STORM_CLASSES`
 * @throws Error when a request fails `RANGE_TRIES` times or gives a status other than 200, or when the folder has no file of the years
 */
export async function readStorms(
  context: FitContext,
  years: (year: number) => boolean,
  classes: Readonly<Record<string, readonly string[]>>,
  options: CauseOptions = {},
): Promise<{ readonly index: StormCauses; readonly record: Omit<StormRecord, "tally"> }> {
  const listing = await fileText(context, "Storm Events of NCEI", STORM_BASE, "the listing of the details files", false);
  const files = stormFiles(listing.text, years);
  if (files.length === 0) throw new Error("readStorms: the folder has no details file of the years.");
  const zones = await fileText(context, "the National Weather Service", ZONE_FILE, "the zone-county file", false);
  const index = stormCauses(classes, zoneCounties(zones.text), options);
  const read: { name: string; bytes: number }[] = [];
  let lines = 0;
  let skipped = 0;
  for (const file of files) {
    const { text, bytes } = await fileText(context, "Storm Events of NCEI", STORM_BASE + file.name, file.name, true);
    context.log(`${file.name}: ${String(Math.round(bytes / 1e6))} MB`);
    read.push({ name: file.name, bytes });
    for (const line of text.split(/\r?\n/u)) {
      if (line === "") continue;
      lines += 1;
      const row = stormLine(line);
      if (row === undefined) skipped += 1;
      else index.add(row);
    }
  }
  return { index, record: { files: read, zones: ZONE_FILE.slice(ZONE_FILE.lastIndexOf("/") + 1), lines, skipped } };
}
