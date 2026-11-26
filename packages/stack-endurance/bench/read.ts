/**
 * The read of the bench of `independentStop`: the value of each case in each job, the frozen limits and the gate.
 *
 * - The value of a case in a job is the median time of one call over the fresh children of its arm, in milliseconds.
 * - The limit of a case is `runLimit` of rigor-bench: the worst value of 5 jobs or more plus their spread.
 * - A CPU model with jobs of 5 runs or more in the freeze gets its own limit. Each other model of the freeze gets the ceiling: the limit over all the jobs.
 * - The noise cap is the worst A/A spread of the jobs plus the high side of their spread (`NOISE_SPREAD`). A job above it is a no read.
 *   A CPU model with its own limit has its own noise cap. Each other model reads against the pooled noise cap (`noiseCapTable`).
 * - A job on a CPU model with no frozen value is a no read. A no read is not a pass.
 * - The gate reads the jobs of one CPU model in one run as one group. A group is beyond only when its lowest value is above the limit (`groupCases`).
 * - A group of 2 jobs or more on a model with its own limit reads against the group limit of the model (`groupTables`).
 *   The group limit is `runLimit` of the lowest value of each run of the model.
 *   A group of 1 job reads against the limit of one job.
 */
import { aaStats, CEILING_ONLY, gateOf, limitOnModel, modelRuns, modelTable, recentRuns, runLimit, type CaseAaStat, type Gate, type LimitOutcome, type ModelTable, type RunLimit, type RunValue } from "@mark1russell7/rigor-bench";
import { armTimes, type ArmProcess, type BenchEnv, type FreshRecord } from "@mark1russell7/rigor-bench/fresh";
import { BENCH_CASES, BENCH_SEED, caseId } from "./inputs.ts";
import { stampChanges, type StampRecord } from "@mark1russell7/rigor-bench/stamp-gate";

/** The schema of the record of one job. */
export const RECORD_SCHEMA = "stack-endurance/independent-bench/2";
/** The schema of the file of the frozen limits. */
export const LIMITS_SCHEMA = "stack-endurance/independent-limits/5";
/** The measure of each value and each limit. */
export const MEASURE = "the median time of one call of the function of the case (independentStop for the cases m, bestEndurance for the case best) over the fresh children of one job, in milliseconds";
/** The rule of each limit. */
export const RULE =
  "runLimit of rigor-bench: the worst value of 5 runs or more plus their spread (max - min). Each CPU model with jobs of 5 runs or more has its own limit. The other models of the freeze get the limit over all the jobs, the ceiling. The group limit of a model is runLimit of the lowest value of each run of the model. A group of 2 jobs or more reads against it. A group of 1 job reads against the limit of one job.";
/** The rule of each noise cap. */
export const NOISE_RULE =
  "The worst A/A spread of the jobs plus the high side of their spread (worst - median), on a log scale. Each CPU model with jobs of 5 runs or more has its own noise cap from the A/A spreads of its jobs. The other models get the pooled noise cap of all the jobs.";
/** The case of the A/A pair: the largest case of the sum over the states, with a second arm of the same child. */
export const AA_CASE = caseId(12);
/** The id of the second arm of the A/A pair. */
export const AA_ARM = `${AA_CASE}#aa`;
/** The fewest jobs that give a frozen limit. */
export const MIN_JOBS = 5;
/** The fewest CI runs of one CPU model that give the model its own limit. */
export const MIN_RUNS = 5;
/**
 * The window of a freeze: the most CI runs of one CPU model that a freeze keeps. A freeze keeps the last runs of each model (`recentRuns` of rigor-bench).
 * - A freeze that only adds runs only makes each limit larger. With the window, an old run of a model goes out when a new run comes in.
 * - The window is `MIN_RUNS` or more, so a model with `MIN_RUNS` runs keeps its own limit.
 */
export const FREEZE_WINDOW = 8;

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
  /** The stamp of the timed code of the job (`bench/stamp.json`). A record from before the stamp has none. */
  readonly stamp?: StampRecord;
}

