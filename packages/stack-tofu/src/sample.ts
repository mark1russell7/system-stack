import type { Budget } from "./cost.ts";
import { TOFU_SCHEMA, type TofuLayer } from "./layer.ts";
import type { TofuPlan } from "./plan.ts";

/**
 * A sample OpenTofu layer for `SAMPLE_STACK` of the core. Each name and each amount is an example: the provider `example` does not exist.
 * The cloud server, its disk and its firewall make the part `cloud-host`. A resource of OpenTofu starts the program on the server.
 */
export const SAMPLE_TOFU: TofuLayer = {
  schema: TOFU_SCHEMA,
  version: ">= 1.8",
  providers: [{ name: "example", source: "example-org/example", version: "~> 2.0", part: "cloud-account", values: { token: { $var: "example_token" } } }],
  variables: [{ name: "example_token", sensitive: true, description: "The token of the account of the cloud provider" }],
  resources: [
    { part: "cloud-host", type: "example_disk", values: { size_gb: 10 }, cost: 1, keep: true },
    {
      part: "cloud-host",
      type: "example_server",
      values: { name: "alerts", size: "small", disk: { $ref: "example_disk.cloud-host.id" } },
      cost: 6,
      keep: true,
      ignore: ["labels"],
    },
    { part: "cloud-host", type: "example_firewall", values: { server: { $ref: "example_server.cloud-host.id" }, ports: [22, 443] }, cost: 0 },
    { part: "program-cloud", type: "terraform_data", values: { input: { release: "1.4.0" } } },
  ],
};

/**
 * Sample budgets for `SAMPLE_TOFU`: the hard limit of the cloud account for a month. The amount is an example.
 * The planned cost of the sample is 7, so the gate passes.
 */
export const SAMPLE_BUDGETS: readonly Budget[] = [{ part: "cloud-account", hardLimit: 10 }];

/**
 * A sample plan for `SAMPLE_TOFU`, with only the fields that the gate reads: the first plan, which makes each resource.
 * The gate of a plan passes for it.
 */
export const SAMPLE_PLAN: TofuPlan = {
  format_version: "1.2",
  resource_changes: [
    { address: "example_disk.cloud-host", mode: "managed", change: { actions: ["create"] } },
    { address: "example_firewall.cloud-host", mode: "managed", change: { actions: ["create"] } },
    { address: "example_server.cloud-host", mode: "managed", change: { actions: ["create"] } },
    { address: "terraform_data.program-cloud", mode: "managed", change: { actions: ["create"] } },
  ],
};
