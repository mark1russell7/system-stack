import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { Exchange, Pace, Reply, Transport } from "polite-crawler/api";
import { HostScheduler } from "polite-crawler/politeness";
import { describe, expect, it } from "vitest";
import { EAGLE_ARTICLE, JOIN_SWEEP, PRIOR_LIMIT, eagleFiles, fitEagle, joinSweep, lawsTable, linesOf, peakTally, peaksTable, raiseCustomers, ranges, sweepTable, yearsOf, type EagleLaws } from "./eaglei-fit.ts";
import { RANGE_TRIES, type FitContext } from "./fetch.ts";
import { STORM_BASE, stormFiles } from "./storm-files.ts";
import { STORM_CLASSES } from "../src/storms.ts";

// A made-up article on fake hosts. The code 99 is not the code of a state.
const API = `https://api.figshare.com/v2/articles/${String(EAGLE_ARTICLE)}`;
const STORE = "https://store.example.net";

const times = (from: string, count: number): string[] =>
  Array.from({ length: count }, (_, index) => new Date(Date.parse(`${from}Z`) + index * 900_000).toISOString().slice(0, 19).replace("T", " "));

function outageFile(header: string, rows: readonly (readonly [string, number, string])[]): string {
  return [header, ...rows.map(([fips, out, time]) => `${fips},${fips === "99001" ? "Doña Test" : "Filler"},Teststate,${String(out)},${time}`)].join("\n") + "\n";
}

// The county 99001 has 40 customers out from 23:00 of the last day of 2020 to 00:15 of 2021: one event of 90 minutes over two files.
const FILES: Record<string, string> = {
  "MCC.csv": "﻿County_FIPS,Customers\r\n99001,1000\r\n99009,100000\r\n",
  "eaglei_outages_2020.csv": outageFile("fips_code,county,state,customers_out,run_start_time", [
    ...times("2020-12-31T22:00:00", 8).map((time) => ["99009", 1, time] as const),
    ...times("2020-12-31T23:00:00", 4).map((time) => ["99001", 40, time] as const),
  ]),
  "eaglei_outages_2021.csv": outageFile("fips_code,county,state,customers_out,run_start_time", [
    ...times("2021-01-01T00:00:00", 5).flatMap((time, index) => (index < 2 ? [["99001", 40, time] as const, ["99009", 1, time] as const] : [["99009", 1, time] as const])),
  ]),
  "DQI.csv": "state,dqi\n",
};
const NAMES = Object.keys(FILES);

// Made-up storm events of the county 99001: a winter storm by county, and a tornado by the zone 99005. The older file of 2020 has a flood that the job does not read.
const STORM_HEAD = "BEGIN_YEARMONTH,BEGIN_DAY,BEGIN_TIME,END_YEARMONTH,END_DAY,END_TIME,EPISODE_ID,EVENT_ID,STATE,STATE_FIPS,YEAR,MONTH_NAME,EVENT_TYPE,CZ_TYPE,CZ_FIPS,CZ_NAME,WFO,BEGIN_DATE_TIME,CZ_TIMEZONE,END_DATE_TIME";
const storm = (begin: string, end: string, type: string, kind: string, cz: number): string =>
  `${begin.replaceAll(" ", ",")},${end.replaceAll(" ", ",")},1,2,"TESTSTATE",99,2020,"December","${type}","${kind}",${String(cz)},"TEST","XXX","x","CST-6","x"`;
const STORMS: Record<string, string> = {
  "StormEvents_details-ftp_v1.0_d2019_c20260101.csv.gz": `${STORM_HEAD}\n`,
  "StormEvents_details-ftp_v1.0_d2020_c20250101.csv.gz": [STORM_HEAD, storm("202012 31 1600", "202012 31 1900", "Flood", "C", 1)].join("\n"),
  "StormEvents_details-ftp_v1.0_d2020_c20260101.csv.gz": [STORM_HEAD, storm("202012 31 1600", "202012 31 1900", "Winter Storm", "C", 1), storm("202012 31 1655", "202012 31 1700", "Tornado", "Z", 5), storm("202012 31 1600", "202012 31 1900", "Hail", "C", 1)].join("\n"),
  "StormEvents_details-ftp_v1.0_d2021_c20260101.csv.gz": `${STORM_HEAD}\n`,
};
const LISTING = [...Object.keys(STORMS), "StormEvents_fatalities-ftp_v1.0_d2020_c20260101.csv.gz", "StormEvents_details-ftp_v1.0_d2022_c20260101.csv.gz"].map((name) => `<a href="${name}">${name}</a>`).join("\n");
const ZONES = "TS|005|XXX|Test Zone|TS005|Test|99001|C|xx|0|0\n";
const md5 = (text: string): string => createHash("md5").update(text).digest("hex");

