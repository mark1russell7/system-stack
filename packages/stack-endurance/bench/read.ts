/**
 * The read of the bench of `independentStop`: the value of each case in each job, the frozen limits and the gate.
 *
 * - The value of a case in a job is the median time of one call over the fresh children of its arm, in milliseconds.
 * - The limit of a case is `runLimit` of rigor-bench: the worst value of 5 jobs or more plus their spread.
 * - A CPU model with jobs of 5 runs or more in the freeze gets its own limit. Each other model of the freeze gets the ceiling: the limit over all the jobs.
 * - The noise cap is the `runLimit` of the A/A spreads of the same jobs (`aaLimits`). A job above it is a no read.
 * - A job on a CPU model with no frozen value is a no read. A no read is not a pass.
 * - The gate reads the jobs of one CPU model in one run as one group. A group is beyond only when its lowest value is above the limit (`groupCases`).
 * - A group of 2 jobs or more on a model with its own limit reads against the group limit of the model (`groupTables`).
 *   The group limit is `runLimit` of the lowest value of each run of the model.
 *   A group of 1 job reads against the limit of one job.
 */
import { aaLimits, aaStats, CEILING_ONLY, gateOf, limitOnModel, runLimit, type CaseAaStat, type Gate, type LimitOutcome, type RunLimit } from "@mark1russell7/rigor-bench";
import { armTimes, type ArmProcess, type BenchEnv, type FreshRecord } from "@mark1russell7/rigor-bench/fresh";
import { BENCH_CUTS, BENCH_SEED, caseId } from "./inputs.ts";

/** The schema of the record of one job. */
export const RECORD_SCHEMA = "stack-endurance/independent-bench/1";
/** The schema of the file of the frozen limits. */
export const LIMITS_SCHEMA = "stack-endurance/independent-limits/2";
/** The measure of each value and each limit. */
export const MEASURE = "the median time of one call of independentStop over the fresh children of one job, in milliseconds";
/** The rule of each limit. */
export const RULE =
  "runLimit of rigor-bench: the worst value of 5 runs or more plus their spread (max - min). Each CPU model with jobs of 5 runs or more has its own limit. The other models of the freeze get the limit over all the jobs, the ceiling. The group limit of a model is runLimit of the lowest value of each run of the model. A group of 2 jobs or more reads against it. A group of 1 job reads against the limit of one job.";
/** The case of the A/A pair: the largest case of the sum over the states, with a second arm of the same child. */
export const AA_CASE = caseId(12);
/** The id of the second arm of the A/A pair. */
export const AA_ARM = `${AA_CASE}#aa`;
/** The fewest jobs that give a frozen limit. */
export const MIN_JOBS = 5;
/** The fewest CI runs of one CPU model that give the model its own limit. */
export const MIN_RUNS = 5;

/** The record of one job of the bench, as `main.ts run` writes it. */
export interface JobRecord {
  readonly schema: typeof RECORD_SCHEMA;
  readonly job: string;
  readonly commit?: string;
  readonly run?: string;
  readonly seed: string;
  readonly env: BenchEnv;
  readonly rounds: number;
  readonly warnings: readonly string[];
  readonly processes: readonly ArmProcess[];
  readonly aa: readonly FreshRecord[];
}

/** The value of one case in one job. */
export interface CaseValue {
  readonly case: string;
  readonly cuts: number;
  /** The median time of one call over the children of the arm, in milliseconds. */
  readonly ms: number;
  readonly p10: number;
  readonly p90: number;
  readonly processes: number;
}

/** The read of one job: the value of each case and the A/A statistics. */
export interface JobRead {
  readonly job: string;
  readonly cpu: string;
  /** The CI run of the job. A record with no run gives the id of the job. */
  readonly run: string;
  /** The commit that the job timed, when the record has one. */
  readonly commit?: string;
  readonly cases: readonly CaseValue[];
  /** The A/A statistics of the pair of `AA_CASE`. A job with no A/A records has none. */
  readonly aa: CaseAaStat | undefined;
}

