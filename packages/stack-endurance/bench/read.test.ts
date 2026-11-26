import { CEILING_ONLY, runLimit } from "@mark1russell7/rigor-bench";
import type { ArmProcess, BenchEnv, FreshRecord } from "@mark1russell7/rigor-bench/fresh";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BENCH_CASES, BENCH_SEED } from "./inputs.ts";
import {
  AA_ARM,
  AA_CASE,
  FREEZE_WINDOW,
  freezeLimits,
  groupCases,
  groupTables,
  JOB_GATE,
  jobGate,
  jobRead,
  limitFaults,
  MIN_JOBS,
  MIN_READ_JOBS,
  MIN_RUNS,
  modelTables,
  NEAR_TITLE,
  NOISE_SPREAD,
  noiseCapTable,
  inMargin,
  readReport,
  RECORD_SCHEMA,
  recordFaults,
  runCases,
  runGate,
  stampNote,
  type FrozenLimits,
  type JobGate,
  type JobRecord,
} from "./read.ts";
import type { StampRecord } from "@mark1russell7/rigor-bench/stamp-gate";

const ENV: BenchEnv = { cpu: "cpu-a", cores: 4, os: "linux", arch: "x64", node: "v26.0.0" };
const STAMP = { commit: "0".repeat(40), date: "2026-11-22" };

/** This function gives the record of a job. Each arm has the time `scale * base` in each round. The A/A ratio of round `r` is `aa(r)`. */
function jobRecord(job: string, scale: number, aa: (round: number) => number = () => 1, env: BenchEnv = ENV): JobRecord {
  const base: Record<string, number> = { m4: 0.2, m8: 5, m12: 120, m14: 400, best: 3, [AA_ARM]: 120 };
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
  // Each made-up job is in a CI run of its own, with the id of the job.
  return { schema: RECORD_SCHEMA, job, run: job, seed: BENCH_SEED, env, rounds, warnings: [], processes, aa: aaRecords };
}

const IDS = BENCH_CASES;
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
    // The limit of a model is not above the ceiling, and the EPYC 7763 of the runners has its own limit.
    for (const table of Object.values(modelTables(file))) for (const limit of Object.values(table)) expect(limit.limit).toBeLessThanOrEqual(table.other.limit);
    expect(Object.keys(modelTables(file)["m12"] ?? {})).toContain("AMD EPYC 7763 64-Core Processor");
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