function article(change: (file: Record<string, unknown>) => Record<string, unknown> = (file) => file, files: Record<string, string> = FILES): unknown {
  return {
    version: 4,
    modified_date: "2026-02-25T18:52:23Z",
    doi: "10.0000/test.1",
    license: { name: "CC BY 4.0" },
    files: NAMES.map((name, index) => {
      const text = files[name] ?? "";
      return change({ id: index + 1, name, size: Buffer.byteLength(text), computed_md5: md5(text), download_url: `https://ndownloader.figshare.com/files/${String(index + 1)}` });
    }),
  };
}

/** The options of the fake: the status of each redirect, and a fault for some requests of the storage, by their number from 1. */
interface FakeOptions {
  readonly redirect?: number;
  readonly faults?: Readonly<Record<number, number | "cut">>;
  /** The files of the dataset in place of `FILES`, with the same names. */
  readonly files?: Readonly<Record<string, string>>;
}

function fake(record: unknown, options: FakeOptions = {}): { transport: Transport; asked: string[] } {
  const asked: string[] = [];
  let stored = 0;
  const reply = (status: number, headers: Record<string, string>, body: string, bytes?: Uint8Array): Reply => ({ status, statusText: "", headers, body, bytes });
  const transport: Transport = (exchange: Exchange) => {
    asked.push(exchange.url);
    const url = new URL(exchange.url);
    if (exchange.url === API) return Promise.resolve(reply(200, { "content-type": "application/json" }, JSON.stringify(record)));
    if (url.host === "ndownloader.figshare.com") {
      const name = NAMES[Number(url.pathname.split("/").pop()) - 1] ?? "";
      return Promise.resolve(reply(options.redirect ?? 302, { location: `${STORE}/${name}?X-Amz-Signature=abc` }, ""));
    }
    if (url.host === new URL(STORM_BASE).host) {
      if (exchange.url === STORM_BASE) return Promise.resolve(reply(200, {}, "", new Uint8Array(Buffer.from(LISTING))));
      const data = STORMS[url.pathname.split("/").pop() ?? ""];
      return Promise.resolve(data === undefined ? reply(404, {}, "") : reply(200, {}, "", new Uint8Array(gzipSync(data))));
    }
    if (url.host === "www.weather.gov") return Promise.resolve(reply(200, {}, "", new Uint8Array(Buffer.from(ZONES))));
    stored += 1;
    const fault = options.faults?.[stored];
    if (fault === "cut") return Promise.reject(new TypeError("terminated"));
    if (fault !== undefined) return Promise.resolve(reply(fault, {}, ""));
    const data = Buffer.from((options.files ?? FILES)[decodeURIComponent(url.pathname.slice(1))] ?? "");
    const range = /^bytes=(\d+)-(\d+)$/.exec(exchange.headers["range"] ?? "");
    const start = Number(range?.[1]);
    const end = Number(range?.[2]);
    return Promise.resolve(reply(206, {}, "", new Uint8Array(data.subarray(start, end + 1))));
  };
  return { transport, asked };
}

function context(transport: Transport, chunkBytes = 7, log: (line: string) => void = () => undefined): FitContext {
  let now = 0;
  const scheduler = new HostScheduler({ now: () => now, sleep: (ms) => Promise.resolve(void (now += ms)) }, 1);
  const pace: Pace = { scheduler, now: () => now };
  return { pace, transport, chunkBytes, log };
}