/** This function gives the read of one job. Only the arm with the id of its case gives the value. The A/A copy gives only the noise. */
export function jobRead(record: JobRecord): JobRead {
  const times = new Map(armTimes(record.processes).map((arm) => [arm.arm, arm]));
  const cases = BENCH_CUTS.flatMap((cuts) => {
    const arm = times.get(caseId(cuts));
    return arm === undefined ? [] : [{ case: arm.case, cuts, ms: arm.median, p10: arm.p10, p90: arm.p90, processes: arm.processes }];
  });
  const aa = record.aa.length === 0 ? undefined : aaStats(record.aa).find((stat) => stat.case === AA_CASE);
  return { job: record.job, cpu: record.env.cpu, run: record.run ?? record.job, ...(record.commit === undefined ? {} : { commit: record.commit }), cases, aa };
}

/** The file of the frozen limits, with the values, the commit and the date of each limit. */
export interface FrozenLimits {
  readonly schema: typeof LIMITS_SCHEMA;
  readonly measure: string;
  readonly rule: string;
  readonly seed: string;
  /** The commit that names the freeze. Each job has the commit that it timed. With two commits or more, the timed code of the commits is the same. */
  readonly commit: string;
  /** The date of the freeze, `YYYY-MM-DD`. */
  readonly date: string;
  /** The CI runs of the jobs. */
  readonly runs: readonly string[];
  /** The job and the CPU model of each value, in the order of the values. */
  readonly jobs: readonly { readonly job: string; readonly cpu: string; readonly run: string; readonly commit: string }[];
  /** The limit of each case, in milliseconds, with its values. */
  readonly cases: Readonly<Record<string, RunLimit>>;
  /** The noise cap: the limit of the A/A spread of a job, on a log scale, with its values. */
  readonly noiseCap: RunLimit;
  /** The group limit of each case for each CPU model with jobs of `MIN_RUNS` runs or more (`groupTables`). `limitFaults` computes each one again from the jobs. */
  readonly groups: Readonly<Record<string, Readonly<Record<string, GroupLimit>>>>;
}

/** The group limit of one case on one CPU model: `runLimit` of the lowest value of each run, with the run of each value. */
export type GroupLimit = RunLimit & { readonly runs: readonly string[] };

/** The stamp of a freeze. */
export interface FreezeStamp {
  readonly commit: string;
  readonly date: string;
  readonly runs: readonly string[];
}

/**
 * This function gives the frozen limits of the reads of 5 jobs or more.
 *
 * @throws RangeError when there are fewer than `MIN_JOBS` jobs, when a job has no A/A read, or when a job does not have each case
 */
export function freezeLimits(reads: readonly JobRead[], stamp: FreezeStamp): FrozenLimits {
  if (reads.length < MIN_JOBS) throw new RangeError(`A freeze needs ${String(MIN_JOBS)} jobs or more, not ${String(reads.length)}.`);
  const cases: Record<string, RunLimit> = {};
  for (const cuts of BENCH_CUTS) {
    const id = caseId(cuts);
    const values = reads.map((read) => {
      const value = read.cases.find((item) => item.case === id);
      if (value === undefined) throw new RangeError(`The job ${read.job} has no value of ${id}.`);
      return value.ms;
    });
    cases[id] = runLimit(values);
  }
  const aa = reads.map((read) => {
    if (read.aa === undefined) throw new RangeError(`The job ${read.job} has no A/A read.`);
    return { job: read.job, cases: [read.aa] };
  });
  // Each job stays: a freeze keeps the worst job, and a noisy job widens the cap only in this file, which a review reads.
  const noiseCap = aaLimits(aa, { cut: Infinity }).fallback.noiseCap;
  const jobs = reads.map((read) => ({ job: read.job, cpu: read.cpu, run: read.run, commit: read.commit ?? stamp.commit }));
  return {
    schema: LIMITS_SCHEMA,
    measure: MEASURE,
    rule: RULE,
    seed: BENCH_SEED,
    commit: stamp.commit,
    date: stamp.date,
    runs: stamp.runs,
    jobs,
    cases,
    noiseCap,
    groups: groupTables(jobs, cases),
  };
}

