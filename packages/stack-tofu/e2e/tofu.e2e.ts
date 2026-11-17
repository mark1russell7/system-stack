// The check of the package with a real OpenTofu.
// A unit test cannot tell if OpenTofu accepts the files of the generator, or how a plan of OpenTofu shows a change.
// This file starts the program `tofu`, so it is not in the unit tests: the job `tofu` of the CI workflow starts it.
// Each resource is a `terraform_data` of OpenTofu. It needs no provider, no account and no network.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { checkPlan, DOCUMENT_FILE, documentText, generateTofu, TOFU_SCHEMA, type PlanFault, type Resource, type TofuLayer, type TofuPlan } from "../src/index.ts";
import { parsePlan } from "../src/schema.ts";

const BASE = "terraform_data.base";
const APP = "terraform_data.app";
const WATCH = "terraform_data.watch";
const OLD = "terraform_data.old";

/** The values of the two variables. They are examples: no value is a secret. */
const RELEASE = "1.4.0";
const TOKEN = "an-example-of-a-token";

/** A text with each template sequence of OpenTofu. The files must give it back as it is. */
const LITERAL = "a ${literal} text, 100 %{ of } it, and $${two} more";

const INPUT = { text: LITERAL, size: 10, on: true, ports: [22, 443] };

const STACK: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "base", kind: "host" },
    { id: "app", kind: "program", needs: ["base"] },
    { id: "watch", kind: "program", needs: ["app"] },
    { id: "old", kind: "host" },
  ],
};

const BASE_RESOURCE: Resource = { part: "base", type: "terraform_data", values: { input: INPUT }, keep: true };
const APP_RESOURCE: Resource = {
  part: "app",
  type: "terraform_data",
  values: { input: { base: { $ref: `${BASE}.id` }, release: { $var: "release" }, token: { $var: "token" } } },
  ignore: ["triggers_replace"],
};
// This resource reads no other resource, so only `depends_on` holds its place after the resource of `app`.
const WATCH_RESOURCE: Resource = { part: "watch", type: "terraform_data", values: { input: "watch" } };
const OLD_RESOURCE: Resource = { part: "old", type: "terraform_data", import: "old-1" };

const LAYER: TofuLayer = {
  schema: TOFU_SCHEMA,
  version: ">= 1.8",
  variables: [
    { name: "release", description: "The release of the program" },
    { name: "token", sensitive: true },
  ],
  resources: [BASE_RESOURCE, APP_RESOURCE, WATCH_RESOURCE],
};

let folder = "";

interface Ran {
  readonly status: number;
  readonly out: string;
  readonly err: string;
}

/** This function starts the program `tofu` in the folder of the check, with argv and no shell. */
function tofu(...args: string[]): Ran {
  const ran = spawnSync("tofu", args, {
    cwd: folder,
    encoding: "utf8",
    env: { ...process.env, TF_IN_AUTOMATION: "1", TF_INPUT: "0", TF_VAR_release: RELEASE, TF_VAR_token: TOKEN },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (ran.error !== undefined) assert.fail(`The program tofu did not start: ${ran.error.message}. This check needs a real OpenTofu on the path.`);
  return { status: ran.status ?? -1, out: ran.stdout, err: ran.stderr };
}

/** This function starts `tofu` and gives its output. It fails the test when the program fails. */
function pass(...args: string[]): string {
  const ran = tofu(...args);
  assert.equal(ran.status, 0, `tofu ${args.join(" ")} failed.\n${ran.out}\n${ran.err}`);
  return ran.out;
}

/** This function reads a field of a JSON value. A value that is not an object has no field. */
function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>)[name] : undefined;
}

/** This function gives the values of one resource from the field `values` or `planned_values` of the JSON of OpenTofu. */
function valuesOf(root: unknown, address: string): unknown {
  const resources = field(field(root, "root_module"), "resources");
  if (!Array.isArray(resources)) assert.fail(`The JSON of OpenTofu has no list of resources: ${JSON.stringify(root)}`);
  const found: unknown = resources.find((resource: unknown) => field(resource, "address") === address);
  assert.notEqual(found, undefined, `The JSON of OpenTofu does not have the resource "${address}".`);
  return field(found, "values");
}

/** This function writes the file of a layer. A fault of the gate fails the test. */
function write(layer: TofuLayer): void {
  const made = generateTofu(layer, STACK);
  const faults = made.faults.map((fault) => `${fault.code}: ${fault.message}`);
  if (!made.ok) assert.fail(`The generator gave no document:\n${faults.join("\n")}`);
  assert.deepEqual(faults, [], "The layer of the check has no warning.");
  writeFileSync(join(folder, DOCUMENT_FILE), documentText(made.document));
}

interface Planned {
  /** The plan as the schema of the package reads it. */
  readonly plan: TofuPlan;
  /** The JSON of OpenTofu, with each field. */
  readonly raw: unknown;
}

/** This function writes the file of a layer, makes a plan of OpenTofu and reads its JSON. */
function planOf(layer: TofuLayer): Planned {
  write(layer);
  pass("plan", "-no-color", "-out=plan.bin");
  const raw: unknown = JSON.parse(pass("show", "-json", "plan.bin"));
  const parsed = parsePlan(raw);
  if (!parsed.ok) assert.fail(`The schema refuses the plan of OpenTofu:\n${parsed.errors.join("\n")}`);
  return { plan: parsed.plan, raw };
}

/** This function gives the actions of each resource of a plan. */
function actions(plan: TofuPlan): Record<string, readonly string[]> {
  return Object.fromEntries((plan.resource_changes ?? []).map((entry) => [entry.address, entry.change.actions]));
}