describe("the parts of the fit job", () => {
  it("reads the files of the article in the order of the years, and only the years of the test", () => {
    const files = eagleFiles(article());
    expect([files.version, files.license, files.customers.name]).toEqual([4, "CC BY 4.0", "MCC.csv"]);
    expect(files.years.map((entry) => entry.year)).toEqual([2020, 2021]);
    expect(eagleFiles(article(), yearsOf("2021")).years.map((entry) => entry.file.name)).toEqual(["eaglei_outages_2021.csv"]);
    expect(() => eagleFiles(article(), yearsOf("2030"))).toThrow(/no outage file/);
    expect(() => eagleFiles({ ...(article() as object), files: [] })).toThrow(/MCC/);
  });

  it("gives the ranges of a file and the years of an option", () => {
    expect(ranges(10, 4)).toEqual([
      [0, 3],
      [4, 7],
      [8, 9],
    ]);
    expect(ranges(0, 4)).toEqual([]);
    expect(() => ranges(10, 0)).toThrow(RangeError);
    expect([2013, 2014, 2025, 2026].map(yearsOf("2014-2025"))).toEqual([false, true, true, false]);
    expect(() => yearsOf("2014 to 2025")).toThrow(RangeError);
  });

  it("gives each line when a line and a character of UTF-8 are in two chunks", async () => {
    const bytes = Buffer.from("a,Doña\r\nb\nc");
    const chunks = [bytes.subarray(0, 5), bytes.subarray(5, 9), bytes.subarray(9)];
    const lines: string[] = [];
    for await (const line of linesOf((async function* () { yield* chunks; })())) lines.push(line);
    expect(lines).toEqual(["a,Doña", "b", "c"]);
  });
});

describe("peakTally", () => {
  it("gives the largest count of each county, its counts above its customers and the count of 4 days", () => {
    const DAY = 86_400;
    const tally = peakTally(new Map([["99001", 10], ["99009", 1000]]));
    for (const [area, out] of [["99001", 4], ["99001", 12], ["99001", 30], ["99009", 50], ["99003", 7], ["99009", undefined]] as const) tally.add({ area, out, time: 0 });
    // A county with counts above its customers on fewer than 4 days has no held count. 99003 has no customers in the file.
    expect(tally.peaks()).toEqual({
      "99001": { peak: 30, held: 0, over: 2, days: 1 },
      "99003": { peak: 7, held: 0, over: 0, days: 0 },
      "99009": { peak: 50, held: 0, over: 0, days: 0 },
    });
    // A feed stuck for one day gives many readings above the customers on one day: no held count.
    for (let index = 0; index < 96; index += 1) tally.add({ area: "99001", out: 900, time: 3 * DAY + index * 900 });
    expect(tally.peaks()["99001"]).toEqual({ peak: 900, held: 0, over: 98, days: 2 });
    // The held count is the fourth largest daily maximum. The order of the lines does not change it.
    for (const [out, day] of [[11, 9], [20, 7], [15, 8], [13, 7]] as const) tally.add({ area: "99001", out, time: day * DAY });
    expect(tally.peaks()["99001"]).toEqual({ peak: 900, held: 15, over: 102, days: 5 });
  });

  it("gives a table of the counties with a count above their customers, by the held count over the customers", () => {
    const laws = {
      priors: { observation: { years: {}, customers: { "99001": 10, "99003": 100, "99005": 1000 } }, counts: {} },
      peaks: { "99001": { peak: 900, held: 20, over: 5, days: 4 }, "99003": { peak: 400, held: 300, over: 9 }, "99005": { peak: 50, held: 40, over: 0 } },
    } as unknown as EagleLaws;
    const table = peaksTable(laws);
    expect(table.split("\n").slice(0, 1)).toEqual(["2 counties have a count above their customers."]);
    // A record of a fit before the field days gives an empty cell.
    expect(table).toContain("| 99003 | 100 | 400 | 300 | 9 |  |\n| 99001 | 10 | 900 | 20 | 5 | 4 |");
    expect(table).not.toContain("99005");
    const one = peaksTable(laws, 1);
    expect(one).toContain("2 counties have a count above their customers.");
    expect(one).toContain("| 99003 |");
    expect(one).not.toContain("| 99001 |");
  });
});

describe("raiseCustomers", () => {
  it("uses the count of 4 days as the customers of a county when the file gives fewer", () => {
    const file = new Map([["99003", 100], ["99001", 10], ["99005", 50]]);
    const peaks = { "99001": { peak: 900, held: 20, over: 5 }, "99003": { peak: 400, held: 100, over: 3 }, "99005": { peak: 60, held: 0, over: 2 }, "99007": { peak: 70, held: 70, over: 0 } };
    const { customers, raised } = raiseCustomers(file, peaks);
    // 99003: a held count equal to the customers changes nothing. 99005: fewer than 4 days. 99007: not in the file, so it stays out.
    expect(Object.fromEntries(customers)).toEqual({ "99003": 100, "99001": 20, "99005": 50 });
    expect(raised).toEqual({ "99001": { file: 10, fit: 20 } });
    expect(file.get("99001")).toBe(10);
  });
});

