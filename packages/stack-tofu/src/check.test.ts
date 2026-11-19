import { SAMPLE_STACK, STACK_SCHEMA, type Need, type Part, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkTofu, PROVIDER_META, RESOURCE_META, TOFU_CODES, type TofuCode, type TofuFault, type TofuOptions } from "./check.ts";
import type { Budget } from "./cost.ts";
import { TOFU_SCHEMA, type Copy, type Group, type Provider, type Resource, type TofuLayer } from "./layer.ts";
import { SAMPLE_BUDGETS, SAMPLE_TOFU } from "./sample.ts";

const part = (id: string, ...needs: Need[]): Part => ({ id, kind: "part", needs });
const stack: Stack = { schema: STACK_SCHEMA, parts: [part("account"), part("host", "account"), part("program", "host"), part("lonely")] };
const example: Provider = { name: "example", source: "example-org/example", part: "account" };
const server: Resource = { part: "host", type: "example_server", cost: 5 };
const budgets: readonly Budget[] = [{ part: "account", hardLimit: 10 }];
const layer = (more: Partial<TofuLayer> = {}): TofuLayer => ({ schema: TOFU_SCHEMA, providers: [example], resources: [server], ...more });
const one = (more: Partial<Resource>): TofuLayer => layer({ resources: [{ ...server, ...more }] });
const faults = (of: TofuLayer, options: TofuOptions = { budgets }): TofuFault[] => checkTofu(of, stack, options);
const codes = (of: TofuLayer, options: TofuOptions = { budgets }): TofuCode[] => faults(of, options).map((fault) => fault.code);

// A group of one disk, and its copy for the part `program`. The copy makes the resource `example_disk.program_disk`.
const disk: Group = { name: "disk", params: [{ name: "size" }], resources: [{ name: "disk", type: "example_disk", cost: 1, values: { size: { $param: "size" } } }] };
const copy: Copy = { part: "program", group: "disk", values: { size: 10 } };
const grouped = (more: Partial<TofuLayer> = {}): TofuLayer => layer({ groups: [disk], copies: [copy], ...more });

const WARNINGS: readonly TofuCode[] = ["provider-need", "variable-unused", "group-unused", "param-unused"];

/** A layer with one planted record for a code. `codes` is each code that the gate gives for it, when the planted record has a second effect. */
interface Planted {
  readonly layer: TofuLayer;
  readonly options?: TofuOptions;
  readonly at: string;
  readonly codes?: readonly TofuCode[];
}