describe("the limits of each CPU model", () => {
  // 5 jobs of 5 runs on cpu-a and 2 faster jobs on cpu-b: cpu-a gets its own limit, and cpu-b gets the ceiling. A record with no run counts as its own run.
  const B = { ...ENV, cpu: "cpu-b" };
  const mixed = (): FrozenLimits => freezeLimits([...JOBS, jobRecord("b-1", 0.6, () => 1, B), jobRecord("b-2", 0.62, () => 1, B)].map(jobRead), STAMP);

  it("give each model with jobs of 5 runs or more the runLimit of its values, and the ceiling to the others", () => {
    const file = mixed();
    const table = modelTables(file)["m12"];
    expect(Object.keys(table ?? {}).sort()).toEqual(["cpu-a", "other"]);
    expect(table?.["cpu-a"]).toEqual(runLimit(JOBS.map((job) => jobRead(job).cases.find((item) => item.case === "m12")?.ms ?? 0)));
    expect(table?.other).toEqual(file.cases["m12"]);
    expect(table?.["cpu-a"]?.limit).toBeLessThan(table?.other.limit ?? 0);
  });

  it("block a value above the limit of its model, also when the value is under the ceiling", () => {
    const file = mixed();
    const gate = jobGate(jobRead(jobRecord("slow-a", 1.3)), file);
    const m12 = gate.cases.find((item) => item.case === "m12");
    expect(m12?.outcome).toBe("beyond");
    expect(m12?.model).toBe("cpu-a");
    expect(m12?.note).toBeUndefined();
    expect(m12?.ms ?? 0).toBeLessThan(file.cases["m12"]?.limit ?? 0);
  });

  it("read a model with fewer than 5 jobs at the ceiling, with the words of limitOnModel", () => {
    const file = mixed();
    const gate = jobGate(jobRead(jobRecord("b-3", 1.3, () => 1, B)), file);
    expect(gate.cases.map((item) => [item.outcome, item.model, item.note, item.limit])).toEqual(IDS.map((id) => ["within", "other", CEILING_ONLY, file.cases[id]?.limit]));
    const report = readReport([jobRead(jobRecord("b-3", 1.3, () => 1, B))], [gate], file);
    expect(report).toContain(`The jobs at the ceiling (${CEILING_ONLY}):`);
    expect(report).toContain("- b-3 (cpu-b)");
    expect(report).toContain("| cpu-a | 5 | 5 |");
  });

  it("match the exact CPU name: a model with few runs whose name holds the name of a table model reads at the ceiling", () => {
    const A2 = { ...ENV, cpu: "cpu-a2" };
    const file = freezeLimits([...JOBS, jobRecord("a2-1", 2, () => 1, A2), jobRecord("a2-2", 2.1, () => 1, A2)].map(jobRead), STAMP);
    expect(Object.keys(modelTables(file)["m12"] ?? {}).sort()).toEqual(["cpu-a", "other"]);
    const gate = jobGate(jobRead(jobRecord("a2-3", 2.05, () => 1, A2)), file);
    expect(gate.cases.map((item) => [item.outcome, item.model, item.note, item.limit])).toEqual(IDS.map((id) => ["within", "other", CEILING_ONLY, file.cases[id]?.limit]));
  });

  it("count runs, not jobs: 5 jobs of one run give no limit of the model", () => {
    const oneRun = JOBS.map((job) => ({ ...job, run: "run-1" }));
    const file = freezeLimits(oneRun.map(jobRead), STAMP);
    expect(MIN_RUNS).toBe(5);
    expect(Object.keys(modelTables(file)["m12"] ?? {})).toEqual(["other"]);
    expect(jobGate(jobRead(oneRun[0] as JobRecord), file).cases[0]?.note).toBe(CEILING_ONLY);
  });

  it("refuse a freeze with a job that has no run, and gate that job with the id of the job as its run", () => {
    const bare: JobRecord = { ...(JOBS[0] as JobRecord) };
    delete (bare as { run?: string }).run;
    expect(jobRead(bare).run).toBeUndefined();
    expect(() => freezeLimits([bare, ...JOBS.slice(1)].map(jobRead), STAMP)).toThrow(/The job job-1 has no run/);
    expect(() => freezeLimits([{ ...bare, run: "" }, ...JOBS.slice(1)].map(jobRead), STAMP)).toThrow(RangeError);
    expect(jobGate(jobRead(bare), frozen()).run).toBe("job-1");
  });

  it("keep the run and the commit of each job, and show a job with no run or commit as a fault", () => {
    const file = freezeLimits([{ ...(JOBS[0] as JobRecord), run: "r-9", commit: "a".repeat(40) }, ...JOBS.slice(1)].map(jobRead), STAMP);
    expect(file.jobs[0]).toEqual({ job: "job-1", cpu: "cpu-a", run: "r-9", commit: "a".repeat(40) });
    expect(file.jobs[1]).toEqual({ job: "job-2", cpu: "cpu-a", run: "job-2", commit: STAMP.commit });
    const faults = limitFaults({ ...file, jobs: file.jobs.map((job, index) => (index === 0 ? { ...job, run: "", commit: "abc" } : job)) });
    expect(faults.filter((fault) => fault.startsWith("The job "))).toEqual(["The job job-1 has no run.", "The job job-1 has no full SHA of its commit."]);
    // The run of a job also names a group, so a changed run changes the group limits. The runs of the file are then not the runs of its jobs.
    expect(faults.filter((fault) => !fault.startsWith("The job "))).toEqual(["The runs of the file are not the runs of its jobs.", ...IDS.map((id) => `The group limit of ${id} on cpu-a is not runLimit of the lowest value of each run of its jobs.`)]);
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
    expect(report).toContain("| m12 | 0 | cannot decide: 0 jobs read the case, and the gate needs 3. | cannot decide |");
    expect(report).toContain("The candidate limits of these 5 jobs");
  });
});