describe("fitEagle", () => {
  it("reads the files two times with the option raise, and uses the count of 4 days of a county with too few customers", async () => {
    // The file gives 10 customers to the county 99001, which has 6 counts of 40 out on 2 days: too few days for a raise.
    // The file gives 100 customers to the county 99003, which has a count of 1000 on 4 days, a count of 500 and three counts of 5, each for 30 minutes.
    const days = ["2020-06-01", "2020-06-02", "2020-06-03", "2020-06-04", "2020-06-05", "2020-06-06", "2020-06-07", "2020-06-08"];
    const outs = [1000, 1000, 1000, 1000, 500, 5, 5, 5];
    // Each outage has two readings, 15 minutes apart. The county 99009, under its threshold, gives the times of the collection before and after it.
    const rows = days.flatMap((day, index) =>
      ["11:45:00", "12:00:00", "12:15:00", "12:30:00"].flatMap((time, step) => [
        ...(step === 1 || step === 2 ? [`99003,Filler,Teststate,${String(outs[index])},${day} ${time}`] : []),
        `99009,Filler,Teststate,1,${day} ${time}`,
      ]),
    );
    const [head, ...rest] = (FILES["eaglei_outages_2020.csv"] ?? "").split("\n");
    const files = {
      ...FILES,
      "MCC.csv": "\uFEFFCounty_FIPS,Customers\r\n99001,10\r\n99003,100\r\n99009,100000\r\n",
      "eaglei_outages_2020.csv": [head, ...rows, ...rest].join("\n"),
    };
    const once = fake(article(undefined, files), { files });
    const plain = await fitEagle(context(once.transport), { now: () => new Date("2026-11-22T00:00:00Z") });
    const twice = fake(article(undefined, files), { files });
    const laws = await fitEagle(context(twice.transport), { now: () => new Date("2026-11-22T00:00:00Z"), raise: true });
    const outageReads = (asked: readonly string[]): number => asked.filter((url) => /eaglei_outages_/u.test(url) && new URL(url).host === new URL(STORE).host).length;
    expect(outageReads(twice.asked)).toBe(2 * outageReads(once.asked));
    expect(plain.raised).toBeUndefined();
    // Without the option, the 10 customers of the file give 99001 a share of 1, the cap of a share, and the priors have the 10 customers.
    expect(plain.priors?.counts["infra.power.outage"]?.["99001"]).toEqual({ events: 1, share: 1 });
    expect(laws.priors?.counts["infra.power.outage"]?.["99001"]).toEqual({ events: 1, share: 1 });
    expect(plain.priors?.observation.customers["99001"]).toBe(10);
    expect(laws.options.raise).toBe(true);
    expect(laws.raised).toEqual({ "99003": { file: 100, fit: 1000 } });
    expect(laws.priors?.observation.customers).toEqual({ "99001": 10, "99003": 1000, "99009": 100_000 });
    // Without the option, each count of 5 is 5 % of 100 customers, so an event, and the 500 has a share of 1.
    // With it, a count of 5 is 0.5 % of 1000 customers, below the 1 % of an event, and the 500 has a share of 0.5.
    const plainCount = plain.priors?.counts["infra.power.outage"]?.["99003"];
    const raisedCount = laws.priors?.counts["infra.power.outage"]?.["99003"];
    expect(plainCount?.events).toBe(8);
    expect(raisedCount?.events).toBe(5);
    expect(raisedCount?.share).toBeCloseTo(4 + 0.5, 9);
    expect(plainCount?.share).toBeCloseTo(5 + 3 * 0.05, 9);
    expect(laws.events).toBe(plain.events - 3);
    // The peaks compare each count with the customers of the file, and the first read counts each line one time.
    expect(laws.peaks).toEqual(plain.peaks);
    expect(laws.peaks?.["99001"]).toEqual({ peak: 40, held: 0, over: 6, days: 2 });
    expect(laws.peaks?.["99003"]).toEqual({ peak: 1000, held: 1000, over: 10, days: 5 });
    const table = peaksTable(laws);
    expect(table).toContain("2 counties have a count above their customers. The fit uses the count of 4 days as the customers of 1 counties.");
    expect(table).toContain("| 99003 | 100 | 1000 | 1000 | 10 | 5 |");
    expect(table).toContain("| 99001 | 10 | 40 | 0 | 6 | 2 |");
  });

  it("reads each file in ranges with a redirect for each range, and gives the curve of each state", async () => {
    const { transport, asked } = fake(article());
    const laws = await fitEagle(context(transport), { now: () => new Date("2026-11-22T00:00:00Z") });
    expect(laws.source).toMatchObject({ article: EAGLE_ARTICLE, version: 4, license: "CC BY 4.0" });
    expect(laws.source.files.map((file) => file.name)).toEqual(["MCC.csv", "eaglei_outages_2020.csv", "eaglei_outages_2021.csv"]);
    expect(laws.events).toBe(1);
    expect(laws.skipped).toBe(2);
    // The files list both counties in 2020 and 2021. The county 99009 has 1 customer out of 100000, under the threshold, so it has no event.
    expect(laws.priors).toEqual({
      observation: { years: { "99001": 2, "99009": 2 }, customers: { "99001": 1000, "99009": 100_000 } },
      counts: { "infra.power.outage": { "99001": { events: 1, share: 0.04 } } },
    });
    expect(laws.peaks).toEqual({ "99001": { peak: 40, held: 0, over: 0, days: 0 }, "99009": { peak: 1, held: 0, over: 0, days: 0 } });
    expect(peaksTable(laws)).toContain("0 counties have a count above their customers.");
    expect(Object.keys(laws.regions)).toEqual(["99"]);
    expect(laws.regions["99"]).toMatchObject({ count: 1, censored: 0, open: 0, median: 5400 / 86_400 });
    const hosts = asked.map((url) => new URL(url).host);
    const store = hosts.filter((host) => host === new URL(STORE).host).length;
    expect(hosts.filter((host) => host === "ndownloader.figshare.com").length).toBe(store);
    expect(store).toBeGreaterThan(3);
    expect(lawsTable(laws)).toContain("| 99 | 1 | 0 | 90 | 0.0000 |");
  });

  it("gives the curves of each case from the storm events of the county at the start of each outage", async () => {
    const laws = await fitEagle(context(fake(article()).transport), { now: () => new Date("2026-11-22T00:00:00Z"), storms: { classes: STORM_CLASSES } });
    const causes = laws.causes;
    expect(causes?.storms.files.map((file) => file.name)).toEqual([
      "StormEvents_details-ftp_v1.0_d2019_c20260101.csv.gz",
      "StormEvents_details-ftp_v1.0_d2020_c20260101.csv.gz",
      "StormEvents_details-ftp_v1.0_d2021_c20260101.csv.gz",
    ]);
    expect(causes?.storms).toMatchObject({ zones: "bp16ap26.dbx", lines: 6, skipped: 3, tally: { rows: 3, placed: 2, unplaced: 0, other: { Hail: 1 } } });
    expect(causes?.options).toEqual({ before: 3600, after: 10_800 });
    expect(causes?.cases["met.winter.storm"]).toMatchObject({ events: 1, regions: { "99": { count: 1, median: 5400 / 86_400 } } });
    expect(causes?.cases["met.tornado"]?.events).toBe(1);
    expect(causes?.cases["met.flood"]).toEqual({ types: STORM_CLASSES["met.flood"], events: 0, regions: {} });
    // The one event is in a winter storm and a tornado, so the power outage, which counts the events in no storm case, has no event.
    const one = { "99001": { events: 1, share: 0.04 } };
    expect(laws.priors?.counts).toEqual({ "infra.power.outage": {}, "met.winter.storm": one, "met.heat.extreme": {}, "met.tropical.hurricane": {}, "met.flood": {}, "met.tornado": one });
    expect(laws.regions).toEqual((await fitEagle(context(fake(article()).transport), { now: () => new Date() })).regions);
  });

  it("gives the counts of the events with each join time of the sweep, in the order of the join times", async () => {
    const laws = await fitEagle(context(fake(article()).transport), { now: () => new Date("2026-11-22T00:00:00Z"), join: 3600, sweep: [7200, 0, 3600] });
    expect(laws.options.join).toBe(3600);
    // The county 99001 has 1 event in 2 years at a share of 0.04, so its rate is 0.02. The county 99009 has no event, so it has no rate.
    const row = { events: 1, joined: 0, truncated: 0, median: 0.02, most: { area: "99001", rate: 0.02 }, over: 0 };
    expect(laws.sweep).toEqual([0, 3600, 7200].map((join) => ({ join, ...row })));
    expect(sweepTable(laws.sweep ?? [])).toContain("| 2 | 1 | 0 | 0 | 0.020 | 99001 0.0 | 0 |");
    expect(JOIN_SWEEP).toEqual([0, 3600, 14_400, 43_200, 86_400]);
    expect((await fitEagle(context(fake(article()).transport), { now: () => new Date() })).sweep).toBeUndefined();
  });

  it("gives the median and the largest rate of the counties, and the counties over the limit", () => {
    const event = (area: string, peak: number) => ({ area, start: 0, seconds: 900, peak, censored: false });
    const events = [...Array.from({ length: PRIOR_LIMIT + 1 }, () => event("A", 100)), event("B", 50)];
    const observation = { years: { A: 1, B: 1, C: 1 }, customers: { A: 100, B: 100, C: 100 } };
    const customers = new Map(Object.entries(observation.customers));
    const tally = { counts: 0, times: 0, repeats: 0, unknown: 0, missing: 0, truncated: 2, joined: 3 };
    expect(joinSweep(3600, { events, tally }, observation, customers)).toEqual({ join: 3600, events: 14, joined: 3, truncated: 2, median: 6.75, most: { area: "A", rate: 13 }, over: 1 });
    expect(joinSweep(0, { events: [], tally }, observation, customers)).toMatchObject({ events: 0, median: 0, most: undefined, over: 0 });
  });

  it("gives the newest details file of each year of the test, and no other file", () => {
    expect(stormFiles(LISTING, (year) => year >= 2020)).toEqual([
      { year: 2020, name: "StormEvents_details-ftp_v1.0_d2020_c20260101.csv.gz" },
      { year: 2021, name: "StormEvents_details-ftp_v1.0_d2021_c20260101.csv.gz" },
      { year: 2022, name: "StormEvents_details-ftp_v1.0_d2022_c20260101.csv.gz" },
    ]);
    expect(stormFiles("<html></html>", () => true)).toEqual([]);
  });

  it("tries a range again after a cut and a 503, with a new redirect, and gives the same curves", async () => {
    const lines: string[] = [];
    const { transport, asked } = fake(article(), { faults: { 2: "cut", 3: 503 } });
    const laws = await fitEagle(context(transport, 7, (line) => lines.push(line)), { now: () => new Date("2026-11-22T00:00:00Z") });
    expect(laws.regions["99"]).toMatchObject({ count: 1, censored: 0, median: 5400 / 86_400 });
    expect(lines.filter((line) => line.includes("It comes again"))).toHaveLength(2);
    const hosts = asked.map((url) => new URL(url).host);
    expect(hosts.filter((host) => host === "ndownloader.figshare.com").length).toBe(hosts.filter((host) => host === new URL(STORE).host).length);
  });

  it("stops at once at a 404, and after RANGE_TRIES cuts of one range", async () => {
    const missing = fake(article(), { faults: { 1: 404 } });
    await expect(fitEagle(context(missing.transport), { now: () => new Date() })).rejects.toThrow(/404/);
    expect(missing.asked.filter((url) => new URL(url).host === new URL(STORE).host)).toHaveLength(1);
    const cuts = Object.fromEntries(Array.from({ length: RANGE_TRIES }, (_, index) => [index + 1, "cut" as const]));
    await expect(fitEagle(context(fake(article(), { faults: cuts }).transport), { now: () => new Date() })).rejects.toThrow(/gave no answer/);
  });

  it("refuses a file with a wrong MD5, and a download with no redirect", async () => {
    const wrong = article((file) => (file["name"] === "eaglei_outages_2021.csv" ? { ...file, computed_md5: md5("other") } : file));
    await expect(fitEagle(context(fake(wrong).transport), { now: () => new Date() })).rejects.toThrow(/MD5 of eaglei_outages_2021\.csv/);
    await expect(fitEagle(context(fake(article(), { redirect: 200 }).transport), { now: () => new Date() })).rejects.toThrow(/not a redirect/);
  });
});
