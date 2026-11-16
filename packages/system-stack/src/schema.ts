import { z } from "zod";
import { STACK_SCHEMA, type Need, type Part, type Stack } from "./stack.ts";

// The zod schema of a stack document, and the read of its JSON. This module is the entry `/schema` of the package.
// The root entry has no zod, so a page that only evaluates queries gets no schema library.

const id = z.string().min(1);

/** The schema of a need: the `id` of a part, a list with `all`, or a list with `any` and a count. */
export const needSchema: z.ZodType<Need> = z.lazy(() =>
  z.union([id, z.strictObject({ all: z.array(needSchema).readonly() }), z.strictObject({ any: z.array(needSchema).readonly(), count: z.number().optional() })]),
);

/** The schema of a part. It refuses a field that the format does not have. */
export const partSchema: z.ZodType<Part> = z.strictObject({
  id,
  kind: z.string().min(1),
  name: z.string().optional(),
  needs: z.array(needSchema).readonly().optional(),
  owner: id.optional(),
});

/**
 * The schema of a stack document. It examines the form of the record: the fields and their types.
 * It refuses a field that the format does not have. `checkStack` examines the meaning of a stack with a correct form.
 */
export const stackSchema: z.ZodType<Stack> = z.strictObject({
  schema: z.literal(STACK_SCHEMA),
  parts: z.array(partSchema).readonly(),
  layers: z.record(z.string(), z.unknown()).readonly().optional(),
});

/** The result of the read of a stack document: the stack, or the faults of its form. */
export type StackParse = { readonly ok: true; readonly stack: Stack } | { readonly ok: false; readonly errors: readonly string[] };

/**
 * This function gives the faults of the form of a record as texts. Each text names the place of the fault, for example `parts.0.id`.
 * An add-on uses it for the read of its layer, so each fault of form has one wording.
 */
export function formErrors(name: string, issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]): string[] {
  return issues.map((issue) => {
    const place = issue.path.length === 0 ? "the record" : `"${issue.path.map(String).join(".")}"`;
    return `The record "${name}" has a fault at ${place}: ${issue.message}`;
  });
}

/** This function reads the JSON of a stack document. It gives the stack, or the faults of its form. */
export function parseStack(value: unknown): StackParse {
  const read = stackSchema.safeParse(value);
  if (read.success) return { ok: true, stack: read.data };
  return { ok: false, errors: formErrors(STACK_SCHEMA, read.error.issues) };
}
