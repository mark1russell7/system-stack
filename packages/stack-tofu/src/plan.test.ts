import { describe, expect, it } from "vitest";
import { TOFU_SCHEMA, type Resource, type TofuLayer } from "./layer.ts";
import { checkPlan, PLAN_CODES, type PlanChange, type PlanCode, type PlanFault, type PlanOptions, type TofuPlan } from "./plan.ts";
import { SAMPLE_PLAN, SAMPLE_TOFU } from "./sample.ts";

const server: Resource = { part: "host", type: "example_server", cost: 5, keep: true };
const disk: Resource = { part: "host", type: "example_disk", cost: 1 };
const old: Resource = { part: "host", type: "example_address", cost: 1, import: "address-1" };
const layer: TofuLayer = { schema: TOFU_SCHEMA, resources: [server, disk, old] };
const change = (address: string, actions: readonly string[], importing?: { readonly id?: string } | null): PlanChange => ({
  address,
  mode: "managed",
  change: { actions, ...(importing === undefined ? {} : { importing }) },
});
const quiet: readonly PlanChange[] = [change("example_server.host", ["no-op"]), change("example_disk.host", ["no-op"]), change("example_address.host", ["no-op"])];
/** This function gives a plan with no change, and then the changes of the test in the place of the entries of their addresses. */
const plan = (...changes: PlanChange[]): TofuPlan => ({
  format_version: "1.2",
  resource_changes: [...quiet.filter((entry) => !changes.some((other) => other.address === entry.address)), ...changes],
});
const faults = (of: TofuPlan, options: PlanOptions = {}): PlanFault[] => checkPlan(layer, of, options);
const codes = (of: TofuPlan, options: PlanOptions = {}): PlanCode[] => faults(of, options).map((fault) => fault.code);

describe("the codes", () => {
  it("has each code one time", () => {
    expect(new Set(PLAN_CODES).size).toBe(PLAN_CODES.length);
  });
});

describe("a plan that passes", () => {
  it("gives no fault for the sample", () => {
    expect(checkPlan(SAMPLE_TOFU, SAMPLE_PLAN)).toEqual([]);
  });

  it("gives no fault for a plan with no change, also when the plan must change nothing", () => {
    expect(faults(plan())).toEqual([]);
    expect(faults(plan(), { noChange: true })).toEqual([]);
  });

  it("gives no fault for a create, an update and a replacement of a resource with no keep", () => {
    expect(codes(plan(change("example_disk.host", ["create"])))).toEqual([]);
    expect(codes(plan(change("example_disk.host", ["update"])))).toEqual([]);
    expect(codes(plan(change("example_disk.host", ["delete", "create"])))).toEqual([]);
    expect(codes(plan(change("example_disk.host", ["create", "delete"])))).toEqual([]);
  });

  it("gives no fault for an update of a resource with keep", () => {
    expect(codes(plan(change("example_server.host", ["update"])))).toEqual([]);
  });

  it("gives no fault for a layer and a plan with no resource", () => {
    expect(checkPlan({ schema: TOFU_SCHEMA, resources: [] }, { format_version: "1.0" })).toEqual([]);
  });
});

describe("the read of a plan", () => {
  it("gives plan-format for a different major version, and reads nothing more", () => {
    for (const format_version of ["2.0", "0.9", "", "v1", "10.1"]) {
      const found = checkPlan(layer, { format_version, errored: true, resource_changes: [change("example_other.x", ["create"])] });
      expect(found.map((fault) => [fault.code, fault.at])).toEqual([["plan-format", "plan"]]);
    }
  });

  it("reads each minor version of the major version 1", () => {
    for (const format_version of ["1.0", "1.2", "1.99", "1"]) expect(checkPlan(layer, { format_version, resource_changes: quiet })).toEqual([]);
  });

  it("gives plan-errored for a plan with an error", () => {
    expect(faults({ ...plan(), errored: true }).map((fault) => [fault.code, fault.at])).toEqual([["plan-errored", "plan"]]);
    expect(codes({ ...plan(), errored: false })).toEqual([]);
  });

  it("gives plan-action for an action that the gate does not know, and for no action", () => {
    expect(codes(plan(change("example_disk.host", ["open"])))).toEqual(["plan-action"]);
    expect(codes(plan(change("example_disk.host", ["update", "move"])))).toEqual(["plan-action"]);
    expect(codes(plan(change("example_disk.host", [])))).toEqual(["plan-action"]);
    expect(faults(plan(change("example_disk.host", ["open"])))[0]?.message).toContain('"open"');
  });

  it("does not count a change that it cannot read as a change of the resource", () => {
    expect(codes(plan(change("example_server.host", ["erase"])), { noChange: true })).toEqual(["plan-action"]);
  });
});