describe("the groups of a run", () => {
  // The jobs of one CPU model in one run make a group. The lowest value of the group decides.
  const B = { ...ENV, cpu: "cpu-b" };
  const mixed = (): FrozenLimits => freezeLimits([...JOBS, jobRecord("b-1", 0.6, () => 1, B), jobRecord("b-2", 0.62, () => 1, B)].map(jobRead), STAMP);
  const inRun = (record: JobRecord, run = "r-1"): JobRecord => ({ ...record, run });
  const gates = (records: readonly JobRecord[], file: FrozenLimits = mixed()): JobGate[] => records.map((record) => jobGate(jobRead(inRun(record)), file));

  it("read a group with one slow job within, and keep the outcome of each job", () => {
    const run = gates([jobRecord("a-1", 1), jobRecord("a-2", 1.02), jobRecord("a-3", 1.5)]);
    expect(run[2]?.gate.outcome).toBe("block");
    const cases = runCases(run);
    expect(cases.map((item) => [item.outcome, item.perJob])).toEqual(IDS.map(() => ["within", "beyond"]));
    const m12 = cases.find((item) => item.case === "m12")?.groups;
    expect(m12).toHaveLength(1);
    expect(m12?.[0]?.jobs.map((job) => job.outcome)).toEqual(["within", "within", "beyond"]);
    expect(m12?.[0]?.ms).toBe(m12?.[0]?.jobs[0]?.ms);
    expect(runGate(run).outcome).toBe("pass");
  });

  it("read a group beyond when each job of the group is above the limit", () => {
    const run = gates([jobRecord("a-1", 1.4), jobRecord("a-2", 1.45), jobRecord("a-3", 1.5)]);
    expect(runCases(run).map((item) => [item.outcome, item.perJob])).toEqual(IDS.map(() => ["beyond", "beyond"]));
    expect(runGate(run).outcome).toBe("block");
  });

  it("make a group of each CPU model and each run", () => {
    const file = mixed();
    const slow = jobGate(jobRead(inRun(jobRecord("a-3", 1.5), "r-2")), file);
    const run = [...gates([jobRecord("a-1", 1), jobRecord("a-2", 1)], file), slow];
    expect(groupCases(run, "m12").map((group) => [group.run, group.jobs.length, group.outcome])).toEqual([
      ["r-1", 2, "within"],
      ["r-2", 1, "beyond"],
    ]);
  });

  it("read a group of 1 job as the rule of one job", () => {
    const run = gates([jobRecord("a-1", 1.5), jobRecord("b-1", 0.6, () => 1, B), jobRecord("b-2", 0.6, () => 1, B)]);
    expect(runCases(run).map((item) => [item.outcome, item.perJob])).toEqual(IDS.map(() => ["beyond", "beyond"]));
    const within = gates([jobRecord("a-1", 1), jobRecord("b-1", 0.6, () => 1, B), jobRecord("b-2", 0.6, () => 1, B)]);
    expect(runCases(within).map((item) => [item.outcome, item.perJob])).toEqual(IDS.map(() => ["within", "within"]));
  });

  it("read each job at the ceiling alone, so one job above the ceiling blocks", () => {
    const run = gates([jobRecord("b-1", 0.6, () => 1, B), jobRecord("b-2", 0.6, () => 1, B), jobRecord("b-3", 3, () => 1, B)]);
    const m12 = groupCases(run, "m12");
    expect(m12.map((group) => [group.model, group.jobs.length, group.outcome])).toEqual([
      ["other", 1, "within"],
      ["other", 1, "within"],
      ["other", 1, "beyond"],
    ]);
    expect(runGate(run).outcome).toBe("block");
  });

  it("leave a no read out of its group, so a noisy fast job does not hold a slow group within", () => {
    const noisy = jobRecord("a-1", 0.5, (round) => (round % 2 === 0 ? 1.3 : 0.75));
    const run = gates([noisy, jobRecord("a-2", 1.5), jobRecord("a-3", 1.5)]);
    expect(run[0]?.gate.outcome).toBe("no read");
    const cases = runCases(run);
    expect(cases.map((item) => [item.outcome, item.reads])).toEqual(IDS.map(() => ["beyond", 2]));
    expect(cases[0]?.groups[0]?.jobs.map((job) => job.job)).toEqual(["a-2", "a-3"]);
  });

  it("keep the no reads: fewer than 3 jobs that read give no read, and no file gives no read", () => {
    expect(runGate(gates([jobRecord("a-1", 1), jobRecord("a-2", 1)])).outcome).toBe("no read");
    expect(runGate([0, 1, 2].map((index) => jobGate(jobRead(inRun(jobRecord(`a-${String(index)}`, 1))), undefined))).outcome).toBe("no read");
  });

  it("report each group near or beyond the limit, with its jobs and the value that decides", () => {
    const records = [jobRecord("a-1", 1), jobRecord("a-2", 1.02), jobRecord("a-3", 1.5)].map((record) => inRun(record));
    const run = gates(records);
    const report = readReport(records.map(jobRead), run, undefined);
    expect(report).toContain("| m12 | 3 | within | beyond |");
    expect(report).toContain(`${NEAR_TITLE}:`);
    const m12 = groupCases(run, "m12")[0];
    expect(m12?.kind).toBe("group");
    expect(report).toContain(`| m12 | r-1 | cpu-a | ${(m12?.worst ?? 0).toFixed(1)} | ${(m12?.limit ?? 0).toFixed(1)} (group) | a-1: ${(m12?.ms ?? 0).toFixed(1)}, `);
    expect(report).toMatch(/a-3: [\d.]+, 1\d\d\.\d%, beyond \| [\d.]+ \| within \|/);
    const quiet = gates([jobRecord("a-1", 1), jobRecord("a-2", 1), jobRecord("a-3", 1)]);
    expect(readReport([], quiet, undefined)).not.toContain(NEAR_TITLE);
  });

  it("report a group in the margin of its limit, and leave out a group in the range of the freeze", () => {
    // The group limit of cpu-a is the worst value of the freeze (the job of scale 1.1) plus the spread of the values (1.1 - 0.98).
    const slow = gates([jobRecord("a-1", 1.12), jobRecord("a-2", 1.15), jobRecord("a-3", 1.15)]);
    const m12 = groupCases(slow, "m12")[0];
    expect(m12?.kind).toBe("group");
    expect(m12?.worst).toBe(mixed().groups["m12"]?.["cpu-a"]?.worst);
    expect(m12?.outcome).toBe("within");
    expect(m12 !== undefined && inMargin(m12)).toBe(true);
    expect(readReport([], slow, undefined)).toContain(NEAR_TITLE);
    const freeze = gates([jobRecord("a-1", 1.09), jobRecord("a-2", 1.15), jobRecord("a-3", 1.15)]);
    const range = groupCases(freeze, "m12")[0];
    expect(range !== undefined && inMargin(range)).toBe(false);
    expect(readReport([], freeze, undefined)).not.toContain(NEAR_TITLE);
  });

  it("read a pair with one no read against the limit of one job", () => {
    const noisy = jobRecord("a-1", 1, (round) => (round % 2 === 0 ? 1.3 : 0.75));
    const run = gates([noisy, jobRecord("a-2", 1.15)]);
    expect(run[0]?.gate.outcome).toBe("no read");
    const m12 = groupCases(run, "m12");
    expect(m12.map((group) => [group.jobs.map((job) => job.job), group.kind])).toEqual([[["a-2"], "job"]]);
    expect(m12[0]?.limit).toBe(run[1]?.cases.find((item) => item.case === "m12")?.limit);
    expect(m12[0]?.worst).toBe(run[1]?.cases.find((item) => item.case === "m12")?.worst);
  });

  it("title the column of each job as the gate of the job alone, so a job that blocks in a run that passes is clear", () => {
    const records = [jobRecord("a-1", 1), jobRecord("a-2", 1.02), jobRecord("a-3", 1.5)].map((record) => inRun(record));
    const run = gates(records);
    const report = readReport(records.map(jobRead), run, undefined);
    expect(JOB_GATE).toBe("Gate of the job alone");
    expect(report).toContain(`| A/A spread | ${JOB_GATE} |`);
    expect(report).toMatch(/\| a-3 \| cpu-a \| .* \| block \|/);
    expect(runGate(run).outcome).toBe("pass");
  });

  it("mark a group at the ceiling in the report", () => {
    const run = gates([jobRecord("b-3", 3, () => 1, B)]);
    expect(readReport([], run, undefined)).toContain("| cpu-b (ceiling) |");
  });
});