/** This function gives the code and the place of each fault, in a fixed sequence. */
function codes(faults: readonly PlanFault[]): string[] {
  return faults.map((fault) => `${fault.code} ${fault.at}`).sort();
}

/** This function gives the layer of the check with one more resource. */
function layerWith(resource: Resource): TofuLayer {
  return { ...LAYER, resources: [...LAYER.resources, resource] };
}

before(() => {
  folder = mkdtempSync(join(tmpdir(), "stack-tofu-"));
  const version: unknown = JSON.parse(pass("version", "-json"));
  console.log(`OpenTofu ${String(field(version, "terraform_version"))}`);
});

after(() => {
  if (folder !== "") rmSync(folder, { recursive: true, force: true });
});

void test("OpenTofu accepts the files of the generator, with no warning", () => {
  write(LAYER);
  pass("init", "-no-color", "-input=false");
  const report: unknown = JSON.parse(pass("validate", "-json"));
  assert.equal(field(report, "valid"), true);
  // The comment of each resource, `depends_on`, `lifecycle` and the variables are in these files.
  assert.deepEqual(field(report, "diagnostics"), []);
});

void test("the first plan makes each resource, and the gate passes", () => {
  const { plan, raw } = planOf(LAYER);
  assert.deepEqual(actions(plan), { [APP]: ["create"], [BASE]: ["create"], [WATCH]: ["create"] });
  assert.deepEqual(checkPlan(LAYER, plan), []);
  assert.deepEqual(codes(checkPlan(LAYER, plan, { noChange: true })), [`plan-change ${APP}`, `plan-change ${BASE}`, `plan-change ${WATCH}`]);
  // A text of a record is not an expression: OpenTofu reads each template sequence as text.
  assert.deepEqual(field(valuesOf(field(raw, "planned_values"), BASE), "input"), INPUT);
});

void test("after the apply, the state has the values of the records, and a plan changes nothing", () => {
  planOf(LAYER);
  pass("apply", "-no-color", "-input=false", "plan.bin");
  const state: unknown = JSON.parse(pass("show", "-json"));
  const base = valuesOf(field(state, "values"), BASE);
  const app = valuesOf(field(state, "values"), APP);
  assert.equal(typeof field(base, "id"), "string");
  assert.deepEqual(field(base, "output"), INPUT);
  // The reference and the two variables have their values.
  assert.deepEqual(field(app, "input"), { base: field(base, "id"), release: RELEASE, token: TOKEN });

  const { plan } = planOf(LAYER);
  // The plan has one change with the action `no-op` for each resource. Thus the gate finds each resource of the layer.
  assert.deepEqual(actions(plan), { [APP]: ["no-op"], [BASE]: ["no-op"], [WATCH]: ["no-op"] });
  assert.deepEqual(checkPlan(LAYER, plan, { noChange: true }), []);
});

void test("a change of an attribute that the record ignores is not a change", () => {
  const changed: TofuLayer = { ...LAYER, resources: [BASE_RESOURCE, { ...APP_RESOURCE, values: { ...APP_RESOURCE.values, triggers_replace: "second" } }, WATCH_RESOURCE] };
  const { plan } = planOf(changed);
  assert.deepEqual(checkPlan(changed, plan, { noChange: true }), []);
});

void test("a delete of a resource needs its address in the option removes", () => {
  // The record of `watch` is gone, so the plan deletes its resource.
  const without: TofuLayer = { ...LAYER, resources: [BASE_RESOURCE, APP_RESOURCE] };
  const { plan } = planOf(without);
  assert.deepEqual(actions(plan)[WATCH], ["delete"]);
  assert.deepEqual(codes(checkPlan(without, plan)), [`plan-delete ${WATCH}`]);
  assert.deepEqual(checkPlan(without, plan, { removes: [WATCH] }), []);
});

void test("OpenTofu refuses a plan that replaces a resource with keep", () => {
  // A new value of `triggers_replace` replaces a `terraform_data`. The record of `base` has `keep`.
  write({ ...LAYER, resources: [{ ...BASE_RESOURCE, values: { ...BASE_RESOURCE.values, triggers_replace: "second" } }, APP_RESOURCE, WATCH_RESOURCE] });
  const ran = tofu("plan", "-no-color", "-out=plan.bin");
  assert.notEqual(ran.status, 0, `OpenTofu made a plan that replaces "${BASE}".\n${ran.out}`);
  assert.match(ran.err, /prevent_destroy/);
});

void test("the import of an object that exists gives a plan with no change", () => {
  const layer = layerWith(OLD_RESOURCE);
  const { plan } = planOf(layer);
  const change = (plan.resource_changes ?? []).find((entry) => entry.address === OLD);
  if (change === undefined) assert.fail(`The plan does not have the resource "${OLD}".`);
  assert.equal(change.change.importing?.id, "old-1");
  assert.deepEqual(change.change.actions, ["no-op"]);
  assert.deepEqual(checkPlan(layer, plan, { noChange: true }), []);
  // The record and the plan must name the same object.
  assert.deepEqual(codes(checkPlan(layerWith({ ...OLD_RESOURCE, import: "old-2" }), plan)), [`plan-import ${OLD}`]);
  assert.deepEqual(codes(checkPlan(layerWith({ part: "old", type: "terraform_data" }), plan)), [`plan-import ${OLD}`]);

  pass("apply", "-no-color", "-input=false", "plan.bin");
  const state: unknown = JSON.parse(pass("show", "-json"));
  assert.equal(field(valuesOf(field(state, "values"), OLD), "id"), "old-1");
  // The record keeps its import. The next plan imports nothing and changes nothing.
  const next = planOf(layer);
  assert.deepEqual(actions(next.plan)[OLD], ["no-op"]);
  assert.deepEqual(checkPlan(layer, next.plan, { noChange: true }), []);
});
