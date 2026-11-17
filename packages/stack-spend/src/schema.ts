import { formErrors } from "@mark1russell7/system-stack/schema";
import { z } from "zod";
import { BILLINGS, LIMIT_KINDS, SPEND_SCHEMA, type SpendLayer } from "./layer.ts";
import { USE_SOURCES, type UseRead } from "./reads.ts";

// The zod schema of a spend layer, and the read of its JSON. This module is the entry `/schema` of the package.
// The root entry has no zod, so a page that only evaluates the cost math gets no schema library.

const id = z.string().min(1);

const limit = z.strictObject({
  kind: z.enum([...LIMIT_KINDS]),
  amount: z.number(),
  recharge: z.boolean().optional(),
  stop: id.optional(),
});

const proof = z.strictObject({
  date: z.string(),
  by: z.string().min(1),
  source: z.string().optional(),
});

const next = z.strictObject({
  plan: z.string().optional(),
  billing: z.enum([...BILLINGS]),
  price: z.number().optional(),
  limits: z.array(limit).readonly().optional(),
});

const ends = z.strictObject({
  date: z.string(),
  next: next.optional(),
});

const service = z.strictObject({
  part: id,
  plan: z.string().optional(),
  billing: z.enum([...BILLINGS]),
  price: z.number().optional(),
  limits: z.array(limit).readonly().optional(),
  wanted: limit.optional(),
  ends: ends.optional(),
  proof: proof.optional(),
  steps: z.array(z.string()).readonly().optional(),
});

/**
 * The schema of a spend layer. It examines the form of the record: the fields, their types and the finite numbers.
 * It refuses a field that the format does not have. `checkSpend` examines the meaning of a layer with a correct form.
 */
export const spendSchema: z.ZodType<SpendLayer> = z.strictObject({
  schema: z.literal(SPEND_SCHEMA),
  currency: z.string().regex(/^[A-Z]{3}$/, "The currency is a code of three capital letters."),
  kinds: z.array(z.string().min(1)).readonly(),
  proofDays: z.number().positive(),
  endDays: z.number().nonnegative().optional(),
  services: z.array(service).readonly(),
});

/** The result of the read of a spend layer: the layer, or the faults of its form. */
export type SpendParse = { readonly ok: true; readonly layer: SpendLayer } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of a spend layer. It gives the layer, or the faults of its form.
 * Each fault names its place in the record, for example `services.0.part`.
 */
export function parseSpend(value: unknown): SpendParse {
  const read = spendSchema.safeParse(value);
  if (read.success) return { ok: true, layer: read.data };
  return { ok: false, errors: formErrors(SPEND_SCHEMA, read.error.issues) };
}

const read = z.strictObject({
  part: id,
  source: z.enum([...USE_SOURCES]),
  amount: z.number(),
  date: z.string(),
});

/** The name of a list of reads in a fault of its form. */
const READS_NAME = `${SPEND_SCHEMA} reads`;

/**
 * The schema of a list of reads of the used amounts. It examines the form of each read: the fields, their types and the finite numbers.
 * `checkUse` examines the meaning of the reads with a correct form.
 */
export const readsSchema: z.ZodType<readonly UseRead[]> = z.array(read).readonly();

/** The result of the read of a list of reads: the reads, or the faults of their form. */
export type ReadsParse = { readonly ok: true; readonly reads: readonly UseRead[] } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function reads the JSON of a list of reads of the used amounts. It gives the reads, or the faults of their form.
 * Each fault names its place in the list, for example `0.amount`.
 */
export function parseReads(value: unknown): ReadsParse {
  const result = readsSchema.safeParse(value);
  if (result.success) return { ok: true, reads: result.data };
  return { ok: false, errors: formErrors(READS_NAME, result.error.issues) };
}