// The type of this record makes each code have a planted record.
const PLANTED: Record<TofuCode, Planted> = {
  version: { layer: layer({ version: "${var.version}" }), at: "terraform" },
  backend: { layer: layer({ backend: { type: "local", values: { path: { $ref: "example_server.host.id" } } } }), at: "terraform" },
  "variable-form": { layer: layer({ variables: [{ name: "1a" }] }), at: "var.1a", codes: ["variable-form", "variable-unused"] },
  "variable-duplicate": { layer: layer({ variables: [{ name: "token" }, { name: "token" }], providers: [{ ...example, values: { token: { $var: "token" } } }] }), at: "var.token" },
  "provider-form": { layer: layer({ providers: [{ ...example, source: "example" }] }), at: "provider.example" },
  "provider-duplicate": { layer: layer({ providers: [example, example] }), at: "provider.example" },
  "provider-source": { layer: layer({ providers: [example, { ...example, alias: "west", source: "example-org/fork" }] }), at: "provider.example.west" },
  "provider-part": { layer: layer({ providers: [{ ...example, part: "missing" }] }), options: { budgets: [{ part: "missing", hardLimit: 10 }] }, at: "provider.example" },
  "provider-value": { layer: layer({ providers: [{ ...example, values: { region: { $ref: "example_server.host.region" } } }] }), at: "provider.example" },
  "resource-form": { layer: one({ name: "1a" }), at: "example_server.1a" },
  "resource-duplicate": { layer: layer({ resources: [server, server] }), at: "example_server.host" },
  "resource-part": { layer: one({ part: "missing" }), at: "example_server.missing" },
  "provider-none": { layer: one({ type: "other_server" }), at: "other_server.host" },
  "ignore-form": { layer: one({ ignore: ["labels", "a b"] }), at: "example_server.host" },
  "value-name": { layer: one({ values: { "a b": 1 } }), at: "example_server.host" },
  "value-meta": { layer: one({ values: { depends_on: ["example_disk.host"] } }), at: "example_server.host" },
  "value-form": { layer: one({ values: { disk: { $ref: "file(\"/etc/passwd\")" } } }), at: "example_server.host" },
  "value-number": { layer: one({ values: { size: Number.POSITIVE_INFINITY } }), at: "example_server.host" },
  "ref-none": { layer: one({ values: { disk: { $ref: "example_disk.host.id" } } }), at: "example_server.host" },
  "var-none": { layer: one({ values: { key: { $var: "token" } } }), at: "example_server.host" },
  cycle: { layer: one({ values: { self: { $ref: "example_server.host.id" } } }), at: "example_server.host" },
  "cost-amount": { layer: one({ cost: -1 }), at: "example_server.host" },
  "cost-none": { layer: layer({ resources: [{ part: "host", type: "example_server" }] }), at: "example_server.host" },
  "cost-builtin": { layer: layer({ resources: [server, { part: "program", type: "terraform_data", cost: 3 }] }), at: "terraform_data.program" },
  "budget-duplicate": { layer: layer(), options: { budgets: [...budgets, ...budgets] }, at: "account" },
  "budget-amount": { layer: layer(), options: { budgets: [{ part: "account", hardLimit: -1 }] }, at: "account" },
  "budget-none": { layer: layer(), options: {}, at: "account" },
  "limit-none": { layer: layer(), options: { budgets: [{ part: "account" }] }, at: "account" },
  "cost-over": { layer: one({ cost: 10.01 }), at: "account" },
  "provider-need": { layer: one({ part: "lonely" }), at: "example_server.lonely" },
  "variable-unused": { layer: layer({ variables: [{ name: "token" }] }), at: "var.token" },
  "group-form": { layer: grouped({ groups: [{ ...disk, name: "1a" }], copies: [{ ...copy, group: "1a" }] }), at: "group.1a" },
  "group-duplicate": { layer: grouped({ groups: [disk, disk] }), at: "group.disk" },
  "group-shadow": { layer: grouped({ resources: [server, { part: "host", type: "example_disk", name: "disk", cost: 1 }] }), at: "group.disk" },
  "group-none": { layer: grouped({ copies: [{ ...copy, group: "missing" }] }), at: "copy.program", codes: ["group-none", "group-unused"] },
  // The copy keeps the parameter form that the group does not have, so its resource also has a value that is not correct.
  "param-none": {
    layer: grouped({ groups: [{ ...disk, resources: [{ name: "disk", type: "example_disk", cost: 1, values: { size: { $param: "size" }, zone: { $param: "zone" } } }] }] }),
    at: "group.disk",
    codes: ["value-form", "param-none"],
  },
  "param-missing": { layer: grouped({ copies: [{ part: "program", group: "disk" }] }), at: "copy.program" },
  "param-unknown": { layer: grouped({ copies: [{ ...copy, values: { size: 10, zone: "east" } }] }), at: "copy.program" },
  "copy-provider": { layer: grouped({ copies: [{ ...copy, providers: ["other.east"] }] }), at: "copy.program" },
  "group-unused": { layer: grouped({ copies: [] }), at: "group.disk" },
  "param-unused": { layer: grouped({ groups: [{ ...disk, params: [{ name: "size" }, { name: "zone", default: "east" }] }] }), at: "group.disk" },
};