/** The value of one case in one job. */
export interface CaseValue {
  readonly case: string;
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
  /** The CI run of the job, when the record has one. A freeze refuses a read with no run. */
  readonly run?: string;
  /** The commit that the job timed, when the record has one. */
  readonly commit?: string;
  readonly cases: readonly CaseValue[];
  /** The A/A statistics of the pair of `AA_CASE`. A job with no A/A records has none. */
  readonly aa: CaseAaStat | undefined;
  /** The stamp of the timed code of the job, when its record has one. */
  readonly stamp?: StampRecord;
}

/** This function gives the read of one job. Only the arm with the id of its case gives the value. The A/A copy gives only the noise. */
export function jobRead(record: JobRecord): JobRead {
  const times = new Map(armTimes(record.processes).map((arm) => [arm.arm, arm]));
  const cases = BENCH_CASES.flatMap((id) => {
    const arm = times.get(id);
    return arm === undefined ? [] : [{ case: arm.case, ms: arm.median, p10: arm.p10, p90: arm.p90, processes: arm.processes }];
  });
  const aa = record.aa.length === 0 ? undefined : aaStats(record.aa).find((stat) => stat.case === AA_CASE);
  return {
    job: record.job,
    cpu: record.env.cpu,
    ...(record.run === undefined ? {} : { run: record.run }),
    ...(record.commit === undefined ? {} : { commit: record.commit }),
    cases,
    aa,
    ...(record.stamp === undefined ? {} : { stamp: record.stamp }),
  };
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
  /** The CI runs of the jobs, oldest first. */
  readonly runs: readonly string[];
  /** The most runs of one CPU model in the file (`FREEZE_WINDOW` by default). `limitFaults` checks it. */
  readonly window: number;
  /** The job and the CPU model of each value, in the order of the values. */
  readonly jobs: readonly { readonly job: string; readonly cpu: string; readonly run: string; readonly commit: string }[];
  /** The limit of each case, in milliseconds, with its values. */
  readonly cases: Readonly<Record<string, RunLimit>>;
  /** The rule of each noise cap. */
  readonly noiseRule: string;
  /** The noise cap of each CPU model with jobs of `MIN_RUNS` runs or more, and the pooled noise cap `other` (`noiseCapTable`). `limitFaults` computes each one again. */
  readonly noiseCaps: NoiseCapTable;
  /** The group limit of each case for each CPU model with jobs of `MIN_RUNS` runs or more (`groupTables`). `limitFaults` computes each one again from the jobs. */
  readonly groups: Readonly<Record<string, Readonly<Record<string, GroupLimit>>>>;
  /**
   * The stamp of the timed code of each job of the freeze. Thus the claim that the runs of the freeze time the same code is a check.
   * A file from records with no stamp has none. Then that claim is the judgement of a review.
   */
  readonly stamp?: StampRecord;
}

/** The group limit of one case on one CPU model: `runLimit` of the lowest value of each run, with the run of each value. */
export type GroupLimit = RunLimit & { readonly runs: readonly string[] };

/**
 * A noise cap: the limit of the A/A spread of a job, on a log scale, with its values.
 * It is `runLimit` of rigor-bench with the spread `worse-half` (`NOISE_SPREAD`). The field `spread` is the worst spread minus the median spread.
 */
export type NoiseCap = RunLimit;

/** The noise caps of a freeze: the cap of each CPU model with jobs of `MIN_RUNS` runs or more, and the pooled cap `other`. The key of a model is its full name. */
export type NoiseCapTable = ModelTable<NoiseCap>;

/**
 * The options of `runLimit` for a noise cap. The cap is the worst spread plus the high side (worst - median).
 * A spread under the median does not set the cap. Thus a job with less noise does not make the cap larger. A cap needs `MIN_JOBS` spreads or more.
 */
export const NOISE_SPREAD = { spread: "worse-half", minimum: MIN_JOBS } as const;

