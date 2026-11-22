import { formErrors } from "@mark1russell7/system-stack/schema";
import { z } from "zod";
import { SETUP_SCHEMA, type SetupLayer } from "./layer.ts";

// The zod schema of a setup layer and the read of its JSON. This module is the entry `/schema` of the package.
// The root entry has no zod, so a host that only generates a script gets no schema library.

const id = z.string().min(1);
const description = z.string().optional();

const variableRead = z.strictObject({ $var: id });
const text = z.union([z.string(), variableRead, z.array(z.union([z.string(), variableRead])).readonly()]);

const variable = z.strictObject({
  name: id,
  sensitive: z.boolean().optional(),
  description,
});

const packageStep = z.strictObject({
  kind: z.literal("package"),
  id,
  description,
  manager: z.literal("apt"),
  names: z.array(id).readonly(),
});

const userStep = z.strictObject({
  kind: z.literal("user"),
  id,
  description,
  name: id,
  groups: z.array(id).readonly().optional(),
  shell: id.optional(),
  keys: z.array(z.string()).readonly().optional(),
});

const fileStep = z.strictObject({
  kind: z.literal("file"),
  id,
  description,
  path: id,
  text,
  mode: id.optional(),
  owner: id.optional(),
  group: id.optional(),
});

const downloadStep = z.strictObject({
  kind: z.literal("download"),
  id,
  description,
  url: id,
  sha256: id,
  path: id,
  mode: id.optional(),
});

const swapStep = z.strictObject({
  kind: z.literal("swap"),
  id,
  description,
  path: id,
  mib: z.number(),
});

const serviceStep = z.strictObject({
  kind: z.literal("service"),
  id,
  description,
  name: id,
  unit: text,
  enable: z.boolean().optional(),
});

const archiveStep = z.strictObject({
  kind: z.literal("archive"),
  id,
  description,
  url: id,
  sha256: id,
  into: id,
  strip: z.number().optional(),
  mark: z.strictObject({ path: id, sha256: id }),
});

const commandStep = z.strictObject({
  kind: z.literal("command"),
  id,
  description,
  run: z.array(text).readonly(),
  check: z.array(text).readonly(),
  as: id.optional(),
  input: text.optional(),
});

const step = z.discriminatedUnion("kind", [packageStep, userStep, fileStep, downloadStep, archiveStep, swapStep, serviceStep, commandStep]);

const profile = z.strictObject({
  name: id,
  part: id,
  hosts: z.array(id).readonly(),
  steps: z.array(step).readonly(),
});

/**
 * The schema of a setup layer. It examines the form of the record: the fields and their types.
 * It refuses a field that the format does not have. `checkSetup` examines the meaning of a layer with a correct form.
 */
export const setupSchema: z.ZodType<SetupLayer> = z.strictObject({
  schema: z.literal(SETUP_SCHEMA),
  variables: z.array(variable).readonly().optional(),
  profiles: z.array(profile).readonly(),
});

/** The result of the read of a setup layer: the layer, or the faults of its form. */
export type SetupParse = { readonly ok: true; readonly layer: SetupLayer } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of a setup layer. It gives the layer, or the faults of its form.
 * Each fault names its place in the record, for example `profiles.0.steps.1.kind`.
 */
export function parseSetup(input: unknown): SetupParse {
  const read = setupSchema.safeParse(input);
  if (read.success) return { ok: true, layer: read.data };
  return { ok: false, errors: formErrors(SETUP_SCHEMA, read.error.issues) };
}