describe("the group limits", () => {
  // 5 runs of cpu-a. The runs r-1 and r-5 each hold one slow machine, and the runs r-2 and r-4 hold 1 job.
  const runs: readonly (readonly [string, readonly number[]])[] = [
    ["r-1", [1, 1.3]],
    ["r-2", [1.02]],
    ["r-3", [0.98, 1]],
    ["r-4", [1.04]],
    ["r-5", [1.01, 1.2]],
  ];
  const records = (sets = runs): JobRecord[] => sets.flatMap(([run, scales]) => scales.map((scale, index) => ({ ...jobRecord(`${run}-${String(index + 1)}`, scale), run })));
  const file = (): FrozenLimits => freezeLimits(records().map(jobRead), STAMP);
  const m12 = (record: JobRecord): number => jobRead(record).cases.find((item) => item.case === "m12")?.ms ?? 0;

  it("are runLimit of the lowest value of each run of the model, with the run of each value", () => {
    const limits = file();
    const lows = runs.map(([run]) => Math.min(...records().filter((record) => record.run === run).map(m12)));
    expect(limits.groups["m12"]?.["cpu-a"]).toEqual({ ...runLimit(lows), runs: runs.map(([run]) => run) });
    expect(groupTables(limits.jobs, limits.cases)).toEqual(limits.groups);
    // The slow machines widen the limit of one job, and they do not widen the group limit.
    expect(limits.groups["m12"]?.["cpu-a"]?.limit ?? Infinity).toBeLessThan(modelTables(limits)["m12"]?.["cpu-a"]?.limit ?? 0);
    expect(limitFaults(limits)).toEqual([]);
  });

  it("read a group of 2 jobs or more against the group limit, and a group of 1 job against the limit of one job", () => {
    const limits = file();
    const group = limits.groups["m12"]?.["cpu-a"]?.limit ?? 0;
    const single = modelTables(limits)["m12"]?.["cpu-a"]?.limit ?? 0;
    // A uniform slowdown that puts each job between the two limits.
    const scale = (group + single) / 2 / m12(jobRecord("x", 1));
    const pair = [jobRecord("p-1", scale), jobRecord("p-2", scale)].map((record) => jobGate(jobRead({ ...record, run: "r-9" }), limits));
    expect(pair[0]?.cases.find((item) => item.case === "m12")).toMatchObject({ outcome: "within", limit: single, groupLimit: group });
    expect(groupCases(pair, "m12").map((item) => [item.kind, item.limit, item.outcome])).toEqual([["group", group, "beyond"]]);
    const lone = [jobGate(jobRead({ ...jobRecord("l-1", scale), run: "r-9" }), limits)];
    expect(groupCases(lone, "m12").map((item) => [item.kind, item.limit, item.outcome])).toEqual([["job", single, "within"]]);
  });

  it("need jobs of 5 runs or more on the model: 4 runs give no group limit, and the model reads at the ceiling", () => {
    const four = freezeLimits(records(runs.slice(0, 4)).map(jobRead), STAMP);
    expect(MIN_RUNS).toBe(5);
    expect(four.groups["m12"]).toEqual({});
    const pair = [jobRecord("p-1", 1), jobRecord("p-2", 1)].map((record) => jobGate(jobRead({ ...record, run: "r-9" }), four));
    expect(pair[0]?.cases.find((item) => item.case === "m12")?.groupLimit).toBeUndefined();
    expect(groupCases(pair, "m12").map((item) => [item.model, item.kind, item.jobs.length])).toEqual([
      ["other", "job", 1],
      ["other", "job", 1],
    ]);
  });

  it("show a group limit that the jobs do not give as a fault", () => {
    const limits = file();
    const entry = limits.groups["m12"]?.["cpu-a"];
    if (entry === undefined) throw new Error("no group limit");
    const fault = "The group limit of m12 on cpu-a is not runLimit of the lowest value of each run of its jobs.";
    expect(limitFaults({ ...limits, groups: { ...limits.groups, m12: { "cpu-a": { ...entry, limit: entry.limit * 1.1 } } } })).toEqual([fault]);
    expect(limitFaults({ ...limits, groups: { ...limits.groups, m12: {} } })).toEqual([fault]);
    expect(limitFaults({ ...limits, groups: { ...limits.groups, m12: { "cpu-a": entry, "cpu-b": entry } } })).toEqual([
      "The group limit of m12 on cpu-b is not runLimit of the lowest value of each run of its jobs.",
    ]);
  });

  it("in bench/limits.json are at most the limit of one job, for each model with its own limit", () => {
    const limits = JSON.parse(readFileSync(new URL("./limits.json", import.meta.url), "utf8")) as FrozenLimits;
    const tables = modelTables(limits);
    for (const id of IDS) {
      const models = Object.keys(tables[id] ?? {}).filter((model) => model !== "other");
      expect(Object.keys(limits.groups[id] ?? {}).sort()).toEqual(models.sort());
      for (const model of models) expect(limits.groups[id]?.[model]?.limit ?? Infinity).toBeLessThanOrEqual(tables[id]?.[model]?.limit ?? 0);
    }
  });
});

