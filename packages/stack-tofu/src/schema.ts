import { formErrors } from "@mark1russell7/system-stack/schema";
import { z } from "zod";
import { TOFU_SCHEMA, VARIABLE_TYPES, type TofuLayer, type TofuObject, type TofuValue } from "./layer.ts";
import type { TofuPlan } from "./plan.ts";

// The zod schema of an OpenTofu layer and of a plan, and the read of their JSON. This module is the entry `/schema` of the package.
// The root entry has no zod, so a page that only generates a document gets no schema library.

const id = z.string().min(1);

/** This function tells if a value is an object of JSON. A list, a date and an instance of a class are not. */
function isPlain(input: unknown): input is Readonly<Record<string, unknown>> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
  const proto: unknown = Object.getPrototypeOf(input);
  return proto === Object.prototype || proto === null;
}

/** This function gives the place of each piece of a value that is not a value of JSON. */
function wrongPlaces(input: unknown, path: readonly (string | number)[] = []): (string | number)[][] {
  if (input === null || typeof input === "string" || typeof input === "boolean") return [];
  if (typeof input === "number") return Number.isFinite(input) ? [] : [[...path]];
  if (Array.isArray(input)) return input.flatMap((item: unknown, at) => wrongPlaces(item, [...path, at]));
  if (isPlain(input)) return Object.entries(input).flatMap(([key, item]) => wrongPlaces(item, [...path, key]));
  return [[...path]];
}

// The arguments of a record are JSON of each depth. One walk examines them, so a fault names its exact place.
const values = z.custom<TofuObject>().superRefine((input, context) => {
  if (!isPlain(input)) {
    context.addIssue({ code: "custom", message: "The arguments are not an object." });
    return;
  }
  for (const path of wrongPlaces(input)) {
    context.addIssue({ code: "custom", path, message: "The value is not a value of JSON: a text, a finite number, a boolean, null, a list or an object." });
  }
});

// One value of JSON of each depth, for example the default of a parameter.
const anyValue = z.custom<TofuValue>((input) => input !== undefined).superRefine((input, context) => {
  for (const path of wrongPlaces(input)) {
    context.addIssue({ code: "custom", path, message: "The value is not a value of JSON: a text, a finite number, a boolean, null, a list or an object." });
  }
});

const provider = z.strictObject({
  name: id,
  source: id,
  version: id.optional(),
  alias: id.optional(),
  part: id,
  values: values.optional(),
});

const variable = z.strictObject({
  name: id,
  type: z.enum([...VARIABLE_TYPES]).optional(),
  sensitive: z.boolean().optional(),
  description: z.string().optional(),
});

const backend = z.strictObject({
  type: id,
  values: values.optional(),
});

const resource = z.strictObject({
  part: id,
  type: id,
  name: id.optional(),
  provider: id.optional(),
  values: values.optional(),
  cost: z.number().optional(),
  keep: z.boolean().optional(),
  ignore: z.array(id).readonly().optional(),
  import: z.string().optional(),
});

const groupParam = z.strictObject({
  name: id,
  default: anyValue.optional(),
  description: z.string().optional(),
});

const groupResource = z.strictObject({
  name: id,
  type: id,
  provider: id.optional(),
  values: values.optional(),
  cost: z.number().optional(),
  keep: z.boolean().optional(),
  ignore: z.array(id).readonly().optional(),
});

const group = z.strictObject({
  name: id,
  params: z.array(groupParam).readonly().optional(),
  resources: z.array(groupResource).readonly(),
});

const copy = z.strictObject({
  part: id,
  group: id,
  name: id.optional(),
  values: values.optional(),
  providers: z.array(id).readonly().optional(),
});

/**
 * The schema of an OpenTofu layer. It examines the form of the record: the fields, their types and the finite numbers.
 * It refuses a field that the format does not have. `checkTofu` examines the meaning of a layer with a correct form.
 */
export const tofuSchema: z.ZodType<TofuLayer> = z.strictObject({
  schema: z.literal(TOFU_SCHEMA),
  version: id.optional(),
  backend: backend.optional(),
  providers: z.array(provider).readonly().optional(),
  variables: z.array(variable).readonly().optional(),
  resources: z.array(resource).readonly(),
  groups: z.array(group).readonly().optional(),
  copies: z.array(copy).readonly().optional(),
});

/** The result of the read of an OpenTofu layer: the layer, or the faults of its form. */
export type TofuParse = { readonly ok: true; readonly layer: TofuLayer } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of an OpenTofu layer. It gives the layer, or the faults of its form.
 * Each fault names its place in the record, for example `resources.0.type`.
 */
export function parseTofu(input: unknown): TofuParse {
  const read = tofuSchema.safeParse(input);
  if (read.success) return { ok: true, layer: read.data };
  return { ok: false, errors: formErrors(TOFU_SCHEMA, read.error.issues) };
}

const change = z.looseObject({
  address: id,
  mode: z.string().optional(),
  change: z.looseObject({
    actions: z.array(z.string()).readonly(),
    importing: z.looseObject({ id: z.string().optional() }).nullable().optional(),
  }),
});

/** The name of a plan in a fault of its form. */
const PLAN_NAME = "plan";

/**
 * The schema of the JSON of a plan of OpenTofu. It examines only the fields that the gate reads.
 * It keeps each other field, because a later version of OpenTofu can add fields. `checkPlan` examines the meaning of the plan.
 */
export const planSchema: z.ZodType<TofuPlan> = z.looseObject({
  format_version: id,
  errored: z.boolean().optional(),
  resource_changes: z.array(change).readonly().optional(),
});

/** The result of the read of a plan: the plan, or the faults of its form. */
export type PlanParse = { readonly ok: true; readonly plan: TofuPlan } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of a plan of OpenTofu, from the command `tofu show -json`. It gives the plan, or the faults of its form.
 * Each fault names its place in the plan, for example `resource_changes.0.address`.
 */
export function parsePlan(input: unknown): PlanParse {
  const read = planSchema.safeParse(input);
  if (read.success) return { ok: true, plan: read.data };
  return { ok: false, errors: formErrors(PLAN_NAME, read.error.issues) };
}
