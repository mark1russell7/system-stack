import { SAMPLE_STACK } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkTofu } from "./check.ts";
import { checkPlan } from "./plan.ts";
import { SAMPLE_BUDGETS, SAMPLE_PLAN, SAMPLE_TOFU } from "./sample.ts";
import { parsePlan, parseTofu, planSchema, tofuSchema } from "./schema.ts";

const sample = (): Record<string, unknown> => JSON.parse(JSON.stringify(SAMPLE_TOFU)) as Record<string, unknown>;
const resource = (more: Record<string, unknown>): Record<string, unknown> => ({ ...sample(), resources: [{ part: "cloud-host", type: "example_server", ...more }] });
const samplePlan = (): Record<string, unknown> => JSON.parse(JSON.stringify(SAMPLE_PLAN)) as Record<string, unknown>;
const entry = (more: Record<string, unknown>): Record<string, unknown> => ({ format_version: "1.2", resource_changes: [{ address: "example_server.web", change: { actions: ["create"] }, ...more }] });

describe("parseTofu", () => {
  it("reads the JSON of the sample", () => {
    expect(parseTofu(sample())).toEqual({ ok: true, layer: SAMPLE_TOFU });
  });

  it("gives a layer that the gate accepts", () => {
    const read = parseTofu(sample());
    expect(read.ok && checkTofu(read.layer, SAMPLE_STACK, { budgets: SAMPLE_BUDGETS })).toEqual([]);
  });

  it("reads the smallest layer", () => {
    expect(parseTofu({ schema: "tofu/1", resources: [] })).toEqual({ ok: true, layer: { schema: "tofu/1", resources: [] } });
  });

  it("names the record and the place of a fault", () => {
    const read = parseTofu({ ...sample(), schema: "tofu/2" });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors[0]).toContain('The record "tofu/1" has a fault at "schema"');
    const deep = parseTofu(resource({ type: 5 }));
    if (!deep.ok) expect(deep.errors.join(" ")).toContain('"resources.0.type"');
    expect(deep.ok).toBe(false);
  });

  it("refuses a record that is not an object, and a layer with no resources", () => {
    for (const value of [null, undefined, "tofu/1", 5, []]) expect(parseTofu(value).ok).toBe(false);
    expect(parseTofu({ schema: "tofu/1" }).ok).toBe(false);
  });

  it("refuses a field that the format does not have", () => {
    expect(parseTofu({ ...sample(), modules: [] }).ok).toBe(false);
    expect(parseTofu(resource({ count: 2 })).ok).toBe(false);
    expect(parseTofu({ ...sample(), providers: [{ name: "example", source: "example-org/example", part: "cloud-account", region: "west" }] }).ok).toBe(false);
    expect(parseTofu({ ...sample(), variables: [{ name: "token", default: "secret" }] }).ok).toBe(false);
    expect(parseTofu({ ...sample(), backend: { type: "local", path: "x" } }).ok).toBe(false);
  });

  it("refuses an empty text where a record needs a name", () => {
    expect(parseTofu(resource({ part: "" })).ok).toBe(false);
    expect(parseTofu(resource({ type: "" })).ok).toBe(false);
    expect(parseTofu(resource({ name: "" })).ok).toBe(false);
    expect(parseTofu(resource({ ignore: [""] })).ok).toBe(false);
    expect(parseTofu({ ...sample(), version: "" }).ok).toBe(false);
  });

  it("refuses a field with a wrong type", () => {
    expect(parseTofu(resource({ cost: "5" })).ok).toBe(false);
    expect(parseTofu(resource({ keep: "yes" })).ok).toBe(false);
    expect(parseTofu(resource({ ignore: "labels" })).ok).toBe(false);
    expect(parseTofu(resource({ import: 7 })).ok).toBe(false);
    expect(parseTofu(resource({ values: [] })).ok).toBe(false);
    expect(parseTofu({ ...sample(), variables: [{ name: "token", type: "list" }] }).ok).toBe(false);
  });

  it("refuses a number that is not finite", () => {
    expect(parseTofu(resource({ cost: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(parseTofu(resource({ cost: Number.NaN })).ok).toBe(false);
    expect(parseTofu(resource({ values: { size: Number.NaN } })).ok).toBe(false);
  });

  it("refuses a value that JSON does not have, at each depth", () => {
    const read = parseTofu(resource({ values: { a: [{ b: () => 1 }] } }));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors).toEqual(['The record "tofu/1" has a fault at "resources.0.values.a.0.b": The value is not a value of JSON: a text, a finite number, a boolean, null, a list or an object.']);
    expect(parseTofu(resource({ values: { a: new Date(0) } })).ok).toBe(false);
    expect(parseTofu(resource({ values: { a: [undefined] } })).ok).toBe(false);
    expect(parseTofu(resource({ values: new Map() })).ok).toBe(false);
  });

  it("gives each place of a wrong value", () => {
    const read = parseTofu({ ...sample(), providers: [{ name: "example", source: "example-org/example", part: "cloud-account", values: { a: Number.NaN, b: { c: [1, Number.POSITIVE_INFINITY] } } }] });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors.map((error) => /"(providers[^"]*)"/.exec(error)?.[1])).toEqual(["providers.0.values.a", "providers.0.values.b.c.1"]);
  });

  it("reads each value of JSON, at each depth", () => {
    const values = { text: "a", number: -1.5, flag: false, none: null, list: [1, "a", [true, null], { deep: { deeper: [{}] } }], form: { $ref: "example_disk.cloud-host.id" } };
    const read = parseTofu(resource({ values }));
    expect(read.ok && read.layer.resources[0]?.values).toEqual(values);
  });

  it("leaves the meaning of a layer to the gate", () => {
    expect(parseTofu(resource({ cost: -1, type: "Not A Type", values: { $ref: "x" } })).ok).toBe(true);
  });

  it("exports the schema of zod", () => {
    expect(tofuSchema.safeParse(sample()).success).toBe(true);
  });
});

describe("parsePlan", () => {
  it("reads the JSON of the sample", () => {
    expect(parsePlan(samplePlan())).toEqual({ ok: true, plan: SAMPLE_PLAN });
  });

  it("gives a plan that the gate accepts", () => {
    const read = parsePlan(samplePlan());
    expect(read.ok && checkPlan(SAMPLE_TOFU, read.plan)).toEqual([]);
  });

  it("reads the smallest plan", () => {
    expect(parsePlan({ format_version: "1.0" })).toEqual({ ok: true, plan: { format_version: "1.0" } });
  });

  it("keeps each field that it does not know", () => {
    const more = {
      format_version: "1.2",
      terraform_version: "1.9.0",
      timestamp: "2026-11-16T00:00:00Z",
      errored: false,
      resource_changes: [
        {
          address: "example_server.web",
          mode: "managed",
          type: "example_server",
          name: "web",
          provider_name: "registry.example.com/example-org/example",
          change: { actions: ["no-op"], before: { id: "1" }, after: { id: "1" }, importing: { id: "1", unknown: true } },
        },
      ],
      configuration: { root_module: {} },
    };
    expect(parsePlan(more)).toEqual({ ok: true, plan: more });
  });

  it("reads a change with no import as null", () => {
    expect(parsePlan(entry({ change: { actions: ["create"], importing: null } })).ok).toBe(true);
  });

  it("names the plan and the place of a fault", () => {
    const read = parsePlan(entry({ address: 5 }));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors[0]).toContain('The record "plan" has a fault at "resource_changes.0.address"');
  });

  it("refuses a plan with no version, and a value that is not an object", () => {
    expect(parsePlan({ resource_changes: [] }).ok).toBe(false);
    expect(parsePlan({ format_version: "" }).ok).toBe(false);
    for (const value of [null, undefined, "1.2", []]) expect(parsePlan(value).ok).toBe(false);
  });

  it("refuses a change with no address, no change or no list of actions", () => {
    expect(parsePlan(entry({ address: "" })).ok).toBe(false);
    expect(parsePlan({ format_version: "1.2", resource_changes: [{ address: "example_server.web" }] }).ok).toBe(false);
    expect(parsePlan(entry({ change: {} })).ok).toBe(false);
    expect(parsePlan(entry({ change: { actions: "create" } })).ok).toBe(false);
    expect(parsePlan(entry({ change: { actions: [1] } })).ok).toBe(false);
    expect(parsePlan(entry({ change: { actions: ["create"], importing: "id" } })).ok).toBe(false);
    expect(parsePlan({ format_version: "1.2", errored: "no" }).ok).toBe(false);
  });

  it("exports the schema of zod", () => {
    expect(planSchema.safeParse(samplePlan()).success).toBe(true);
  });
});