describe("the noise caps", () => {
  // A job with the A/A spread s: each A/A round has the ratio exp(s) or exp(-s), so the spread is s and the bias is 0.
  const spread = (s: number) => (round: number) => Math.exp(round % 2 === 0 ? s : -s);
  const B = { ...ENV, cpu: "cpu-b" };
  const A_SPREADS = [0.01, 0.012, 0.014, 0.016, 0.018];
  const records = (): JobRecord[] => [
    ...A_SPREADS.map((s, index) => ({ ...jobRecord(`a-${String(index + 1)}`, 1, spread(s)), run: `r-${String(index + 1)}` })),
    { ...jobRecord("b-1", 0.6, spread(0.2), B), run: "r-1" },
    { ...jobRecord("b-2", 0.6, spread(0.25), B), run: "r-2" },
  ];
  const file = (): FrozenLimits => freezeLimits(records().map(jobRead), STAMP);
  const spreadOf = (record: JobRecord): number => jobRead(record).aa?.spread ?? Number.NaN;

  it("are the worst A/A spread plus the high side of the spreads: worst - median", () => {
    const cap = runLimit([0.03, 0.01, 0.05, 0.02, 0.04], NOISE_SPREAD);
    expect(cap).toMatchObject({ limit: 0.07, worst: 0.05, values: [0.03, 0.01, 0.05, 0.02, 0.04] });
    // The spread of a noise cap is its high side: the worst spread minus the median spread.
    expect(cap.spread).toBeCloseTo(0.02, 12);
    expect(() => runLimit([0.01, 0.02, 0.03, 0.04], NOISE_SPREAD)).toThrow(RangeError);
  });

  it("do not go up for a job with less noise, and runLimit of the spreads does", () => {
    const base = [0.01, 0.02, 0.03, 0.04, 0.05];
    const quieter = [0.001, 0.02, 0.03, 0.04, 0.05];
    expect(runLimit(quieter, NOISE_SPREAD).limit).toBe(runLimit(base, NOISE_SPREAD).limit);
    expect(runLimit(quieter).limit).toBeGreaterThan(runLimit(base).limit);
    // A quieter worst job makes the cap smaller.
    expect(runLimit([0.01, 0.02, 0.03, 0.04, 0.045], NOISE_SPREAD).limit).toBeLessThan(runLimit(base, NOISE_SPREAD).limit);
  });

  it("give a model with jobs of 5 runs or more its own cap from the spreads of its jobs", () => {
    const limits = file();
    const spreads = records().map(spreadOf);
    expect(Object.keys(limits.noiseCaps).sort()).toEqual(["cpu-a", "other"]);
    expect(limits.noiseCaps["cpu-a"]).toEqual(runLimit(spreads.slice(0, 5), NOISE_SPREAD));
    expect(limits.noiseCaps.other).toEqual(runLimit(spreads, NOISE_SPREAD));
    expect(limits.noiseCaps["cpu-a"]?.limit).toBeCloseTo(0.022, 12);
    expect(limitFaults(limits)).toEqual([]);
    // A job of cpu-a with a spread above its own cap is a no read, also under the pooled cap.
    const noisy = jobGate(jobRead({ ...jobRecord("a-9", 1, spread(0.05)), run: "r-9" }), limits);
    expect(0.05).toBeLessThan(limits.noiseCaps.other.limit);
    expect(noisy.gate.outcome).toBe("no read");
    expect(noisy.cases[0]?.reason).toBe(`The A/A spread 0.0500 is above the noise cap of cpu-a ${String(limits.noiseCaps["cpu-a"]?.limit)}.`);
  });

  it("give a model with jobs of fewer than 5 runs the pooled cap", () => {
    const limits = file();
    const gate = jobGate(jobRead({ ...jobRecord("b-9", 0.6, spread(0.05), B), run: "r-9" }), limits);
    expect(gate.gate.outcome).toBe("pass");
    const noisy = jobGate(jobRead({ ...jobRecord("b-8", 0.6, spread(0.6), B), run: "r-9" }), limits);
    expect(noisy.cases[0]?.reason).toBe(`The A/A spread 0.6000 is above the pooled noise cap ${String(limits.noiseCaps.other.limit)}.`);
    // 5 jobs of one run give no cap of the model.
    const oneRun = JOBS.map((job) => ({ ...job, run: "run-1" }));
    expect(Object.keys(freezeLimits(oneRun.map(jobRead), STAMP).noiseCaps)).toEqual(["other"]);
  });

  it("show a cap that the jobs do not give as a fault", () => {
    const limits = file();
    const own = limits.noiseCaps["cpu-a"];
    if (own === undefined) throw new Error("no cap of cpu-a");
    const fault = "The noise cap of cpu-a is not the noise cap of the A/A spreads of its jobs.";
    expect(limitFaults({ ...limits, noiseCaps: { ...limits.noiseCaps, "cpu-a": { ...own, limit: own.limit * 2 } } })).toEqual([fault]);
    expect(limitFaults({ ...limits, noiseCaps: { other: limits.noiseCaps.other } })).toEqual([fault]);
    expect(noiseCapTable(limits.jobs, limits.noiseCaps.other.values)).toEqual(limits.noiseCaps);
  });

  it("in bench/limits.json give each model with its own limit its own cap", () => {
    const limits = JSON.parse(readFileSync(new URL("./limits.json", import.meta.url), "utf8")) as FrozenLimits;
    const models = Object.keys(modelTables(limits)["m12"] ?? {});
    expect(Object.keys(limits.noiseCaps).sort()).toEqual(models.sort());
    for (const model of models) expect(limits.noiseCaps[model]?.limit ?? Infinity).toBeLessThanOrEqual(limits.noiseCaps.other.limit);
  });
});