/**
 * This function gives the noise caps of the jobs of a freeze from the A/A spread of each job, in the order of the jobs.
 *
 * - Each CPU model with jobs of `MIN_RUNS` runs or more has the noise cap of the spreads of its jobs (`modelTable` of rigor-bench).
 * - The entry `other` is the pooled noise cap of all the jobs. Each other model reads against it.
 *   Its values stay in the order of the jobs, because `limitFaults` reads the spread of each job from them.
 */
export function noiseCapTable(jobs: FrozenLimits["jobs"], spreads: readonly number[]): NoiseCapTable {
  const models = modelTable(runValues(jobs, spreads), (runs) => runLimit(runs.flat(), NOISE_SPREAD), { minimumRuns: MIN_RUNS });
  return { ...models, other: runLimit(spreads, NOISE_SPREAD) };
}

/** The stamp of a freeze. */
export interface FreezeStamp {
  readonly commit: string;
  readonly date: string;
  /** The order of the CI runs, oldest first. It names each run of the reads one time. The default is the order of the first read of each run. */
  readonly runs?: readonly string[];
  /** The most runs of one CPU model that the freeze keeps. The default is `FREEZE_WINDOW`. */
  readonly window?: number;
}

/**
 * This function gives the frozen limits of the reads of 5 jobs or more.
 *
 * - Each read needs its CI run. A model limit counts the runs of the model, so a job with no run cannot count as a run of its own.
 * - The freeze keeps the last `window` runs of each CPU model in the order of the runs. The jobs of the file stay in the order of the reads.
 *
 * - Each job of the window has the same stamp of its timed code, or no job has a stamp. The file keeps that stamp.
 *
 * @throws RangeError when there are fewer than `MIN_JOBS` jobs in the window. Also when a job has no run, no A/A read or no value of each case. Also when the order does not name each run one time
 * @throws RangeError when the jobs of the window have different stamps, or only some of them have a stamp
 * @throws RangeError when the file has a fault of `limitFaults`, for example a commit that is not a full SHA
 */
export function freezeLimits(all: readonly JobRead[], stamp: FreezeStamp): FrozenLimits {
  for (const read of all) {
    if (read.run === undefined || read.run === "") throw new RangeError(`The job ${read.job} has no run. A freeze counts the CI runs of each model, so each job needs its run.`);
  }
  const window = stamp.window ?? FREEZE_WINDOW;
  const reads = recentRuns(all, (read) => ({ model: read.cpu, run: read.run ?? "" }), { perModel: window, minimumRuns: MIN_RUNS, ...(stamp.runs === undefined ? {} : { order: stamp.runs }) });
  if (reads.length < MIN_JOBS) throw new RangeError(`A freeze needs ${String(MIN_JOBS)} jobs or more, not ${String(reads.length)}.`);
  const runs = reads.map((read) => read.run ?? "");
  const code = freezeStamp(reads);
  const order = stamp.runs ?? [...new Set(all.map((read) => read.run ?? ""))];
  const cases: Record<string, RunLimit> = {};
  for (const id of BENCH_CASES) {
    const values = reads.map((read) => {
      const value = read.cases.find((item) => item.case === id);
      if (value === undefined) throw new RangeError(`The job ${read.job} has no value of ${id}.`);
      return value.ms;
    });
    cases[id] = runLimit(values);
  }
  const spreads = reads.map((read) => {
    if (read.aa === undefined) throw new RangeError(`The job ${read.job} has no A/A read.`);
    return read.aa.spread;
  });
  const jobs = reads.map((read, index) => ({ job: read.job, cpu: read.cpu, run: runs[index] ?? "", commit: read.commit ?? stamp.commit }));
  const file: FrozenLimits = {
    schema: LIMITS_SCHEMA,
    measure: MEASURE,
    rule: RULE,
    seed: BENCH_SEED,
    commit: stamp.commit,
    date: stamp.date,
    runs: order.filter((run) => runs.includes(run)),
    window,
    jobs,
    cases,
    noiseRule: NOISE_RULE,
    // Each job stays: a freeze keeps the worst job, and a noisy job widens a cap only in this file, which a review reads.
    noiseCaps: noiseCapTable(jobs, spreads),
    groups: groupTables(jobs, cases),
    ...(code === undefined ? {} : { stamp: code }),
  };
  // A freeze never gives a file that the gate refuses: the read of the file would fail only later, in CI.
  const faults = limitFaults(file);
  if (faults.length > 0) throw new RangeError(`The freeze gives a file with faults:\n${faults.join("\n")}`);
  return file;
}