describe("the codes", () => {
  it("has each code one time", () => {
    expect(new Set(TOFU_CODES).size).toBe(TOFU_CODES.length);
    expect(Object.keys(PLANTED).sort()).toEqual([...TOFU_CODES].sort());
  });

  it.each(TOFU_CODES)("gives %s for its planted record, and no other code", (code) => {
    const planted = PLANTED[code];
    const found = faults(planted.layer, planted.options);
    expect(found.map((fault) => fault.code)).toEqual(planted.codes ?? [code]);
    expect(found.find((fault) => fault.code === code)).toMatchObject({ code, at: planted.at, level: WARNINGS.includes(code) ? "warning" : "error" });
  });

  it("gives a message with a text for each fault", () => {
    for (const code of TOFU_CODES) {
      for (const fault of faults(PLANTED[code].layer, PLANTED[code].options)) expect(fault.message.length).toBeGreaterThan(20);
    }
  });
});

describe("a layer that passes", () => {
  it("gives no fault for the smallest layer", () => {
    expect(faults(layer())).toEqual([]);
  });

  it("gives no fault for the sample", () => {
    expect(checkTofu(SAMPLE_TOFU, SAMPLE_STACK, { budgets: SAMPLE_BUDGETS })).toEqual([]);
  });

  it("gives no fault for a layer with no resource and no option", () => {
    expect(checkTofu({ schema: TOFU_SCHEMA, resources: [] }, stack)).toEqual([]);
  });

  it("does not examine the stack", () => {
    const wrong: Stack = { schema: STACK_SCHEMA, parts: [...stack.parts, part("extra", "missing"), part("account")] };
    expect(checkTofu(layer(), wrong, { budgets })).toEqual([]);
  });
});

describe("the settings", () => {
  it("accepts a list of versions", () => {
    expect(codes(layer({ version: ">= 1.8, < 2.0" }))).toEqual([]);
  });

  it("gives backend for a type with a wrong form, and for a variable in a value", () => {
    expect(codes(layer({ backend: { type: "S3" } }))).toEqual(["backend"]);
    expect(codes(layer({ backend: { type: "local", values: { path: { $var: "path" } } } }))).toEqual(["backend"]);
  });

  it("accepts a backend with literal values", () => {
    expect(codes(layer({ backend: { type: "local", values: { path: "state/example.tfstate" } } }))).toEqual([]);
  });

  it("gives value-form for a wrong form in a backend", () => {
    expect(codes(layer({ backend: { type: "local", values: { path: { $env: "HOME" } } } }))).toEqual(["value-form"]);
  });
});

describe("the providers", () => {
  it("gives provider-form for each field with a wrong form", () => {
    expect(codes(layer({ providers: [{ ...example, alias: "1x" }] }))).toContain("provider-form");
    expect(codes(layer({ providers: [{ ...example, version: "${x}" }] }))).toEqual(["provider-form"]);
    expect(codes(layer({ providers: [{ ...example, source: "https://example.com/x" }] }))).toEqual(["provider-form"]);
    expect(codes(layer({ providers: [{ ...example, name: "Example" }] }))).toEqual(["provider-form", "provider-none"]);
  });

  it("refuses a configuration of the provider that is a part of OpenTofu", () => {
    const found = faults(layer({ providers: [example, { name: "terraform", source: "example-org/terraform", part: "account" }] }));
    expect(found.map((fault) => fault.code)).toEqual(["provider-form"]);
    expect(found[0]?.at).toBe("provider.terraform");
  });

  it("gives provider-source for a different list of versions", () => {
    expect(codes(layer({ providers: [{ ...example, version: "~> 2.0" }, { ...example, alias: "west", version: "~> 3.0" }] }))).toEqual(["provider-source"]);
    expect(codes(layer({ providers: [{ ...example, version: "~> 2.0" }, { ...example, alias: "west" }] }))).toEqual(["provider-source"]);
  });

  it("accepts two configurations of one provider with one source, and counts each against its part", () => {
    const two = layer({
      providers: [example, { ...example, alias: "west", part: "lonely" }],
      resources: [server, { part: "lonely", type: "example_server", provider: "example.west", cost: 3 }],
    });
    expect(codes(two, { budgets: [...budgets, { part: "lonely", hardLimit: 2 }] })).toEqual(["cost-over"]);
    expect(codes(two, { budgets: [...budgets, { part: "lonely", hardLimit: 3 }] })).toEqual([]);
  });

  it("gives provider-none for an alias that the layer does not have", () => {
    const found = faults(one({ provider: "example.east" }));
    expect(found.map((fault) => fault.code)).toEqual(["provider-none"]);
    expect(found[0]?.message).toContain('"example.east"');
  });

  it("gives value-meta for a meta-argument of a provider configuration", () => {
    for (const name of PROVIDER_META) expect(codes(layer({ providers: [{ ...example, values: { [name]: "x" } }] }))).toEqual(["value-meta"]);
  });

  it("names the part that is no part of the stack", () => {
    expect(faults(PLANTED["provider-part"].layer, PLANTED["provider-part"].options)[0]).toMatchObject({ other: "missing", part: "missing" });
  });
});