describe("the faults of a freeze against the records of its jobs", () => {
  const B = { ...ENV, cpu: "cpu-b" };
  const records = (): JobRecord[] => [...JOBS, jobRecord("b-1", 0.6, () => 1.02, B)];
  const file = (): FrozenLimits => freezeLimits(records().map(jobRead), STAMP);

  it("gives no fault for the records of the freeze, also with the records of other runs", () => {
    expect(recordFaults(file(), records().map(jobRead))).toEqual([]);
    expect(recordFaults(file(), [...records(), { ...jobRecord("job-1", 3), run: "r-other" }].map(jobRead))).toEqual([]);
  });

  it("finds an A/A spread that is not the A/A spread of the record, which limitFaults cannot find", () => {
    // The file agrees with itself: its caps come from its spreads. Only the records show that a spread changed.
    const changed = records().map((record, index) => (index === 2 ? jobRecord(record.job, 0.98, (round) => (round % 2 === 0 ? 1.05 : 0.95)) : record));
    expect(limitFaults(file())).toEqual([]);
    const faults = recordFaults(file(), changed.map(jobRead));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toMatch(/^The job job-3 of the run job-3 has the A\/A spread .* in its record, not /);
  });

  it("finds a value and a CPU model that are not those of the record", () => {
    const slower = records().map((record, index) => (index === 0 ? jobRecord(record.job, 1.2, (round) => (round % 2 === 0 ? 1.01 : 0.99)) : record));
    expect(recordFaults(file(), slower.map(jobRead)).filter((fault) => fault.includes("has the value"))).toHaveLength(IDS.length);
    const moved = records().map((record, index) => (index === 5 ? { ...record, env: ENV } : record));
    expect(recordFaults(file(), moved.map(jobRead))).toEqual(["The job b-1 of the run b-1 has the CPU model cpu-a in its record, not cpu-b."]);
  });

  it("finds a job with no record and a job with two records", () => {
    expect(recordFaults(file(), records().slice(1).map(jobRead))).toEqual(["The job job-1 of the run job-1 has 0 records, not 1."]);
    expect(recordFaults(file(), [...records(), JOBS[0] as JobRecord].map(jobRead))).toEqual(["The job job-1 of the run job-1 has 2 records, not 1."]);
  });
});

