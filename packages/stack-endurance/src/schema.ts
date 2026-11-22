import { formErrors } from "@mark1russell7/system-stack/schema";
import { z } from "zod";
import { ENDURANCE_SCHEMA, type EnduranceLayer } from "./layer.ts";

// The zod schema of an endurance layer and the read of its JSON. This module is the entry `/schema` of the package.
// The root entry has no zod, so a host that only calculates gets no schema library.

const id = z.string().min(1);
const amount = z.number();

const resource = z.strictObject({ code: id, unit: id });

const store = z.strictObject({
  id,
  resource: id,
  amount,
  due: id.optional(),
  part: id.optional(),
});

const draw = z.strictObject({
  need: id,
  level: id,
  perDay: amount,
  users: amount.optional(),
  supply: id,
});

const directUse = z.strictObject({ resource: id, need: id, amount });

const converter = z.strictObject({
  id,
  device: id.optional(),
  takes: z.array(z.strictObject({ resource: id, amount })).readonly(),
  gives: z.union([z.strictObject({ need: id, amount }), z.strictObject({ resource: id, amount })]),
});

const point = z.tuple([z.number(), z.number()]).readonly();

const cut = z.strictObject({
  part: id,
  title: id,
  duration: z.array(point).readonly().optional(),
  source: id,
});

const caseCuts = z.strictObject({
  case: id,
  title: id,
  cuts: z.array(cut).readonly(),
  factors: z.record(z.string(), amount).optional(),
  leadSeconds: amount.optional(),
});

const prior = z.strictObject({
  case: id,
  place: id,
  perYear: amount,
  reach: amount,
  source: id,
  asOf: id,
});

/**
 * The schema of an endurance layer. It examines the form of the record: the fields and their types.
 * It refuses a field that the format does not have. `checkEndurance` examines the meaning of a layer with a correct form.
 */
export const enduranceSchema: z.ZodType<EnduranceLayer> = z.strictObject({
  schema: z.literal(ENDURANCE_SCHEMA),
  levels: z.array(id).readonly(),
  resources: z.array(resource).readonly(),
  stores: z.array(store).readonly(),
  draws: z.array(draw).readonly(),
  direct: z.array(directUse).readonly().optional(),
  converters: z.array(converter).readonly().optional(),
  cases: z.array(caseCuts).readonly().optional(),
  priors: z.array(prior).readonly().optional(),
});

/** The result of the read of an endurance layer: the layer, or the faults of its form. */
export type EnduranceParse = { readonly ok: true; readonly layer: EnduranceLayer } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of an endurance layer. It gives the layer, or the faults of its form.
 * Each fault names its place in the record, for example `stores.0.amount`.
 */
export function parseEndurance(input: unknown): EnduranceParse {
  const read = enduranceSchema.safeParse(input);
  if (read.success) return { ok: true, layer: read.data };
  return { ok: false, errors: formErrors(ENDURANCE_SCHEMA, read.error.issues) };
}
