import { runLimit } from "@mark1russell7/rigor-bench";
import type { ArmProcess, BenchEnv, FreshRecord } from "@mark1russell7/rigor-bench/fresh";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BENCH_CUTS, BENCH_SEED, caseId } from "./inputs.ts";
import { AA_ARM, AA_CASE, freezeLimits, jobGate, jobRead, limitFaults, MIN_JOBS, MIN_READ_JOBS, readReport, RECORD_SCHEMA, runCases, runGate, type FrozenLimits, type JobRecord } from "./read.ts";

const ENV: BenchEnv = { cpu: "cpu-a", cores: 4, os: "linux", arch: "x64", node: "v26.0.0" };
const STAMP = { commit: "0".repeat(40), date: "2026-11-22", runs: ["1"] };

/** This function gives the record of a job: each arm has the time `scale * base` in each round, and the A/A ratio of round `r` is `aa(r)`. */
function jobRecord(job: string, scale: number, aa: (round: number) => number = () => 1, env: BenchEnv = ENV): JobRecord {
  const base: Record<string, number> = { m4: 0.2, m8: 5, m12: 120, m14: 400, [AA_ARM]: 120 };
  const rounds = 8;
  const processes: ArmProcess[] = [];
  const aaRecords: FreshRecord[] = [];
  for (let round = 0; round < rounds; round += 1) {
    for (const [position, arm] of Object.keys(base).entries()) {
      const ms = (base[arm] ?? 1) * scale * (arm === AA_ARM ? aa(round) : 1) * (1 + 0.01 * (round % 3));
      processes.push({ arm, case: arm === AA_ARM ? AA_CASE : arm, round, position, ms });
    }
    const a = (base[AA_CASE] ?? 1) * scale;
    aaRecords.push({ case: AA_CASE, round, first: round % 2 === 0 ? "a" : "b", a, b: a * aa(round), job, env });
  }
  return { schema: RECORD_SCHEMA, job, seed: BENCH_SEED, env, rounds, warnings: [], processes, aa: aaRecords };
}

const IDS = BENCH_CUTS.map(caseId);
const JOBS = [1, 1.05, 0.98, 1.1, 1.02].map((scale, index) => jobRecord(`job-${String(index + 1)}`, scale, (round) => (round % 2 === 0 ? 1.01 : 0.99)));
const frozen = (): FrozenLimits => freezeLimits(JOBS.map(jobRead), STAMP);

describe("the read of a job", () => {
  it("gives the median of the arm of each case, and the A/A statistics of the pair", () => {
    const read = jobRead(jobRecord("job", 2));
    expect(read.cases.map((item) => item.case)).toEqual(IDS);
    expect(read.cases.find((item) => item.case === "m12")?.ms).toBeCloseTo(242.4, 6);
    expect(read.cases.every((item) => item.processes === 8)).toBe(true);
    expect(read.aa?.case).toBe(AA_CASE);
    expect(read.aa?.spread).toBe(0);
  });
});

describe("the frozen limits", () => {
  it("are runLimit of the values of the jobs, with the commit and the date", () => {
    const file = frozen();
    const values = JOBS.map((job) => jobRead(job).cases.find((item) => item.case === "m12")?.ms ?? 0);
    expect(file.cases["m12"]).toEqual(runLimit(values));
    expect(file.jobs).toHaveLength(MIN_JOBS);
    expect(file.commit).toBe(STAMP.commit);
    expect(limitFaults(file)).toEqual([]);
  });

  it("in bench/limits.json have no fault, and each case of the bench has a limit", () => {
    const file = JSON.parse(readFileSync(new URL("./limits.json", import.meta.url), "utf8")) as FrozenLimits;
    expect(limitFaults(file)).toEqual([]);
    expect(Object.keys(file.cases)).toEqual(IDS);
    expect(file.jobs.length).toBeGreaterThanOrEqual(MIN_JOBS);
  });

  it("need 5 jobs or more", () => {
    expect(() => freezeLimits(JOBS.slice(1).map(jobRead), STAMP)).toThrow(RangeError);
  });

  it("show a limit that is not runLimit of its values as a fault", () => {
    const file = frozen();
    const m12 = file.cases["m12"];
    if (m12 === undefined) throw new Error("no m12");
    const looser: FrozenLimits = { ...file, cases: { ...file.cases, m12: { ...m12, limit: m12.limit * 2 } } };
    expect(limitFaults(looser)).toEqual(["The limit of m12 is not runLimit of its values."]);
    expect(limitFaults({ ...file, commit: "abc" })).toHaveLength(1);
  });
});