describe("the resources", () => {
  it("gives resource-form for a type with a wrong form, and for an empty import id", () => {
    expect(codes(one({ type: "Example_server" }))).toContain("resource-form");
    expect(codes(one({ type: "example-server" }))).toContain("resource-form");
    expect(codes(one({ import: "" }))).toEqual(["resource-form"]);
  });

  it("accepts an import id with each character", () => {
    expect(codes(one({ import: "projects/a/zones/b/${c}" }))).toEqual([]);
  });

  it("gives the part of the resource in each fault of a resource", () => {
    for (const code of ["resource-form", "ignore-form", "value-name", "cost-none", "ref-none"] as const) {
      expect(faults(PLANTED[code].layer)[0]?.part).toBe("host");
    }
  });

  it("gives value-meta for each meta-argument of a resource", () => {
    for (const name of RESOURCE_META) expect(codes(one({ values: { [name]: "x" } }))).toEqual(["value-meta"]);
  });

  it("accepts a meta-argument name below the first level, where it is a key of a map", () => {
    expect(codes(one({ values: { labels: { provider: "x", count: 2, "a b": true } } }))).toEqual([]);
  });

  it("gives value-form when the arguments as a whole are a form", () => {
    expect(codes(one({ values: { $ref: "example_server.host.id" } }))).toEqual(["value-form"]);
  });

  it("gives value-form for a form with a second key, and for a key that starts with a dollar sign", () => {
    expect(codes(one({ values: { disk: { $ref: "example_server.host.id", more: 1 } } }))).toEqual(["value-form"]);
    expect(codes(one({ values: { disk: [{ $expr: "1 + 1" }] } }))).toEqual(["value-form"]);
  });

  it("gives value-number for a number that is not finite, at each depth", () => {
    const found = faults(one({ values: { disk: [{ size: Number.NaN }] } }));
    expect(found.map((fault) => fault.code)).toEqual(["value-number"]);
    expect(found[0]?.message).toContain('"disk.0.size"');
  });

  it("names the resource that a reference does not find, and the variable that a value does not find", () => {
    expect(faults(PLANTED["ref-none"].layer)[0]?.other).toBe("example_disk.host");
    expect(faults(PLANTED["var-none"].layer)[0]?.other).toBe("var.token");
  });

  it("accepts a reference to a resource of the layer, and a variable of the layer", () => {
    const good = layer({
      variables: [{ name: "token", sensitive: true }],
      resources: [
        { ...server, values: { disk: { $ref: "example_disk.host.id" }, key: { $var: "token" } } },
        { part: "host", type: "example_disk", cost: 1 },
      ],
    });
    expect(codes(good)).toEqual([]);
  });

  it("names the second resource of a cycle of two", () => {
    const found = faults(
      layer({
        resources: [
          { ...server, values: { disk: { $ref: "example_disk.host.id" } } },
          { part: "host", type: "example_disk", cost: 1, values: { server: { $ref: "example_server.host.id" } } },
        ],
      }),
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ code: "cycle", at: "example_disk.host", other: "example_server.host" });
  });
});