/** This function gives the one stamp of the jobs of a freeze, or undefined when no job has a stamp. */
function freezeStamp(reads: readonly JobRead[]): StampRecord | undefined {
  const missing = reads.filter((read) => read.stamp === undefined).map((read) => read.job);
  if (missing.length === reads.length) return undefined;
  if (missing.length > 0) throw new RangeError(`The jobs ${missing.join(", ")} have no stamp of their timed code, and the other jobs have one. A freeze needs a stamp in each job or in none.`);
  const first = reads[0]?.stamp as StampRecord;
  for (const read of reads) {
    const parts = stampChanges(first, read.stamp);
    if (parts.length > 0) throw new RangeError(`The job ${read.job} of the run ${read.run ?? ""} times other code than the job ${reads[0]?.job ?? ""}: the parts ${parts.join(", ")} differ. A freeze needs the same timed code in each job.`);
  }
  return first;
}

/** This function gives the faults of the window of a file. Each CPU model has at most `window` runs. The field `runs` names the runs of the jobs. */
function windowFaults(file: FrozenLimits): string[] {
  if (!Number.isInteger(file.window) || file.window < MIN_RUNS) return [`The window ${String(file.window)} is not a whole number of ${String(MIN_RUNS)} or more.`];
  const faults: string[] = [];
  for (const cpu of new Set(file.jobs.map((job) => job.cpu))) {
    const count = new Set(file.jobs.filter((job) => job.cpu === cpu).map((job) => job.run)).size;
    if (count > file.window) faults.push(`The CPU model ${cpu} has ${String(count)} runs, more than the window ${String(file.window)}.`);
  }
  const runs = new Set(file.jobs.map((job) => job.run));
  if (!Array.isArray(file.runs) || file.runs.length !== runs.size || file.runs.some((run) => !runs.has(run))) faults.push("The runs of the file are not the runs of its jobs.");
  return faults;
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
  for (const id of BENCH_CASES) check(id, file.cases[id]);
  if (file.stamp !== undefined && stampChanges(file.stamp, file.stamp).length > 0) faults.push("The stamp of the file is not a stamp record.");
  faults.push(...windowFaults(file));
  faults.push(...noiseCapFaults(file));
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

/** This function gives the faults of the noise caps of a file. It computes each cap again from the jobs and the A/A spreads of the pooled cap. */
function noiseCapFaults(file: FrozenLimits): string[] {
  if (file.noiseRule !== NOISE_RULE) return ["The rule of the noise caps is not NOISE_RULE."];
  const stored: Readonly<Record<string, NoiseCap>> = typeof file.noiseCaps === "object" && file.noiseCaps !== null ? file.noiseCaps : {};
  const spreads = stored["other"]?.values;
  if (spreads === undefined || spreads.length !== file.jobs.length || spreads.length < MIN_JOBS) return [`The pooled noise cap does not have an A/A spread for each of the ${String(file.jobs.length)} jobs.`];
  const again: Readonly<Record<string, NoiseCap>> = noiseCapTable(file.jobs, spreads);
  return [...new Set([...Object.keys(again), ...Object.keys(stored)])].flatMap((cpu) =>
    JSON.stringify(stored[cpu]) === JSON.stringify(again[cpu]) ? [] : [`The noise cap of ${cpu} is not the noise cap of the A/A spreads of its jobs.`],
  );
}

/**
 * This function gives the faults of a file of frozen limits against the records of its jobs.
 * - `limitFaults` computes each limit and each cap again from the values of the file. So it finds a file that does not agree with itself, but not a value that is not the value of its job.
 * - This function finds each job of the file in the reads by its job and its run. The CPU model, the value of each case and the A/A spread of the read must be the values of the file.
 * - A read that is not a job of the file is not a fault. The folder of the records can hold other runs.
 * - The values are equal with no tolerance, because the freeze copies them from the reads.
 * - When the file has a stamp, the record of each job has the same stamp.
 */
export function recordFaults(file: FrozenLimits, reads: readonly JobRead[]): string[] {
  const faults: string[] = [];
  const spreads = file.noiseCaps?.other?.values ?? [];
  for (const [index, job] of file.jobs.entries()) {
    const found = reads.filter((read) => read.job === job.job && read.run === job.run);
    const name = `The job ${job.job} of the run ${job.run}`;
    if (found.length !== 1) {
      faults.push(`${name} has ${String(found.length)} records, not 1.`);
      continue;
    }
    const read = found[0] as JobRead;
    if (read.cpu !== job.cpu) faults.push(`${name} has the CPU model ${read.cpu} in its record, not ${job.cpu}.`);
    for (const id of BENCH_CASES) {
      const value = read.cases.find((item) => item.case === id)?.ms;
      if (value !== file.cases[id]?.values[index]) faults.push(`${name} has the value ${String(value)} of ${id} in its record, not ${String(file.cases[id]?.values[index])}.`);
    }
    if (read.aa?.spread !== spreads[index]) faults.push(`${name} has the A/A spread ${String(read.aa?.spread)} in its record, not ${String(spreads[index])}.`);
    if (file.stamp !== undefined) {
      const parts = stampChanges(file.stamp, read.stamp);
      if (parts.length > 0) faults.push(`${name} has other timed code in its record than the file: ${parts.join(", ")}.`);
    }
  }
  return faults;
}

/**
 * This function tells if the jobs of a run time the code of the freeze. It does not change the gate.
 * - The same stamp: the job times the frozen code. Thus a block is noise or a change of the runner.
 * - Another stamp: the line names the parts of the stamp that differ.
 * - A file or a job with no stamp gives no answer.
 */
export function stampNote(limits: FrozenLimits | undefined, reads: readonly JobRead[]): string {
  if (limits?.stamp === undefined) return "The file of limits has no stamp of its timed code, so the read cannot compare the timed code.";
  const frozen = limits.stamp;
  const missing = reads.filter((read) => read.stamp === undefined).length;
  const changed = reads.filter((read) => read.stamp !== undefined && stampChanges(frozen, read.stamp).length > 0);
  const parts = [...new Set(changed.flatMap((read) => stampChanges(frozen, read.stamp)))];
  const same = reads.length - missing - changed.length;
  const lines = [`The timed code of ${String(same)} of the ${String(reads.length)} jobs is the timed code of the freeze.`];
  if (changed.length > 0) lines.push(`The timed code of ${String(changed.length)} jobs differs from the freeze in the parts ${parts.join(", ")}.`);
  if (missing > 0) lines.push(`${String(missing)} jobs have no stamp.`);
  return lines.join(" ");
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
    // The pooled limit stays as the file has it: its values are in the order of the jobs.
    tables[id] = { ...modelTable(runValues(file.jobs, pooled.values), (runs) => runLimit(runs.flat()), { minimumRuns: MIN_RUNS }), other: pooled };
  }
  return tables;
}

