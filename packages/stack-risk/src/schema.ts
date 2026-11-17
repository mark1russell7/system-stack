import { formErrors } from "@mark1russell7/system-stack/schema";
import { z } from "zod";
import { RISK_SCHEMA, type RiskLayer } from "./layer.ts";

// The zod schema of a risk layer, and the read of its JSON. This module is the entry `/schema` of the package.
// The root entry has no zod, so a page that only runs the queries gets no schema library.

const id = z.string().min(1);

const goal = z.strictObject({
  part: id,
  survives: z.number(),
  chance: z.number().optional(),
});

const chance = z.strictObject({
  part: id,
  works: z.number(),
  source: z.string().optional(),
});

const accepted = z.strictObject({
  part: id,
  stop: z.array(id).readonly(),
  reason: z.string().min(1),
  until: z.string().optional(),
});

/**
 * The schema of a risk layer. It examines the form of the record: the fields, their types and the finite numbers.
 * It refuses a field that the format does not have. `checkRisk` examines the meaning of a layer with a correct form.
 */
export const riskSchema: z.ZodType<RiskLayer> = z.strictObject({
  schema: z.literal(RISK_SCHEMA),
  goals: z.array(goal).readonly(),
  chances: z.array(chance).readonly().optional(),
  accepted: z.array(accepted).readonly().optional(),
});

/** The result of the read of a risk layer: the layer, or the faults of its form. */
export type RiskParse = { readonly ok: true; readonly layer: RiskLayer } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of a risk layer. It gives the layer, or the faults of its form.
 * Each fault names its place in the record, for example `goals.0.part`.
 */
export function parseRisk(value: unknown): RiskParse {
  const read = riskSchema.safeParse(value);
  if (read.success) return { ok: true, layer: read.data };
  return { ok: false, errors: formErrors(RISK_SCHEMA, read.error.issues) };
}
