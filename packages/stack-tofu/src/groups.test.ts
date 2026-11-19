import { STACK_SCHEMA, type Need, type Part, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { checkTofu } from "./check.ts";
import { plannedTotal } from "./cost.ts";
import { generateTofu } from "./generate.ts";
import { copyResources, layerResources } from "./groups.ts";
import { joinTofu } from "./join.ts";
import { TOFU_SCHEMA, type Copy, type Group, type Provider, type Resource, type TofuLayer } from "./layer.ts";
import { resourcesByPart } from "./queries.ts";
import { parseTofu } from "./schema.ts";

const part = (id: string, ...needs: Need[]): Part => ({ id, kind: "part", needs });
const stack: Stack = { schema: STACK_SCHEMA, parts: [part("account"), part("network", "account"), part("host:a", "account", "network"), part("host:b", "account", "network"), part("dns", "account", "host:a")] };
const providers: Provider[] = [
  { name: "example", source: "example-org/example", part: "account" },
  { name: "example", alias: "east", source: "example-org/example", part: "account" },
];
const network: Resource = { part: "network", type: "example_network", cost: 0 };

// A host as one group: a disk, a server that reads the disk and the network, and a step of OpenTofu after the server.
const host: Group = {
  name: "host",
  params: [{ name: "zone" }, { name: "size", default: "small" }],
  resources: [
    { name: "disk", type: "example_disk", cost: 2, keep: true, values: { zone: { $param: "zone" } } },
    {
      name: "server",
      type: "example_server",
      cost: 5,
      ignore: ["labels"],
      values: { zone: { $param: "zone" }, size: { $param: "size" }, disk: { $ref: "example_disk.disk.id" }, network: { $ref: "example_network.network.id" } },
    },
    { name: "ready", type: "terraform_data", values: { input: { $ref: "example_server.server.address" } } },
  ],
};
const copies: Copy[] = [
  { part: "host:a", group: "host", name: "a", values: { zone: "west" } },
  { part: "host:b", group: "host", values: { zone: "east", size: "large" }, providers: ["example.east"] },
];
const layer: TofuLayer = { schema: TOFU_SCHEMA, providers, resources: [network], groups: [host], copies };
const budgets = [{ part: "account", hardLimit: 20 }];

describe("the resources of the copies", () => {
  it("makes the resources of each copy, with the values, the references and the providers of the copy", () => {
    expect(copyResources(layer)).toEqual([
      { part: "host:a", type: "example_disk", name: "a_disk", cost: 2, keep: true, values: { zone: "west" } },
      {
        part: "host:a",
        type: "example_server",
        name: "a_server",
        cost: 5,
        ignore: ["labels"],
        values: { zone: "west", size: "small", disk: { $ref: "example_disk.a_disk.id" }, network: { $ref: "example_network.network.id" } },
      },
      { part: "host:a", type: "terraform_data", name: "a_ready", values: { input: { $ref: "example_server.a_server.address" } } },
      { part: "host:b", type: "example_disk", name: "host_b_disk", provider: "example.east", cost: 2, keep: true, values: { zone: "east" } },
      {
        part: "host:b",
        type: "example_server",
        name: "host_b_server",
        provider: "example.east",
        cost: 5,
        ignore: ["labels"],
        values: { zone: "east", size: "large", disk: { $ref: "example_disk.host_b_disk.id" }, network: { $ref: "example_network.network.id" } },
      },
      { part: "host:b", type: "terraform_data", name: "host_b_ready", values: { input: { $ref: "example_server.host_b_server.address" } } },
    ]);
  });

  it("gives the resources of a layer with no copy as they are", () => {
    const flat: TofuLayer = { schema: TOFU_SCHEMA, providers, resources: [network] };
    expect(layerResources(flat)).toBe(flat.resources);
    expect(layerResources(layer).map((resource) => resource.name ?? resource.part)).toEqual(["network", "a_disk", "a_server", "a_ready", "host_b_disk", "host_b_server", "host_b_ready"]);
  });

  it("makes no resource for a copy with no group or with a parameter that has no value", () => {
    expect(copyResources({ ...layer, copies: [{ part: "host:a", group: "missing" }, { part: "host:b", group: "host" }] })).toEqual([]);
  });

  it("does not change the value of a parameter, also when it has a form", () => {
    const formed = copyResources({ ...layer, copies: [{ part: "host:a", group: "host", values: { zone: { $ref: "example_disk.disk.zone" } } }] });
    expect(formed[0]?.values).toEqual({ zone: { $ref: "example_disk.disk.zone" } });
  });
});

describe("the copies in the gate, the queries and the files", () => {
  it("passes the gate, and the cost of each copy counts against its account", () => {
    expect(checkTofu(layer, stack, { budgets })).toEqual([]);
    expect(plannedTotal(layer)).toBe(14);
    const over = checkTofu(layer, stack, { budgets: [{ part: "account", hardLimit: 10 }] });
    expect(over.map((fault) => `${fault.code} ${fault.at}`)).toEqual(["cost-over account"]);
  });

  it("gives the resources of each copy to its part", () => {
    expect(resourcesByPart(layer).get("host:b")).toEqual(["example_disk.host_b_disk", "example_server.host_b_server", "terraform_data.host_b_ready"]);
  });

  it("writes each resource of each copy, with the dependencies from the needs of its part", () => {
    const made = generateTofu(layer, stack, { budgets });
    if (!made.ok) expect.fail(made.faults.map((fault) => fault.message).join("\n"));
    const blocks = made.document["resource"] as Record<string, Record<string, Record<string, unknown>>>;
    expect(Object.keys(blocks["example_server"] ?? {})).toEqual(["a_server", "host_b_server"]);
    expect(blocks["example_server"]?.["host_b_server"]?.["provider"]).toBe("example.east");
    expect(blocks["example_server"]?.["a_server"]?.["disk"]).toBe("${example_disk.a_disk.id}");
    expect(blocks["example_disk"]?.["a_disk"]?.["depends_on"]).toEqual(["example_network.network"]);
  });

  it("gives a fault of a resource of a group at each copy", () => {
    const free: Group = { ...host, resources: host.resources.map((resource) => (resource.name === "disk" ? { name: "disk", type: "example_disk", values: { zone: { $param: "zone" } } } : resource)) };
    const found = checkTofu({ ...layer, groups: [free] }, stack, { budgets });
    expect(found.map((fault) => `${fault.code} ${fault.at}`)).toEqual(["cost-none example_disk.a_disk", "cost-none example_disk.host_b_disk"]);
  });

  it("gives a reference from a resource of the layer to a resource of a copy", () => {
    // The record is in a part that needs the host. In the part `network`, it would wait in a cycle: the host needs the network.
    const record: Resource = { part: "dns", type: "example_record", cost: 0, values: { target: { $ref: "example_server.a_server.address" } } };
    expect(checkTofu({ ...layer, resources: [network, record] }, stack, { budgets }).filter((fault) => fault.level === "error")).toEqual([]);
  });
});

describe("the form of a group and of a copy", () => {
  it("reads a layer with groups and copies", () => {
    const read = parseTofu(JSON.parse(JSON.stringify(layer)));
    expect(read).toEqual({ ok: true, layer });
  });

  it("refuses an import id in a resource of a group, and a field that a copy does not have", () => {
    const imported = parseTofu({ ...layer, groups: [{ ...host, resources: [{ name: "disk", type: "example_disk", import: "disk-1" }] }] });
    expect(imported.ok).toBe(false);
    if (!imported.ok) expect(imported.errors.join("\n")).toContain("groups.0.resources.0");
    const extra = parseTofu({ ...layer, copies: [{ part: "host:a", group: "host", count: 2 }] });
    expect(extra.ok).toBe(false);
    if (!extra.ok) expect(extra.errors.join("\n")).toContain("copies.0");
  });

  it("refuses a default that is not a value of JSON", () => {
    const read = parseTofu({ ...layer, groups: [{ ...host, params: [{ name: "zone", default: Number.NaN }] }] });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.errors.join("\n")).toContain("groups.0.params.0.default");
  });
});

describe("the join of groups and copies", () => {
  const groupsPiece: TofuLayer = { schema: TOFU_SCHEMA, providers, resources: [network], groups: [host] };
  const copiesPiece: TofuLayer = { schema: TOFU_SCHEMA, resources: [], copies };

  it("joins a group of one fragment and its copies in a different fragment", () => {
    const joined = joinTofu([
      { from: "groups", layer: groupsPiece },
      { from: "copies", layer: copiesPiece },
    ]);
    if (!joined.ok) expect.fail(joined.errors.join("\n"));
    expect(joined.layer.groups).toEqual([host]);
    expect(joined.layer.copies).toEqual(copies);
    expect(checkTofu(joined.layer, stack, { budgets })).toEqual([]);
  });

  it("refuses a group or a copy in two fragments", () => {
    const twice = joinTofu([
      { from: "one", layer: groupsPiece },
      { from: "two", layer: { ...copiesPiece, groups: [host], copies: [copies[0] as Copy] } },
      { from: "three", layer: { schema: TOFU_SCHEMA, resources: [], copies: [copies[0] as Copy] } },
    ]);
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.errors).toHaveLength(2);
  });
});
