import { formErrors, stackSchema } from "@mark1russell7/system-stack/schema";
import { z } from "zod";
import { PLACEMENT_SCHEMA, type PlacementLayer } from "./layer.ts";

// The zod schema of a placement layer, and the read of its JSON. This module is the entry `/schema` of the package.
// The root entry has no zod, so a page that only runs the plan gets no schema library.

const id = z.string().min(1);

const candidate = z.strictObject({
  key: id,
  stack: stackSchema,
  cost: z.number(),
  uses: z.array(id).readonly().optional(),
  source: z.string().optional(),
});

const slot = z.strictObject({
  id,
  candidates: z.array(candidate).readonly(),
  optional: z.boolean().optional(),
});

const shared = z.strictObject({
  id,
  stack: stackSchema,
  cost: z.number().optional(),
});

const limits = z.strictObject({
  cost: z.number().optional(),
  bound: z.number().optional(),
  chance: z.number().optional(),
});

/**
 * The schema of a placement layer. It examines the form of the record: the fields, their types and the finite numbers.
 * It refuses a field that the format does not have. `checkPlacement` examines the meaning of a layer with a correct form.
 */
export const placementSchema: z.ZodType<PlacementLayer> = z.strictObject({
  schema: z.literal(PLACEMENT_SCHEMA),
  part: id,
  currency: id,
  slots: z.array(slot).readonly(),
  shared: z.array(shared).readonly().optional(),
  limits: limits.optional(),
});

/** The result of the read of a placement layer: the layer, or the faults of its form. */
export type PlacementParse = { readonly ok: true; readonly layer: PlacementLayer } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of a placement layer. It gives the layer, or the faults of its form.
 * Each fault names its place in the record, for example `slots.0.candidates.1.cost`.
 */
export function parsePlacement(value: unknown): PlacementParse {
  const read = placementSchema.safeParse(value);
  if (read.success) return { ok: true, layer: read.data };
  return { ok: false, errors: formErrors(PLACEMENT_SCHEMA, read.error.issues) };
}
