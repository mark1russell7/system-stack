import type { Fault } from "@mark1russell7/system-stack";
import { resourceAddress, type TofuLayer } from "./layer.ts";
import { firstResources } from "./queries.ts";

// The gate of a plan. OpenTofu gives a plan as JSON with the command `tofu show -json <plan file>`.
// The gate compares the plan with the records, so a plan that the records do not tell about stops before the apply.

/** A change of one resource in a plan. The names of the fields are the names of the JSON of OpenTofu. */
export interface PlanChange {
  /** The address of the resource, for example `example_server.web`. */
  readonly address: string;
  /** `managed` for a resource, or `data` for a data source. */
  readonly mode?: string | undefined;
  readonly change: {
    /** The actions of the change: `no-op`, `create`, `read`, `update`, `delete` or `forget`. A replacement has `delete` and `create`. */
    readonly actions: readonly string[];
    /** The import of an object that exists at the provider, with its id. A change with no import has none. */
    readonly importing?: { readonly id?: string | undefined } | null | undefined;
  };
}

/** The JSON of a plan of OpenTofu. This type has only the fields that the gate reads. */
export interface TofuPlan {
  /** The version of the format, for example `1.2`. A reader ignores a field that it does not know. */
  readonly format_version: string;
  /** `true`: the plan has an error, and it is not complete. */
  readonly errored?: boolean | undefined;
  readonly resource_changes?: readonly PlanChange[] | undefined;
}

/** These are the codes of the faults of a plan. */
export const PLAN_CODES: readonly ["plan-format", "plan-errored", "plan-action", "plan-unknown", "plan-missing", "plan-destroy", "plan-delete", "plan-forget", "plan-import", "plan-change"] = [
  "plan-format",
  "plan-errored",
  "plan-action",
  "plan-unknown",
  "plan-missing",
  "plan-destroy",
  "plan-delete",
  "plan-forget",
  "plan-import",
  "plan-change",
];

/** A code of a fault of a plan. */
export type PlanCode = (typeof PLAN_CODES)[number];

/** A fault of a plan. Its field `at` is the address of the resource, or `plan` for the plan as a whole. */
export interface PlanFault extends Fault {
  readonly code: PlanCode;
  /** The `id` of the part of the stack of the resource. A resource that the layer does not have has none. */
  readonly part?: string | undefined;
}

/** The options of the gate of a plan. */
export interface PlanOptions {
  /**
   * `true`: the plan must change nothing. Use it for the capture of resources that exist.
   * After their import, a plan with no change tells that the records and the provider agree.
   */
  readonly noChange?: boolean | undefined;
  /** The addresses of the resources that the plan can delete. A delete of a different resource stops the gate. */
  readonly removes?: readonly string[] | undefined;
}

/** The actions of a change that the gate knows. */
const ACTIONS: readonly string[] = ["no-op", "create", "read", "update", "delete", "forget"];

/** The major version of the format of a plan that the gate reads. */
const PLAN_MAJOR = "1";

/**
 * This function gives each fault of a plan for a layer. An empty list tells that the gate passes.
 *
 * The read of the plan:
 * - `plan-format`: the format of the plan has a different major version. The gate reads nothing more.
 * - `plan-errored`: the plan has an error, so it is not complete.
 * - `plan-action`: a change has an action that the gate does not know, or no action.
 *
 * The plan and the records:
 * - `plan-unknown`: the plan changes a resource that the layer does not have. No record tells its cost.
 * - `plan-missing`: the plan does not have a resource of the layer. The plan is not a plan of these records.
 * - `plan-destroy`: the plan deletes or replaces a resource whose record has `keep`.
 * - `plan-delete`: the plan deletes a resource, and the option `removes` does not name it.
 * - `plan-forget`: the plan removes a resource from the state and does not delete it. The object stays at the provider with no record.
 * - `plan-import`: the import of a resource in the plan and the field `import` of its record do not agree.
 * - `plan-change`: the option `noChange` is set, and the plan changes a resource.
 *
 * A gate that cannot read a plan does not pass. The faults are in the sequence of the changes of the plan, then of the resources of the layer.
 * The function is pure.
 */
export function checkPlan(layer: TofuLayer, plan: TofuPlan, options: PlanOptions = {}): PlanFault[] {
  const faults: PlanFault[] = [];
  const add = (code: PlanCode, at: string, message: string, part?: string): void => {
    faults.push({ level: "error", code, at, message, ...(part === undefined ? {} : { part }) });
  };
  if (plan.format_version.split(".")[0] !== PLAN_MAJOR) {
    add("plan-format", "plan", `The format of the plan is "${plan.format_version}". The gate reads the major version ${PLAN_MAJOR}, so it has no read of this plan.`);
    return faults;
  }
  if (plan.errored === true) add("plan-errored", "plan", "The plan has an error, so it is not complete.");
  const resources = new Map(firstResources(layer).map((resource) => [resourceAddress(resource), resource]));
  const removes = new Set(options.removes ?? []);
  const planned = new Set<string>();
  for (const entry of plan.resource_changes ?? []) {
    const at = entry.address;
    planned.add(at);
    const resource = resources.get(at);
    const part = resource?.part;
    const actions = entry.change.actions;
    const unknown = actions.filter((action) => !ACTIONS.includes(action));
    if (actions.length === 0 || unknown.length > 0) {
      add("plan-action", at, actions.length === 0 ? `The change of "${at}" has no action.` : `The change of "${at}" has the action "${unknown[0] ?? ""}", which the gate does not know.`, part);
      continue;
    }
    const deletes = actions.includes("delete");
    const creates = actions.includes("create");
    const importing = entry.change.importing ?? undefined;
    if (actions.includes("forget")) {
      add("plan-forget", at, `The plan removes "${at}" from the state and does not delete it. The object stays at the provider, and no record tells about it.`, part);
    }
    if (resource === undefined) {
      if (deletes && !creates) {
        if (!removes.has(at)) add("plan-delete", at, `The plan deletes "${at}", and the option "removes" does not name it.`);
      } else if (!actions.includes("forget")) {
        add("plan-unknown", at, `The plan has a change (${actions.join(", ")}) of "${at}", which the layer does not have. No record tells its cost.`);
      }
    } else {
      if (deletes && resource.keep === true) {
        add("plan-destroy", at, `The plan ${creates ? "replaces" : "deletes"} "${at}". The record of the part "${resource.part}" tells to keep it.`, part);
      } else if (deletes && !creates && !removes.has(at)) {
        add("plan-delete", at, `The plan deletes "${at}", and the option "removes" does not name it.`, part);
      }
      if (importing !== undefined && resource.import === undefined) {
        add("plan-import", at, `The plan imports an object as "${at}", and the record of the resource has no import.`, part);
      } else if (importing?.id !== undefined && importing.id !== resource.import) {
        add("plan-import", at, `The plan imports the object "${importing.id}" as "${at}". The record names the object "${resource.import ?? ""}".`, part);
      } else if (importing === undefined && resource.import !== undefined && creates) {
        add("plan-import", at, `The plan makes a new object for "${at}". The record names the object "${resource.import}", which exists.`, part);
      }
    }
    if (options.noChange === true && actions.some((action) => action !== "no-op")) {
      add("plan-change", at, `The plan has a change (${actions.join(", ")}) of "${at}", and the plan must change nothing.`, part);
    }
  }
  for (const [address, resource] of resources) {
    if (!planned.has(address)) add("plan-missing", address, `The plan does not have the resource "${address}" of the layer. It is not a plan of these records.`, resource.part);
  }
  return faults;
}