describe("the costs", () => {
  it("accepts a resource that is a part of OpenTofu with no cost, and with a cost of 0", () => {
    expect(codes(layer({ resources: [server, { part: "program", type: "terraform_data" }] }))).toEqual([]);
    expect(codes(layer({ resources: [server, { part: "program", type: "terraform_data", cost: 0 }] }))).toEqual([]);
  });

  it("gives cost-amount for a cost that is not finite", () => {
    expect(codes(one({ cost: Number.NaN }))).toEqual(["cost-amount"]);
    expect(codes(layer({ resources: [server, { part: "program", type: "terraform_data", cost: Number.POSITIVE_INFINITY }] }))).toEqual(["cost-amount"]);
  });

  it("accepts a resource with a cost of 0", () => {
    expect(codes(one({ cost: 0 }))).toEqual([]);
  });

  it("passes when the planned cost is equal to the hard limit", () => {
    expect(codes(one({ cost: 10 }))).toEqual([]);
  });

  it("adds the costs of the resources of an account", () => {
    const two = layer({ resources: [server, { part: "host", type: "example_disk", cost: 5.5 }] });
    const found = faults(two, { budgets, currency: "EUR" });
    expect(found.map((fault) => fault.code)).toEqual(["cost-over"]);
    expect(found[0]?.message).toContain("10.5 EUR");
    expect(found[0]?.message).toContain("10 EUR");
  });

  it("accepts an account with no hard limit when its planned cost is 0", () => {
    expect(codes(one({ cost: 0 }), { budgets: [{ part: "account" }] })).toEqual([]);
  });

  it("gives budget-none also when the planned cost is 0: no read is no pass", () => {
    expect(codes(one({ cost: 0 }), {})).toEqual(["budget-none"]);
    expect(codes(one({ cost: 0 }), { budgets: [{ part: "lonely", hardLimit: 100 }] })).toEqual(["budget-none"]);
  });

  it("gives budget-amount for a hard limit that is not finite", () => {
    expect(codes(layer(), { budgets: [{ part: "account", hardLimit: Number.POSITIVE_INFINITY }] })).toEqual(["budget-amount"]);
  });

  it("uses the first budget of a part when two budgets name it", () => {
    expect(codes(one({ cost: 8 }), { budgets: [{ part: "account", hardLimit: 5 }, { part: "account", hardLimit: 100 }] })).toEqual(["budget-duplicate", "cost-over"]);
  });

  it("gives no fault for a budget of a part with no resource", () => {
    expect(codes(layer(), { budgets: [...budgets, { part: "lonely" }, { part: "not-in-the-stack", hardLimit: 1 }] })).toEqual([]);
  });

  it("gives cost-none and no cost-over when the known costs are under the limit", () => {
    const some = layer({ resources: [server, { part: "host", type: "example_disk" }] });
    expect(codes(some)).toEqual(["cost-none"]);
  });
});

describe("the warnings", () => {
  it("gives no provider-need for a part that needs the account through a different part", () => {
    expect(codes(one({ part: "program" }))).toEqual([]);
  });

  it("gives no provider-need for a resource of the part of the account", () => {
    expect(codes(one({ part: "account" }))).toEqual([]);
  });

  it("names the part of the provider configuration", () => {
    expect(faults(PLANTED["provider-need"].layer)[0]).toMatchObject({ level: "warning", other: "account", part: "lonely" });
  });

  it("gives no variable-unused for a variable that a resource reads", () => {
    expect(codes(layer({ variables: [{ name: "token" }], resources: [{ ...server, values: { key: [{ $var: "token" }] } }] }))).toEqual([]);
  });
});
