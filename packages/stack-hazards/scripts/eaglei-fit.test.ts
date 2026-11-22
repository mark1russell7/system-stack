import { createHash } from "node:crypto";
import type { Exchange, Pace, Reply, Transport } from "polite-crawler/api";
import { HostScheduler } from "polite-crawler/politeness";
import { describe, expect, it } from "vitest";
import { EAGLE_ARTICLE, RANGE_TRIES, eagleFiles, fitEagle, lawsTable, linesOf, ranges, yearsOf, type FitContext } from "./eaglei-fit.ts";

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
const md5 = (text: string): string => createHash("md5").update(text).digest("hex");

function article(change: (file: Record<string, unknown>) => Record<string, unknown> = (file) => file): unknown {
  return {
    version: 4,
    modified_date: "2026-02-25T18:52:23Z",
    doi: "10.0000/test.1",
    license: { name: "CC BY 4.0" },
    files: NAMES.map((name, index) => {
      const text = FILES[name] ?? "";
      return change({ id: index + 1, name, size: Buffer.byteLength(text), computed_md5: md5(text), download_url: `https://ndownloader.figshare.com/files/${String(index + 1)}` });
    }),
  };
}

/** The options of the fake: the status of each redirect, and a fault for some requests of the storage, by their number from 1. */
interface FakeOptions {
  readonly redirect?: number;
  readonly faults?: Readonly<Record<number, number | "cut">>;
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
    stored += 1;
    const fault = options.faults?.[stored];
    if (fault === "cut") return Promise.reject(new TypeError("terminated"));
    if (fault !== undefined) return Promise.resolve(reply(fault, {}, ""));
    const data = Buffer.from(FILES[decodeURIComponent(url.pathname.slice(1))] ?? "");
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

describe("fitEagle", () => {
  it("reads each file in ranges with a redirect for each range, and gives the curve of each state", async () => {
    const { transport, asked } = fake(article());
    const laws = await fitEagle(context(transport), { now: () => new Date("2026-11-22T00:00:00Z") });
    expect(laws.source).toMatchObject({ article: EAGLE_ARTICLE, version: 4, license: "CC BY 4.0" });
    expect(laws.source.files.map((file) => file.name)).toEqual(["MCC.csv", "eaglei_outages_2020.csv", "eaglei_outages_2021.csv"]);
    expect(laws.events).toBe(1);
    expect(laws.skipped).toBe(2);
    expect(Object.keys(laws.regions)).toEqual(["99"]);
    expect(laws.regions["99"]).toMatchObject({ count: 1, censored: 0, open: 0, median: 5400 / 86_400 });
    const hosts = asked.map((url) => new URL(url).host);
    const store = hosts.filter((host) => host === new URL(STORE).host).length;
    expect(hosts.filter((host) => host === "ndownloader.figshare.com").length).toBe(store);
    expect(store).toBeGreaterThan(3);
    expect(lawsTable(laws)).toContain("| 99 | 1 | 0 | 90 | 0.0000 |");
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