describe("the plan and the records", () => {
  it("gives plan-unknown for a change of a resource that the layer does not have", () => {
    for (const actions of [["create"], ["update"], ["no-op"], ["read"], ["delete", "create"]]) {
      const found = faults(plan(change("example_other.x", actions)));
      expect(found.map((fault) => [fault.code, fault.at])).toEqual([["plan-unknown", "example_other.x"]]);
      expect(found[0]).not.toHaveProperty("part");
    }
  });

  it("gives plan-unknown for a data source and for a resource of a module", () => {
    expect(codes(plan({ address: "data.example_image.x", mode: "data", change: { actions: ["read"] } }))).toEqual(["plan-unknown"]);
    expect(codes(plan(change("module.a.example_server.host", ["create"])))).toEqual(["plan-unknown"]);
  });

  it("gives plan-missing for a resource of the layer that the plan does not have", () => {
    const found = checkPlan(layer, { format_version: "1.2", resource_changes: [change("example_disk.host", ["no-op"])] });
    expect(found.map((fault) => [fault.code, fault.at, fault.part])).toEqual([
      ["plan-missing", "example_server.host", "host"],
      ["plan-missing", "example_address.host", "host"],
    ]);
    expect(checkPlan(layer, { format_version: "1.2" }).map((fault) => fault.code)).toEqual(["plan-missing", "plan-missing", "plan-missing"]);
  });

  it("gives plan-destroy for a delete and for a replacement of a resource with keep", () => {
    for (const actions of [["delete"], ["delete", "create"], ["create", "delete"]]) {
      expect(faults(plan(change("example_server.host", actions))).map((fault) => [fault.code, fault.at, fault.part])).toEqual([["plan-destroy", "example_server.host", "host"]]);
    }
    expect(faults(plan(change("example_server.host", ["delete", "create"])))[0]?.message).toContain("replaces");
  });

  it("gives plan-destroy also when the option removes names the resource", () => {
    expect(codes(plan(change("example_server.host", ["delete"])), { removes: ["example_server.host"] })).toEqual(["plan-destroy"]);
  });

  it("gives plan-delete for a delete that the option removes does not name", () => {
    expect(codes(plan(change("example_disk.host", ["delete"])))).toEqual(["plan-delete"]);
    expect(codes(plan(change("example_gone.x", ["delete"])))).toEqual(["plan-delete"]);
    expect(codes(plan(change("example_gone.x", ["delete"])), { removes: ["example_other.y"] })).toEqual(["plan-delete"]);
  });

  it("accepts a delete that the option removes names", () => {
    expect(codes(plan(change("example_gone.x", ["delete"])), { removes: ["example_gone.x"] })).toEqual([]);
    expect(codes(plan(change("example_disk.host", ["delete"])), { removes: ["example_disk.host"] })).toEqual([]);
  });

  it("gives plan-forget for a resource that leaves the state and stays at the provider", () => {
    expect(codes(plan(change("example_gone.x", ["forget"])))).toEqual(["plan-forget"]);
    expect(codes(plan(change("example_disk.host", ["forget"])))).toEqual(["plan-forget"]);
    expect(codes(plan(change("example_gone.x", ["forget"])), { removes: ["example_gone.x"] })).toEqual(["plan-forget"]);
  });
});

describe("the import of a resource", () => {
  it("accepts the import of the object that the record names", () => {
    expect(codes(plan(change("example_address.host", ["no-op"], { id: "address-1" })), { noChange: true })).toEqual([]);
    expect(codes(plan(change("example_address.host", ["update"], { id: "address-1" })))).toEqual([]);
  });

  it("accepts a record with an import when the state has the resource", () => {
    expect(codes(plan(change("example_address.host", ["no-op"])))).toEqual([]);
    expect(codes(plan(change("example_address.host", ["update"], null)))).toEqual([]);
  });

  it("gives plan-import for the import of a different object", () => {
    const found = faults(plan(change("example_address.host", ["no-op"], { id: "address-2" })));
    expect(found.map((fault) => fault.code)).toEqual(["plan-import"]);
    expect(found[0]?.message).toContain('"address-2"');
    expect(found[0]?.message).toContain('"address-1"');
  });

  it("gives plan-import for an import that the record does not have", () => {
    expect(codes(plan(change("example_disk.host", ["no-op"], { id: "disk-1" })))).toEqual(["plan-import"]);
    expect(codes(plan(change("example_disk.host", ["no-op"], {})))).toEqual(["plan-import"]);
  });

  it("gives plan-import when the plan makes a new object for a record that names an object", () => {
    expect(codes(plan(change("example_address.host", ["create"])))).toEqual(["plan-import"]);
    expect(codes(plan(change("example_address.host", ["delete", "create"])))).toEqual(["plan-import"]);
  });
});

describe("a plan that must change nothing", () => {
  it("gives plan-change for each change", () => {
    for (const actions of [["create"], ["update"], ["read"], ["delete", "create"]]) {
      expect(codes(plan(change("example_disk.host", actions)), { noChange: true })).toEqual(["plan-change"]);
    }
  });

  it("gives plan-change with the other faults of a change", () => {
    expect(codes(plan(change("example_server.host", ["delete"])), { noChange: true })).toEqual(["plan-destroy", "plan-change"]);
    expect(codes(plan(change("example_other.x", ["create"])), { noChange: true })).toEqual(["plan-unknown", "plan-change"]);
    expect(codes(plan(change("example_gone.x", ["delete"])), { noChange: true, removes: ["example_gone.x"] })).toEqual(["plan-change"]);
  });
});

describe("the faults of a plan", () => {
  it("are errors, in the sequence of the changes of the plan, then of the resources of the layer", () => {
    const found = checkPlan(layer, {
      format_version: "1.2",
      errored: true,
      resource_changes: [change("example_other.x", ["create"]), change("example_server.host", ["delete"]), change("example_disk.host", ["delete"])],
    });
    expect(found.map((fault) => fault.code)).toEqual(["plan-errored", "plan-unknown", "plan-destroy", "plan-delete", "plan-missing"]);
    expect(found.every((fault) => fault.level === "error")).toBe(true);
  });

  it("uses the first resource of an address of the layer", () => {
    const twice: TofuLayer = { schema: TOFU_SCHEMA, resources: [disk, { ...disk, keep: true }] };
    expect(checkPlan(twice, { format_version: "1.2", resource_changes: [change("example_disk.host", ["delete", "create"])] })).toEqual([]);
  });
});