/** This function gives the faults of a file of frozen limits. It computes each limit again from its values. */
export function limitFaults(file: FrozenLimits): string[] {
  const faults: string[] = [];
  if (file.schema !== LIMITS_SCHEMA) faults.push(`The schema is ${String(file.schema)}, not ${LIMITS_SCHEMA}.`);
  if (file.seed !== BENCH_SEED) faults.push(`The seed is ${file.seed}, not the seed of the inputs ${BENCH_SEED}.`);
  if (!/^[0-9a-f]{40}$/.test(file.commit)) faults.push(`The commit ${file.commit} is not a full SHA.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(file.date)) faults.push(`The date ${file.date} is not YYYY-MM-DD.`);
  const check = (name: string, limit: RunLimit | undefined): void => {
    if (limit === undefined) return void faults.push(`The file has no limit of ${name}.`);
    if (limit.values.length !== file.jobs.length) faults.push(`The limit of ${name} has ${String(limit.values.length)} values, not one for each of the ${String(file.jobs.length)} jobs.`);
    const again = limit.values.length < MIN_JOBS ? undefined : runLimit(limit.values);
    if (again === undefined || again.limit !== limit.limit || again.worst !== limit.worst || again.spread !== limit.spread) faults.push(`The limit of ${name} is not runLimit of its values.`);
  };
  for (const job of file.jobs) {
    if (typeof job.run !== "string" || job.run === "") faults.push(`The job ${job.job} has no run.`);
    if (typeof job.commit !== "string" || !/^[0-9a-f]{40}$/.test(job.commit)) faults.push(`The job ${job.job} has no full SHA of its commit.`);
  }
  for (const cuts of BENCH_CUTS) check(caseId(cuts), file.cases[caseId(cuts)]);
  check("the noise cap", file.noiseCap);
  // Each group limit must be the limit that the jobs and the values of the file give. Thus a review of the jobs is also a review of the group limits.
  const again = groupTables(file.jobs, file.cases);
  const stored: FrozenLimits["groups"] = typeof file.groups === "object" && file.groups !== null ? file.groups : {};
  for (const id of new Set([...Object.keys(again), ...Object.keys(stored)])) {
    for (const cpu of new Set([...Object.keys(again[id] ?? {}), ...Object.keys(stored[id] ?? {})])) {
      if (JSON.stringify(stored[id]?.[cpu]) !== JSON.stringify(again[id]?.[cpu])) faults.push(`The group limit of ${id} on ${cpu} is not runLimit of the lowest value of each run of its jobs.`);
    }
  }
  return faults;
}

/** The limits of one case: the limit of each CPU model with jobs of `MIN_RUNS` runs or more, and the ceiling `other`. The key of a model is its full name. */
export type CaseTable = Readonly<Record<string, RunLimit>> & { readonly other: RunLimit };

/**
 * This function gives the table of the limits of each case of a file of frozen limits.
 *
 * - The limit of a CPU model is `runLimit` of the values of its jobs. It needs jobs of `MIN_RUNS` different runs or more, because one run can give 5 jobs.
 * - The entry `other` is the limit of the case over all the jobs. It is the ceiling: the limit of a model is not above it.
 * - The tables come from the jobs and the values of the file, so `limitFaults` also examines them.
 */
export function modelTables(file: FrozenLimits): Record<string, CaseTable> {
  const tables: Record<string, CaseTable> = {};
  for (const [id, pooled] of Object.entries(file.cases)) {
    const models = [...modelRuns(file.jobs, pooled.values)].map(([cpu, runs]) => [cpu, runLimit([...runs.values()].flat())] as const);
    tables[id] = { ...Object.fromEntries(models), other: pooled };
  }
  return tables;
}

/** This function gives the values of each CPU model with jobs of `MIN_RUNS` runs or more, by run, in the order of the jobs. The key of a model is its full name. */
function modelRuns(jobs: FrozenLimits["jobs"], values: readonly number[]): Map<string, Map<string, number[]>> {
  const models = new Map<string, Map<string, number[]>>();
  jobs.forEach((job, index) => {
    const value = values[index];
    if (value === undefined || job.cpu === "other") return;
    const runs = models.get(job.cpu) ?? new Map<string, number[]>();
    runs.set(job.run, [...(runs.get(job.run) ?? []), value]);
    models.set(job.cpu, runs);
  });
  return new Map([...models].filter(([, runs]) => runs.size >= MIN_RUNS));
}

/**
 * This function gives the group limit of each case on each CPU model with jobs of `MIN_RUNS` runs or more.
 *
 * - The group limit is `runLimit` of the lowest value of each run of the model. A run with 1 job of the model gives the value of that job.
 * - One slow machine in a run of 2 jobs or more does not widen the group limit. The other jobs of its run give the lowest value.
 * - A lone slow job in a run of the freeze widens the group limit by 2 times its excess. Its value is the lowest value of its run.
 * - The group limit is at most the limit of one job. The lowest values are at most the values, and their spread is at most the spread of the values.
 */
export function groupTables(jobs: FrozenLimits["jobs"], cases: Readonly<Record<string, RunLimit>>): Record<string, Record<string, GroupLimit>> {
  const tables: Record<string, Record<string, GroupLimit>> = {};
  for (const [id, pooled] of Object.entries(cases)) {
    const models = [...modelRuns(jobs, pooled.values)].map(([cpu, runs]) => [cpu, { ...runLimit([...runs.values()].map((values) => Math.min(...values))), runs: [...runs.keys()] }] as const);
    tables[id] = Object.fromEntries(models);
  }
  return tables;
}

/** The outcome of one case of one job against the frozen limits. */
export interface CaseOutcome {
  readonly case: string;
  readonly outcome: LimitOutcome;
  readonly ms: number | undefined;
  readonly limit: number | undefined;
  /** The key of the limit in the table of the case: the CPU model, or `other` for the ceiling. */
  readonly model?: string;
  /** The group limit of the model, for a group of 2 jobs or more. A job at the ceiling has none. */
  readonly groupLimit?: number;
  /** The words of `limitOnModel` for a read at the ceiling. A pass at the ceiling does not hold a gain. */
  readonly note?: string;
  /** The reason of a no read. */
  readonly reason?: string;
}

/** The gate of one job: the outcome of each case and the gate of the outcomes. */
export interface JobGate {
  readonly job: string;
  readonly cpu: string;
  /** The CI run of the job. The jobs of one CPU model in one run make a group (`groupCases`). */
  readonly run: string;
  readonly cases: readonly CaseOutcome[];
  readonly gate: Gate;
}

/**
 * This function gives the gate of one job against the frozen limits.
 *
 * - A case is `within` when its value is at most its limit, and `beyond` when its value is above the limit.
 * - The limit is the entry of the exact CPU name in the table of the case, or the ceiling with the note `CEILING_ONLY` (`limitOnModel`).
 *   A part of a name does not match. A model of the freeze with few runs can have a name that holds the name of a table model.
 * - Each case is `cannot decide` when the job has no A/A read, or when the A/A spread or the A/A bias is above the noise cap.
 * - Each case is `cannot decide` when the CPU model of the job has no frozen value, or when there is no file of limits.
 * - A case that the job or the file does not have is `cannot decide`. `gateOf` makes each `cannot decide` a no read.
 */
export function jobGate(read: JobRead, limits: FrozenLimits | undefined): JobGate {
  const why = jobNoRead(read, limits);
  const tables = limits === undefined ? {} : modelTables(limits);
  const cases = BENCH_CUTS.map((cuts): CaseOutcome => {
    const id = caseId(cuts);
    const ms = read.cases.find((item) => item.case === id)?.ms;
    const table = tables[id];
    const own = table !== undefined && read.cpu !== "other" && Object.hasOwn(table, read.cpu) ? table[read.cpu] : undefined;
    const model = own === undefined ? "other" : read.cpu;
    const on = table === undefined ? undefined : limitOnModel({ gain: (own ?? table.other).limit, ceiling: table.other.limit, models: own === undefined ? [] : [model] }, model);
    const limit = on?.limit;
    const group = own === undefined ? undefined : limits?.groups[id]?.[read.cpu]?.limit;
    const place = table === undefined ? {} : { model, ...(group === undefined ? {} : { groupLimit: group }), ...(on?.note === undefined ? {} : { note: on.note }) };
    if (why !== undefined) return { case: id, outcome: "cannot decide", ms, limit, reason: why };
    if (ms === undefined) return { case: id, outcome: "cannot decide", ms, limit, reason: "The job has no value of the case." };
    if (limit === undefined) return { case: id, outcome: "cannot decide", ms, limit, reason: "The file has no limit of the case." };
    return { case: id, outcome: ms <= limit ? "within" : "beyond", ms, limit, ...place };
  });
  return { job: read.job, cpu: read.cpu, run: read.run, cases, gate: gateOf(cases) };
}

function jobNoRead(read: JobRead, limits: FrozenLimits | undefined): string | undefined {
  if (limits === undefined) return "There is no file of frozen limits.";
  if (!limits.jobs.some((job) => job.cpu === read.cpu)) return `The CPU model ${read.cpu} has no frozen value.`;
  if (read.aa === undefined) return "The job has no A/A read.";
  const cap = limits.noiseCap.limit;
  if (read.aa.spread > cap) return `The A/A spread ${read.aa.spread.toFixed(4)} is above the noise cap ${String(cap)}.`;
  if (Math.abs(read.aa.median) > cap) return `The A/A bias ${read.aa.median.toFixed(4)} is above the noise cap ${String(cap)}.`;
  return undefined;
}

/** The jobs that must read a case before the run decides it. */
export const MIN_READ_JOBS = 3;

/** The share of its limit at which the report shows a value: a value at 97% of its limit or more is near the limit. */
export const NEAR = 0.97;

/** One job of a group, with its value and its own outcome. */
export interface GroupJob {
  readonly job: string;
  readonly ms: number;
  readonly outcome: "within" | "beyond";
}

/** The read of one case by one group of jobs. */
export interface GroupCase {
  readonly case: string;
  readonly run: string;
  readonly cpu: string;
  /** The key of the limit in the table of the case: the CPU model, or `other` for the ceiling. */
  readonly model: string;
  /** The limit that decides. A group of 2 jobs or more on its own model has the group limit. Each other group has the limit of one job. */
  readonly limit: number;
  /** The kind of the limit that decides. */
  readonly kind: "group" | "job";
  /** The jobs of the group that read the case. Each job keeps its own outcome, against the limit of one job. */
  readonly jobs: readonly GroupJob[];
  /** The value that decides: the lowest value of the jobs of the group. */
  readonly ms: number;
  readonly outcome: "within" | "beyond";
}

/**
 * This function gives the groups that read one case.
 *
 * - The jobs of one CPU model in one run time one commit on one kind of runner. On the limit of their model, they make one group.
 * - A group is `beyond` only when its lowest value is above the limit. A change of the code makes each job of the group slower, so the lowest value shows it.
 *   One slow machine makes one job slower, and the other jobs of the group keep the group within.
 * - A group of 2 jobs or more reads against the group limit of its model (`groupTables`). The lowest of 2 jobs or more is lower than the value of one job.
 * - A group of 1 job reads against the limit of one job. Its lowest value is its only value, so its limit must hold the slow machines of the freeze.
 * - A job at the ceiling is a group of its own, so it reads as before. The ceiling stops only a large regression.
 * - A job that does not read the case (a no read) is not in a group. A noisy job has no valid value, so its value does not keep a group within.
 */
export function groupCases(gates: readonly JobGate[], id: string): GroupCase[] {
  const groups = new Map<string, { run: string; cpu: string; model: string; limit: number; groupLimit: number | undefined; jobs: GroupJob[] }>();
  for (const gate of gates) {
    const item = gate.cases.find((value) => value.case === id);
    if (item === undefined || item.outcome === "cannot decide" || item.ms === undefined || item.limit === undefined) continue;
    const model = item.model ?? "other";
    const own = item.note === undefined && model === gate.cpu;
    const key = JSON.stringify(own ? [gate.run, gate.cpu] : [gate.run, gate.cpu, gate.job]);
    const group = groups.get(key) ?? { run: gate.run, cpu: gate.cpu, model, limit: item.limit, groupLimit: own ? item.groupLimit : undefined, jobs: [] };
    group.jobs.push({ job: gate.job, ms: item.ms, outcome: item.outcome });
    groups.set(key, group);
  }
  return [...groups.values()].map(({ groupLimit, ...group }): GroupCase => {
    const ms = Math.min(...group.jobs.map((job) => job.ms));
    const kind = groupLimit !== undefined && group.jobs.length >= 2 ? "group" : "job";
    const limit = kind === "group" ? (groupLimit ?? group.limit) : group.limit;
    return { case: id, ...group, limit, kind, ms, outcome: ms <= limit ? "within" : "beyond" };
  });
}

/** The outcome of one case over all jobs of a run. */
export interface RunCase {
  readonly case: string;
  readonly outcome: LimitOutcome;
  /** The jobs that read the case: their outcome is `within` or `beyond`. */
  readonly reads: number;
  /** The reason of a no read. */
  readonly reason?: string;
  /** The groups that read the case (`groupCases`). */
  readonly groups: readonly GroupCase[];
  /** The outcome of the rule of one job: the case is `beyond` when one job is `beyond`. The gate does not use it. The report shows it. */
  readonly perJob: LimitOutcome;
}

/**
 * This function gives the outcome of each case over all jobs of a run.
 *
 * - A case is `beyond` when a group that reads it is `beyond` (`groupCases`).
 * - A case is `within` when at least `MIN_READ_JOBS` jobs read it and each group is `within`.
 * - Each other case is `cannot decide`. A job on a CPU model with no frozen value, a noisy job and a missing job do not read.
 */
export function runCases(gates: readonly JobGate[]): RunCase[] {
  return BENCH_CUTS.map((cuts): RunCase => {
    const id = caseId(cuts);
    const groups = groupCases(gates, id);
    const jobs = groups.flatMap((group) => group.jobs);
    const reads = jobs.length;
    const enough = reads >= MIN_READ_JOBS;
    const perJob: LimitOutcome = jobs.some((job) => job.outcome === "beyond") ? "beyond" : enough ? "within" : "cannot decide";
    if (groups.some((group) => group.outcome === "beyond")) return { case: id, outcome: "beyond", reads, groups, perJob };
    if (enough) return { case: id, outcome: "within", reads, groups, perJob };
    return { case: id, outcome: "cannot decide", reads, reason: `${String(reads)} jobs read the case, and the gate needs ${String(MIN_READ_JOBS)}.`, groups, perJob };
  });
}

/** This function gives the gate of a run: `gateOf` over the outcome of each case in `runCases`. */
export function runGate(gates: readonly JobGate[]): Gate {
  return gateOf(runCases(gates));
}

/** The title of the column of the gate of each job in the report. It is the gate of the job alone: the gate of the run reads the groups. */
export const JOB_GATE = "Gate of the job alone";

const ms = (value: number | undefined): string => (value === undefined ? "-" : value < 10 ? value.toFixed(3) : value.toFixed(1));

/** This function gives the Markdown report of a read: the value of each case in each job, the gate, and the candidate limits. */
export function readReport(reads: readonly JobRead[], gates: readonly JobGate[], candidate: FrozenLimits | undefined): string {
  const ids = BENCH_CUTS.map((cuts) => caseId(cuts));
  const lines = [
    "## The cost of independentStop",
    "",
    `The value of a case is ${MEASURE}.`,
    "",
    `| Job | CPU | ${ids.map((id) => `${id} (ms)`).join(" | ")} | A/A spread | ${JOB_GATE} |`,
    `| --- | --- | ${ids.map(() => "---").join(" | ")} | --- | --- |`,
  ];
  for (const read of reads) {
    const gate = gates.find((item) => item.job === read.job)?.gate.outcome ?? "no read";
    const values = ids.map((id) => ms(read.cases.find((item) => item.case === id)?.ms));
    lines.push(`| ${read.job} | ${read.cpu} | ${values.join(" | ")} | ${read.aa === undefined ? "-" : read.aa.spread.toFixed(4)} | ${gate} |`);
  }
  const run = runCases(gates);
  lines.push(
    "",
    "The gate of each case over the groups. A group is the jobs of one CPU model in one run. Its lowest value decides. A group of 2 jobs or more reads against the group limit. The last column gives the rule of one job, which the gate does not use:",
    "",
    "| Case | Jobs that read | Outcome | Rule of one job |",
    "| --- | --- | --- | --- |",
  );
  for (const item of run) lines.push(`| ${item.case} | ${String(item.reads)} | ${item.outcome}${item.reason === undefined ? "" : `: ${item.reason}`} | ${item.perJob} |`);
  const near = run.flatMap((item) => item.groups.filter((group) => group.ms >= NEAR * group.limit || group.jobs.some((job) => job.outcome === "beyond")));
  if (near.length > 0) {
    lines.push(
      "",
      `The groups with a lowest value at ${String(Math.round(NEAR * 100))}% of the limit or more, or with a job beyond the limit of one job. The lowest value of the group decides:`,
      "",
      "| Case | Run | CPU | Limit (ms) | Jobs: value (ms), share of the limit, outcome of the job alone | Lowest (ms) | Outcome |",
      "| --- | --- | --- | --- | --- | --- | --- |",
    );
    for (const group of near) {
      const jobs = group.jobs.map((job) => `${job.job}: ${ms(job.ms)}, ${((100 * job.ms) / group.limit).toFixed(1)}%, ${job.outcome}`).join("<br>");
      const cpu = group.model === "other" ? `${group.cpu} (ceiling)` : group.cpu;
      lines.push(`| ${group.case} | ${group.run} | ${cpu} | ${ms(group.limit)} (${group.kind === "group" ? "group" : "one job"}) | ${jobs} | ${ms(group.ms)} | ${group.outcome} |`);
    }
  }
  const reasons = [...new Set(gates.flatMap((gate) => gate.cases.flatMap((item) => (item.reason === undefined ? [] : [`${gate.job}: ${item.reason}`]))))];
  if (reasons.length > 0) lines.push("", "The jobs that do not read:", "", ...reasons.map((reason) => `- ${reason}`));
  const ceiling = [...new Set(gates.flatMap((gate) => (gate.cases.some((item) => item.note !== undefined && item.outcome !== "cannot decide") ? [`${gate.job} (${gate.cpu})`] : [])))];
  if (ceiling.length > 0) lines.push("", `The jobs at the ceiling (${CEILING_ONLY}):`, "", ...ceiling.map((job) => `- ${job}`));
  if (candidate !== undefined) {
    lines.push("", `The candidate limits of these ${String(reads.length)} jobs (${RULE}):`, "", "| Case | Worst (ms) | Spread (ms) | Limit (ms) |", "| --- | --- | --- | --- |");
    for (const id of ids) {
      const limit = candidate.cases[id];
      if (limit !== undefined) lines.push(`| ${id} | ${ms(limit.worst)} | ${ms(limit.spread)} | ${String(limit.limit)} |`);
    }
    const tables = modelTables(candidate);
    const models = Object.keys(tables[ids[0] ?? ""] ?? {}).filter((model) => model !== "other");
    if (models.length > 0) {
      lines.push("", `The candidate limits of each CPU model with jobs of ${String(MIN_RUNS)} runs or more:`, "", `| CPU | Runs | Jobs | ${ids.map((id) => `${id} (ms)`).join(" | ")} |`, `| --- | --- | --- | ${ids.map(() => "---").join(" | ")} |`);
      for (const model of models) {
        const jobs = candidate.jobs.filter((job) => job.cpu === model);
        lines.push(`| ${model} | ${String(new Set(jobs.map((job) => job.run)).size)} | ${String(jobs.length)} | ${ids.map((id) => String(tables[id]?.[model]?.limit ?? "-")).join(" | ")} |`);
      }
      lines.push("", "The candidate group limits of each of these models: runLimit of the lowest value of each run. A group of 2 jobs or more reads against them:", "", `| CPU | ${ids.map((id) => `${id} (ms)`).join(" | ")} |`, `| --- | ${ids.map(() => "---").join(" | ")} |`);
      for (const model of models) lines.push(`| ${model} | ${ids.map((id) => String(candidate.groups[id]?.[model]?.limit ?? "-")).join(" | ")} |`);
    }
    lines.push("", `The candidate noise cap is ${String(candidate.noiseCap.limit)}, on a log scale.`);
  }
  return `${lines.join("\n")}\n`;
}