describe("the gate of a job", () => {
  it("passes when each case is at most its limit", () => {
    const gate = jobGate(jobRead(JOBS[0] as JobRecord), frozen());
    expect(gate.cases.map((item) => item.outcome)).toEqual(IDS.map(() => "within"));
    expect(gate.gate.outcome).toBe("pass");
  });

  it("blocks a case above its limit", () => {
    const gate = jobGate(jobRead(jobRecord("slow", 1.5)), frozen());
    expect(gate.gate.outcome).toBe("block");
    expect(gate.gate.blocks).toEqual(IDS);
  });

  it("gives no read, not a pass, on a noisy run, also when each value is under its limit", () => {
    const noisy = jobRecord("noisy", 0.5, (round) => (round % 2 === 0 ? 1.3 : 0.75));
    const gate = jobGate(jobRead(noisy), frozen());
    expect(gate.gate.outcome).toBe("no read");
    expect(gate.cases.every((item) => item.outcome === "cannot decide" && item.reason?.startsWith("The A/A spread") === true)).toBe(true);
  });

  it("gives no read on a CPU model with no frozen value, with no file, and with no A/A read", () => {
    expect(jobGate(jobRead(jobRecord("other", 1, () => 1, { ...ENV, cpu: "cpu-b" })), frozen()).gate.outcome).toBe("no read");
    expect(jobGate(jobRead(JOBS[0] as JobRecord), undefined).gate.outcome).toBe("no read");
    expect(jobGate(jobRead({ ...(JOBS[0] as JobRecord), aa: [] }), frozen()).gate.outcome).toBe("no read");
  });

  it("gives no read for a case that the job does not have", () => {
    const record = JOBS[0] as JobRecord;
    const gate = jobGate(jobRead({ ...record, processes: record.processes.filter((item) => item.arm !== "m8") }), frozen());
    expect(gate.cases.find((item) => item.case === "m8")?.outcome).toBe("cannot decide");
    expect(gate.gate.outcome).toBe("no read");
  });
});

describe("the gate of a run", () => {
  it("passes a case that 3 jobs or more read within their limits, and skips the jobs that do not read", () => {
    const file = frozen();
    const pass = jobGate(jobRead(JOBS[0] as JobRecord), file);
    const other = jobGate(jobRead(jobRecord("other", 0.6, () => 1, { ...ENV, cpu: "cpu-b" })), file);
    expect(runGate([pass, pass, pass]).outcome).toBe("pass");
    expect(runGate([pass, pass, other, pass]).outcome).toBe("pass");
    expect(runCases([pass, pass, other, pass]).map((item) => item.reads)).toEqual(IDS.map(() => 3));
  });

  it("gives no read when fewer than 3 jobs read a case, also when each read is within", () => {
    const file = frozen();
    const pass = jobGate(jobRead(JOBS[0] as JobRecord), file);
    const noisy = jobGate(jobRead(jobRecord("noisy", 0.5, (round) => (round % 2 === 0 ? 1.3 : 0.75))), file);
    expect(runGate([pass, pass, noisy, noisy]).outcome).toBe("no read");
    expect(runGate([0, 1, 2].map(() => jobGate(jobRead(JOBS[0] as JobRecord), undefined))).outcome).toBe("no read");
    expect(runCases([pass, pass])[0]?.reason).toBe(`2 jobs read the case, and the gate needs ${String(MIN_READ_JOBS)}.`);
  });

  it("blocks when one job that reads a case is above its limit", () => {
    const file = frozen();
    const pass = jobGate(jobRead(JOBS[0] as JobRecord), file);
    expect(runGate([pass, pass, pass, jobGate(jobRead(jobRecord("slow", 1.5)), file)]).outcome).toBe("block");
  });

  it("reports each job, each no read and the candidate limits", () => {
    const reads = JOBS.map(jobRead);
    const report = readReport(reads, reads.map((read) => jobGate(read, undefined)), frozen());
    expect(report).toContain("| job-1 | cpu-a |");
    expect(report).toContain("There is no file of frozen limits.");
    expect(report).toContain("| m12 | 0 | cannot decide: 0 jobs read the case");
    expect(report).toContain("The candidate limits of these 5 jobs");
  });
});