/** This function gives the value of each job with its CPU model and its run, for `modelTable` and `modelRuns` of rigor-bench. */
function runValues(jobs: FrozenLimits["jobs"], values: readonly number[]): RunValue[] {
  return jobs.flatMap((job, index) => {
    const value = values[index];
    return value === undefined ? [] : [{ model: job.cpu, run: job.run, value }];
  });
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
    const values = runValues(jobs, pooled.values);
    // modelRuns gives the runs of a model in the order of their first value. So the runs of the jobs of the model, in that order, name each group.
    const models = [...modelRuns(values, { minimumRuns: MIN_RUNS })].map(([cpu, runs]) => {
      const names = [...new Set(values.filter((value) => value.model === cpu).map((value) => value.run))];
      return [cpu, { ...runLimit(runs.map((run) => Math.min(...run))), runs: names }] as const;
    });
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
  /** The worst value of the freeze in the limit of one job. The margin of the limit is above it. */
  readonly worst?: number;
  /** The key of the limit in the table of the case: the CPU model, or `other` for the ceiling. */
  readonly model?: string;
  /** The group limit of the model, for a group of 2 jobs or more. A job at the ceiling has none. */
  readonly groupLimit?: number;
  /** The worst value of the freeze in the group limit. */
  readonly groupWorst?: number;
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
 * - Each case is `cannot decide` when the job has no A/A read. It is also `cannot decide` when the A/A spread or bias is above the noise cap of the model.
 *   A model with its own limit has its own noise cap. Each other model has the pooled noise cap (`noiseCapTable`).
 * - Each case is `cannot decide` when the CPU model of the job has no frozen value, or when there is no file of limits.
 * - A case that the job or the file does not have is `cannot decide`. `gateOf` makes each `cannot decide` a no read.
 */
export function jobGate(read: JobRead, limits: FrozenLimits | undefined): JobGate {
  const why = jobNoRead(read, limits);
  const tables = limits === undefined ? {} : modelTables(limits);
  const cases = BENCH_CASES.map((id): CaseOutcome => {
    const ms = read.cases.find((item) => item.case === id)?.ms;
    const table = tables[id];
    const own = table !== undefined && read.cpu !== "other" && Object.hasOwn(table, read.cpu) ? table[read.cpu] : undefined;
    const model = own === undefined ? "other" : read.cpu;
    const on = table === undefined ? undefined : limitOnModel({ gain: (own ?? table.other).limit, ceiling: table.other.limit, models: own === undefined ? [] : [model] }, model);
    const limit = on?.limit;
    const group = own === undefined ? undefined : limits?.groups[id]?.[read.cpu];
    const worst = own?.worst ?? table?.other.worst;
    const place =
      table === undefined
        ? {}
        : {
            model,
            ...(worst === undefined ? {} : { worst }),
            ...(group === undefined ? {} : { groupLimit: group.limit, groupWorst: group.worst }),
            ...(on?.note === undefined ? {} : { note: on.note }),
          };
    if (why !== undefined) return { case: id, outcome: "cannot decide", ms, limit, reason: why };
    if (ms === undefined) return { case: id, outcome: "cannot decide", ms, limit, reason: "The job has no value of the case." };
    if (limit === undefined) return { case: id, outcome: "cannot decide", ms, limit, reason: "The file has no limit of the case." };
    return { case: id, outcome: ms <= limit ? "within" : "beyond", ms, limit, ...place };
  });
  // A job out of CI has no run. Its gate uses the id of the job as its run.
  return { job: read.job, cpu: read.cpu, run: read.run ?? read.job, cases, gate: gateOf(cases) };
}

function jobNoRead(read: JobRead, limits: FrozenLimits | undefined): string | undefined {
  if (limits === undefined) return "There is no file of frozen limits.";
  if (!limits.jobs.some((job) => job.cpu === read.cpu)) return `The CPU model ${read.cpu} has no frozen value.`;
  if (read.aa === undefined) return "The job has no A/A read.";
  const own = read.cpu !== "other" && Object.hasOwn(limits.noiseCaps, read.cpu) ? limits.noiseCaps[read.cpu] : undefined;
  const cap = (own ?? limits.noiseCaps.other).limit;
  const name = own === undefined ? "the pooled noise cap" : `the noise cap of ${read.cpu}`;
  if (read.aa.spread > cap) return `The A/A spread ${read.aa.spread.toFixed(4)} is above ${name} ${String(cap)}.`;
  if (Math.abs(read.aa.median) > cap) return `The A/A bias ${read.aa.median.toFixed(4)} is above ${name} ${String(cap)}.`;
  return undefined;
}

/** The jobs that must read a case before the run decides it. */
export const MIN_READ_JOBS = 3;


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
  /** The worst value of the freeze in the limit that decides. A lowest value above it is in the margin of the limit. */
  readonly worst: number;
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
  const groups = new Map<
    string,
    { run: string; cpu: string; model: string; limit: number; worst: number; groupLimit: number | undefined; groupWorst: number | undefined; jobs: GroupJob[] }
  >();
  for (const gate of gates) {
    const item = gate.cases.find((value) => value.case === id);
    if (item === undefined || item.outcome === "cannot decide" || item.ms === undefined || item.limit === undefined) continue;
    const model = item.model ?? "other";
    const own = item.note === undefined && model === gate.cpu;
    const key = JSON.stringify(own ? [gate.run, gate.cpu] : [gate.run, gate.cpu, gate.job]);
    const group = groups.get(key) ?? {
      run: gate.run,
      cpu: gate.cpu,
      model,
      limit: item.limit,
      worst: item.worst ?? item.limit,
      groupLimit: own ? item.groupLimit : undefined,
      groupWorst: own ? item.groupWorst : undefined,
      jobs: [],
    };
    group.jobs.push({ job: gate.job, ms: item.ms, outcome: item.outcome });
    groups.set(key, group);
  }
  return [...groups.values()].map(({ groupLimit, groupWorst, ...group }): GroupCase => {
    const ms = Math.min(...group.jobs.map((job) => job.ms));
    const kind = groupLimit !== undefined && group.jobs.length >= 2 ? "group" : "job";
    const limit = kind === "group" ? (groupLimit ?? group.limit) : group.limit;
    const worst = kind === "group" ? (groupWorst ?? limit) : group.worst;
    return { case: id, ...group, limit, worst, kind, ms, outcome: ms <= limit ? "within" : "beyond" };
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
  return BENCH_CASES.map((id): RunCase => {
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

/**
 * The title of the table of the groups to read.
 * A limit is the worst value of the freeze plus the spread of its values. Thus the margin of the limit is the spread above the worst value.
 * A group with its lowest value in the margin is slower than each value of the freeze. A group with a lower value is in the range of the freeze, so the table does not show it.
 */
export const NEAR_TITLE =
  "The groups with a lowest value above the worst value of the freeze, in the margin of the limit, or with a job beyond the limit of one job. The lowest value of the group decides";

/** This function tells if the lowest value of a group is in the margin of its limit: above the worst value of the freeze. */
export function inMargin(group: GroupCase): boolean {
  return group.ms > group.worst;
}

/** This function gives the Markdown report of a read: the value of each case in each job, the gate, and the candidate limits. */
export function readReport(reads: readonly JobRead[], gates: readonly JobGate[], candidate: FrozenLimits | undefined): string {
  const ids = BENCH_CASES;
  const lines = [
    "## The cost of independentStop and bestEndurance",
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
  const near = run.flatMap((item) => item.groups.filter((group) => inMargin(group) || group.jobs.some((job) => job.outcome === "beyond")));
  if (near.length > 0) {
    lines.push("", `${NEAR_TITLE}:`, "", "| Case | Run | CPU | Worst of the freeze (ms) | Limit (ms) | Jobs: value (ms), share of the limit, outcome of the job alone | Lowest (ms) | Outcome |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const group of near) {
      const jobs = group.jobs.map((job) => `${job.job}: ${ms(job.ms)}, ${((100 * job.ms) / group.limit).toFixed(1)}%, ${job.outcome}`).join("<br>");
      const cpu = group.model === "other" ? `${group.cpu} (ceiling)` : group.cpu;
      lines.push(`| ${group.case} | ${group.run} | ${cpu} | ${ms(group.worst)} | ${ms(group.limit)} (${group.kind === "group" ? "group" : "one job"}) | ${jobs} | ${ms(group.ms)} | ${group.outcome} |`);
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
    lines.push("", `The candidate noise caps, on a log scale (${NOISE_RULE}):`, "", "| CPU | Jobs | Median | Worst | Noise cap |", "| --- | --- | --- | --- | --- |");
    for (const [model, cap] of Object.entries(candidate.noiseCaps)) {
      const name = model === "other" ? "The pooled cap (all jobs)" : model;
      lines.push(`| ${name} | ${String(cap.values.length)} | ${(cap.worst - cap.spread).toFixed(4)} | ${cap.worst.toFixed(4)} | ${String(cap.limit)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}