describe("the window of a freeze", () => {
  // Each job is in a run of its own. Run r-i has the scale 1 + i / 100, so a later run is slower.
  const runs = (count: number, env: BenchEnv = ENV): JobRecord[] =>
    Array.from({ length: count }, (_, index) => ({ ...jobRecord(`${env.cpu}-${String(index + 1)}`, 1 + index / 100, (round) => (round % 2 === 0 ? 1.01 : 0.99), env), run: String(100 + index) }));

  it("keeps the last runs of each CPU model and names the kept runs", () => {
    const B = { ...ENV, cpu: "cpu-b" };
    const file = freezeLimits([...runs(FREEZE_WINDOW + 3), ...runs(3, B)].map(jobRead), STAMP);
    expect(file.window).toBe(FREEZE_WINDOW);
    expect(file.jobs.filter((job) => job.cpu === "cpu-a").map((job) => job.run)).toEqual(Array.from({ length: FREEZE_WINDOW }, (_, index) => String(103 + index)));
    expect(file.jobs.filter((job) => job.cpu === "cpu-b").map((job) => job.run)).toEqual(["100", "101", "102"]);
    expect(file.runs).toEqual(Array.from({ length: FREEZE_WINDOW + 3 }, (_, index) => String(100 + index)).filter((run) => file.jobs.some((job) => job.run === run)));
    expect(limitFaults(file)).toEqual([]);
  });

  it("uses the given order of the runs and refuses an order that does not name each run", () => {
    const records = runs(7);
    const reversed = records.map((record) => record.run ?? "").reverse();
    const file = freezeLimits(records.map(jobRead), { ...STAMP, runs: reversed, window: 5 });
    expect(file.jobs.map((job) => job.run)).toEqual(["100", "101", "102", "103", "104"]);
    expect(() => freezeLimits(records.map(jobRead), { ...STAMP, runs: reversed.slice(1) })).toThrow(/not in the order/);
    expect(() => freezeLimits(records.map(jobRead), { ...STAMP, window: 4 })).toThrow(RangeError);
  });

  it("is a fault when a model has more runs than the window, or the runs are not the runs of the jobs", () => {
    const file = freezeLimits(runs(7).map(jobRead), { ...STAMP, window: 7 });
    expect(limitFaults({ ...file, window: 6 })).toEqual(["The CPU model cpu-a has 7 runs, more than the window 6."]);
    expect(limitFaults({ ...file, window: 4 })).toEqual(["The window 4 is not a whole number of 5 or more."]);
    expect(limitFaults({ ...file, runs: file.runs.slice(1) })).toEqual(["The runs of the file are not the runs of its jobs."]);
  });
});

