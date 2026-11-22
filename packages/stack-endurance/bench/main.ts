/**
 * The bench of `independentStop`. It is for CI: a timed run on a shared computer does not give a valid value.
 *
 * - `node bench/main.ts run --out <folder> --job <label> [--round-offset <n>] [--commit <sha>] [--run <id>]` times each case in fresh children and writes `records.json`.
 * - `node bench/main.ts read --in <folder> [--expect <jobs>] [--limits <file>] [--enforce] [--freeze <file>]` reads the records of each job.
 *
 * `read` writes the report to the step summary and the gate line as an annotation. With `--enforce`, a gate that is not `pass` exits with 1.
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gateLine, gateOf, writeGateLine, writeGateVerdict } from "@mark1russell7/rigor-bench";
import { freshArms } from "@mark1russell7/rigor-bench/fresh";
import { BENCH_CUTS, BENCH_SEED, caseId } from "./inputs.ts";
import { AA_ARM, AA_CASE, freezeLimits, jobGate, jobRead, limitFaults, readReport, RECORD_SCHEMA, runGate, type FrozenLimits, type JobGate, type JobRecord } from "./read.ts";

/** The rounds of one job: 4 times the count of arms, so the order of `armOrder` is balanced. */
export const JOB_ROUNDS = 16;
/** The longest time of one child, in milliseconds. */
const CHILD_MS = 120_000;

const here = dirname(fileURLToPath(import.meta.url));

async function run(args: Record<string, string | boolean | undefined>): Promise<void> {
  const out = String(args["out"] ?? "");
  const job = String(args["job"] ?? "");
  if (out === "" || job === "") throw new Error("run needs --out and --job.");
  const rounds = Number(args["rounds"] ?? JOB_ROUNDS);
  const arms = [...BENCH_CUTS.map((cuts) => ({ id: caseId(cuts), case: caseId(cuts) })), { id: AA_ARM, case: AA_CASE }];
  const result = await freshArms({
    arms,
    command: [process.execPath, join(here, "child.ts")],
    aa: [AA_CASE, AA_ARM],
    rounds,
    roundOffset: Number(args["round-offset"] ?? 0),
    timeoutMs: CHILD_MS,
    job,
    warmUp: 1,
    onProcess: (record) => process.stderr.write(`round ${String(record.round)} ${record.arm}: ${record.ms.toFixed(3)} ms\n`),
  });
  const record: JobRecord = {
    schema: RECORD_SCHEMA,
    job,
    ...(typeof args["commit"] === "string" ? { commit: args["commit"] } : {}),
    ...(typeof args["run"] === "string" ? { run: args["run"] } : {}),
    seed: BENCH_SEED,
    env: result.env,
    rounds: result.rounds,
    warnings: result.warnings,
    processes: result.processes,
    aa: result.aa,
  };
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "records.json"), `${JSON.stringify(record, null, 2)}\n`);
  for (const warning of result.warnings) process.stderr.write(`warning: ${warning}\n`);
}

/** This function gives each file `records.json` under a folder, in the order of their paths. */
function recordFiles(folder: string): string[] {
  return readdirSync(folder)
    .sort()
    .flatMap((name) => {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) return recordFiles(path);
      return name === "records.json" ? [path] : [];
    });
}

/** This function gives the gate of a job with no record: each case is a no read. */
function missingJob(job: string): JobGate {
  const cases = BENCH_CUTS.map((cuts) => ({ case: caseId(cuts), outcome: "cannot decide" as const, ms: undefined, limit: undefined, reason: "The job gave no record." }));
  return { job, cpu: "unknown", cases, gate: gateOf(cases) };
}

function read(args: Record<string, string | boolean | undefined>): number {
  const folder = String(args["in"] ?? "");
  if (folder === "") throw new Error("read needs --in.");
  const records = recordFiles(folder).map((file) => JSON.parse(readFileSync(file, "utf8")) as JobRecord);
  for (const record of records) if (record.schema !== RECORD_SCHEMA || record.seed !== BENCH_SEED) throw new Error(`The record of the job ${record.job} is not a record of this bench.`);
  const reads = records.map(jobRead);
  const limitsFile = typeof args["limits"] === "string" ? args["limits"] : undefined;
  const limits = limitsFile === undefined ? undefined : (JSON.parse(readFileSync(limitsFile, "utf8")) as FrozenLimits);
  const faults = limits === undefined ? [] : limitFaults(limits);
  if (faults.length > 0) throw new Error(`The file of limits has faults:\n${faults.join("\n")}`);
  const gates = reads.map((item) => jobGate(item, limits));
  // A job that failed gives no record. Each of its cases is a no read, so a lost job does not pass.
  const expected = Number(args["expect"] ?? 0);
  for (let index = reads.length; index < expected; index += 1) gates.push(missingJob(`missing-${String(index + 1)}`));
  const commits = [...new Set(records.map((record) => record.commit ?? ""))];
  const runs = typeof args["runs"] === "string" ? args["runs"].split(",").filter((id) => id !== "") : [...new Set(records.flatMap((record) => (record.run === undefined ? [] : [record.run])))];
  const candidate =
    reads.length >= 5 && commits.length === 1 && commits[0] !== ""
      ? freezeLimits(reads, { commit: commits[0] ?? "", date: typeof args["date"] === "string" ? args["date"] : new Date().toISOString().slice(0, 10), runs })
      : undefined;
  const report = readReport(reads, gates, candidate);
  process.stdout.write(report);
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary !== undefined && summary !== "") writeFileSync(summary, report, { flag: "a" });
  if (typeof args["freeze"] === "string") {
    if (candidate === undefined) process.stdout.write("There is no candidate file: a freeze needs 5 jobs or more of one commit.\n");
    else writeFileSync(args["freeze"], `${JSON.stringify(candidate, null, 2)}\n`);
  }
  const gate = runGate(gates);
  const enforced = args["enforce"] === true;
  const models = [...new Set(reads.map((item) => item.cpu))].map((model) => ({ model, jobs: reads.filter((item) => item.cpu === model).length }));
  writeGateLine(gateLine(gates.flatMap((job) => job.cases.map((item) => ({ case: `${job.job}/${item.case}`, outcome: item.outcome }))), { title: "independentStop cost", enforced, reason: gate.reason, models }));
  if (enforced) writeGateVerdict(gate.outcome);
  process.stdout.write(`gate: ${gate.outcome}. ${gate.reason}\n`);
  return enforced && gate.outcome !== "pass" ? 1 : 0;
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    job: { type: "string" },
    rounds: { type: "string" },
    "round-offset": { type: "string" },
    commit: { type: "string" },
    run: { type: "string" },
    in: { type: "string" },
    limits: { type: "string" },
    enforce: { type: "boolean" },
    freeze: { type: "string" },
    date: { type: "string" },
    runs: { type: "string" },
    expect: { type: "string" },
  },
});
const command = positionals[0];
if (command === "run") await run(values);
else if (command === "read") process.exitCode = read(values);
else throw new Error(`The command is run or read, not ${String(command)}.`);