describe("the stamp of the timed code in the records", () => {
  /** A made-up stamp record. Its hash joins its parts, as the hash of a real stamp does. */
  const stamp = (code: string, node = "26"): StampRecord => ({
    schema: "bench-stamp/1",
    hash: `hash-${code}-${node}`,
    parts: { code, engines: "engines-1", data: "data-1", bundler: "esbuild@0.25.0", node },
    inputs: ["bench/child.ts"],
    engines: [],
  });
  const stamped = (records: readonly JobRecord[], code: (index: number) => StampRecord | undefined): JobRecord[] =>
    records.map((record, index) => {
      const value = code(index);
      return value === undefined ? record : { ...record, stamp: value };
    });

  it("keeps the one stamp of the jobs in the file, and no stamp when no job has one", () => {
    const file = freezeLimits(stamped(JOBS, () => stamp("a")).map(jobRead), STAMP);
    expect(file.stamp).toEqual(stamp("a"));
    expect(limitFaults(file)).toEqual([]);
    expect(frozen().stamp).toBeUndefined();
    expect(jobRead(stamped(JOBS, () => stamp("a"))[0] as JobRecord).stamp).toEqual(stamp("a"));
  });

  it("refuses a freeze of jobs with other timed code, or with a stamp in only some jobs", () => {
    expect(() => freezeLimits(stamped(JOBS, (index) => stamp(index === 3 ? "b" : "a")).map(jobRead), STAMP)).toThrow(/The job job-4 of the run job-4 times other code than the job job-1: the parts code differ/);
    expect(() => freezeLimits(stamped(JOBS, (index) => stamp("a", index === 1 ? "24" : "26")).map(jobRead), STAMP)).toThrow(/the parts node differ/);
    expect(() => freezeLimits(stamped(JOBS, (index) => (index < 2 ? undefined : stamp("a"))).map(jobRead), STAMP)).toThrow(/The jobs job-1, job-2 have no stamp/);
  });

  it("is a fault when the stamp of the file is not a stamp record", () => {
    const file = freezeLimits(stamped(JOBS, () => stamp("a")).map(jobRead), STAMP);
    expect(limitFaults({ ...file, stamp: { ...stamp("a"), schema: "other" } as unknown as StampRecord })).toEqual(["The stamp of the file is not a stamp record."]);
  });

  it("finds a record with other timed code than the file, and no stamp fault for a file with no stamp", () => {
    const records = stamped(JOBS, () => stamp("a"));
    const file = freezeLimits(records.map(jobRead), STAMP);
    expect(recordFaults(file, records.map(jobRead))).toEqual([]);
    const other = records.map((record, index) => (index === 2 ? { ...record, stamp: stamp("b") } : record));
    expect(recordFaults(file, other.map(jobRead))).toEqual(["The job job-3 of the run job-3 has other timed code in its record than the file: code."]);
    const bare = records.map((record, index) => (index === 0 ? JOBS[0] as JobRecord : record));
    expect(recordFaults(file, bare.map(jobRead))).toEqual(["The job job-1 of the run job-1 has other timed code in its record than the file: record."]);
    expect(recordFaults(frozen(), records.map(jobRead))).toEqual([]);
  });

  it("tells if the jobs of a run time the code of the freeze", () => {
    const file = freezeLimits(stamped(JOBS, () => stamp("a")).map(jobRead), STAMP);
    const reads = stamped(JOBS.slice(0, 3), (index) => (index === 0 ? stamp("a") : index === 1 ? stamp("b") : undefined)).map(jobRead);
    expect(stampNote(file, reads)).toBe("The timed code of 1 of the 3 jobs is the timed code of the freeze. The timed code of 1 jobs differs from the freeze in the parts code. 1 jobs have no stamp.");
    expect(stampNote(file, stamped(JOBS, () => stamp("a")).map(jobRead))).toBe("The timed code of 5 of the 5 jobs is the timed code of the freeze.");
    expect(stampNote(frozen(), reads)).toMatch(/^The file of limits has no stamp/);
  });
});
