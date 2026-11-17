import { checkStackLayers, joinStacks, SAMPLE_STACK, STACK_SCHEMA, type LayerPiece, type Stack, type StackFragment } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tofuAddOn } from "./add-on.ts";
import { checkTofu } from "./check.ts";
import { documentText, generateTofu } from "./generate.ts";
import { joinTofu } from "./join.ts";
import { TOFU_SCHEMA, type Provider, type Resource, type TofuLayer, type Variable } from "./layer.ts";
import { SAMPLE_BUDGETS, SAMPLE_TOFU } from "./sample.ts";
import { parseTofu } from "./schema.ts";

const options = { budgets: SAMPLE_BUDGETS };
const resource = (part: string, type = "example_server", name?: string): Resource => ({ part, type, ...(name === undefined ? {} : { name }) });
const provider = (name: string, alias?: string): Provider => ({ name, source: `example-org/${name}`, part: "account", ...(alias === undefined ? {} : { alias }) });
const variable = (name: string): Variable => ({ name });
const layer = (resources: readonly Resource[], more: Partial<TofuLayer> = {}): TofuLayer => ({ schema: TOFU_SCHEMA, resources, ...more });
const piece = (from: string, value: TofuLayer): LayerPiece<TofuLayer> => ({ from, layer: value });
const sorted = (values: readonly unknown[]): string[] => values.map((value) => JSON.stringify(value)).sort();

describe("joinTofu", () => {
  it("gives the resources, the providers and the variables of each fragment, in the order of the fragments", () => {
    const a = layer([resource("one"), resource("one", "example_disk")], { version: ">= 1.8", providers: [provider("example")], variables: [variable("token")] });
    const b = layer([resource("two")], { backend: { type: "local" }, providers: [provider("example", "west")] });
    const c = layer([resource("three")], { version: ">= 1.8", variables: [variable("region")] });
    expect(joinTofu([piece("a", a), piece("b", b), piece("c", c)])).toEqual({
      ok: true,
      layer: {
        schema: TOFU_SCHEMA,
        version: ">= 1.8",
        backend: { type: "local" },
        providers: [provider("example"), provider("example", "west")],
        variables: [variable("token"), variable("region")],
        resources: [resource("one"), resource("one", "example_disk"), resource("two"), resource("three")],
      },
    });
  });

  it("has the optional fields only when a fragment has them", () => {
    expect(joinTofu([piece("a", layer([resource("one")])), piece("b", layer([resource("two")]))])).toEqual({ ok: true, layer: { schema: TOFU_SCHEMA, resources: [resource("one"), resource("two")] } });
    const join = joinTofu([piece("a", layer([], { providers: [] })), piece("b", layer([], { variables: [] }))]);
    expect(join).toEqual({ ok: true, layer: { schema: TOFU_SCHEMA, providers: [], variables: [], resources: [] } });
    expect(joinTofu([])).toEqual({ ok: true, layer: { schema: TOFU_SCHEMA, resources: [] } });
  });

  it("gives a fault for an address or a name in two or more fragments, also when the records are equal", () => {
    const a = layer([resource("one"), resource("two", "example_server", "main")], { providers: [provider("example"), provider("example", "west")], variables: [variable("token")] });
    const b = layer([resource("one"), resource("three", "example_server", "main")], { providers: [provider("example", "west")], variables: [variable("token")] });
    expect(joinTofu([piece("a", a), piece("b", b)])).toEqual({
      ok: false,
      errors: [
        'The fragments "a", "b" each have the provider configuration "example.west".',
        'The fragments "a", "b" each have the variable "token".',
        'The fragments "a", "b" each have the resource "example_server.one".',
        'The fragments "a", "b" each have the resource "example_server.main".',
      ],
    });
  });

  it("gives a fault for a different version of OpenTofu, and for a backend in two or more fragments", () => {
    const a = layer([resource("one")], { version: ">= 1.8", backend: { type: "local" } });
    const b = layer([resource("two")], { version: ">= 1.9" });
    const c = layer([resource("three")], { backend: { type: "local" } });
    expect(joinTofu([piece("a", a), piece("b", b), piece("c", c)])).toEqual({
      ok: false,
      errors: ['The fragment "a" has the version of OpenTofu ">= 1.8", and the fragment "b" has ">= 1.9".', 'The fragments "a", "c" each have a backend. The state has one place.'],
    });
  });

  it("takes the version and the backend from the fragment that has them", () => {
    const join = joinTofu([piece("a", layer([resource("one")])), piece("b", layer([resource("two")], { version: ">= 1.8", backend: { type: "local", values: { path: "state" } } }))]);
    expect(join).toEqual({ ok: true, layer: { schema: TOFU_SCHEMA, version: ">= 1.8", backend: { type: "local", values: { path: "state" } }, resources: [resource("one"), resource("two")] } });
  });
});

/** This function gives the fragments of the sample: fragment `n` has the parts and the records that `owners` gives to it. */
function fragments(owners: readonly number[], count: number): StackFragment[] {
  return Array.from({ length: count }, (_, position) => {
    const mine = (index: number): boolean => (owners[index % owners.length] ?? 0) % count === position;
    const value: TofuLayer = {
      schema: TOFU_SCHEMA,
      ...(position === 0 && SAMPLE_TOFU.version !== undefined ? { version: SAMPLE_TOFU.version } : {}),
      providers: (SAMPLE_TOFU.providers ?? []).filter((_, index) => mine(index + 3)),
      variables: (SAMPLE_TOFU.variables ?? []).filter((_, index) => mine(index + 5)),
      resources: SAMPLE_TOFU.resources.filter((_, index) => mine(index + 7)),
    };
    const stack: Stack = { schema: STACK_SCHEMA, parts: SAMPLE_STACK.parts.filter((_, index) => mine(index)), layers: { [TOFU_SCHEMA]: value } };
    return { name: `file-${String(position)}`, stack };
  });
}

describe("the join of a stack with OpenTofu layers", () => {
  const addOns = [tofuAddOn(options)];
  const whole: Stack = { ...SAMPLE_STACK, layers: { [TOFU_SCHEMA]: SAMPLE_TOFU } };

  it("gives the findings of the whole sample for the sample in two files", () => {
    const join = joinStacks(fragments([0, 1], 2), addOns);
    if (!join.ok) throw new Error(JSON.stringify(join.findings));
    expect(parseTofu(join.stack.layers?.[TOFU_SCHEMA])).toMatchObject({ ok: true });
    expect(sorted(checkStackLayers(join.stack, addOns))).toEqual(sorted(checkStackLayers(whole, addOns)));
  });

  it("gives the finding layer-join with the fragments for a resource in two files", () => {
    const [first, second] = fragments([0, 1], 2) as [StackFragment, StackFragment];
    const twice: StackFragment = { name: "file-1", stack: { ...second.stack, layers: { [TOFU_SCHEMA]: { schema: TOFU_SCHEMA, resources: SAMPLE_TOFU.resources } } } };
    const join = joinStacks([first, twice], addOns);
    if (join.ok) throw new Error("The join has no finding.");
    expect(join.findings.length).toBeGreaterThan(0);
    for (const finding of join.findings) expect(finding).toMatchObject({ level: "error", code: "layer-join", layer: TOFU_SCHEMA, from: ["file-0", "file-1"] });
  });

  it("gives the same records, the same faults and the same document of OpenTofu for each split of the sample", () => {
    const whole = generateTofu(SAMPLE_TOFU, SAMPLE_STACK, options);
    if (!whole.ok) throw new Error(JSON.stringify(whole.faults));
    fc.assert(
      fc.property(fc.array(fc.nat({ max: 2 }), { minLength: 1, maxLength: 12 }), fc.integer({ min: 1, max: 3 }), (owners, count) => {
        const split = fragments(owners, count);
        const before = JSON.stringify(split);
        const join = joinStacks(split, addOns);
        if (!join.ok) throw new Error(JSON.stringify(join.findings));
        const joined = parseTofu(join.stack.layers?.[TOFU_SCHEMA]);
        if (!joined.ok) throw new Error(joined.errors.join(" "));
        expect(joined.layer.version).toBe(SAMPLE_TOFU.version);
        expect(sorted(joined.layer.resources)).toEqual(sorted(SAMPLE_TOFU.resources));
        expect(sorted(joined.layer.providers ?? [])).toEqual(sorted(SAMPLE_TOFU.providers ?? []));
        expect(sorted(joined.layer.variables ?? [])).toEqual(sorted(SAMPLE_TOFU.variables ?? []));
        expect(sorted(checkTofu(joined.layer, join.stack, options))).toEqual(sorted(checkTofu(SAMPLE_TOFU, SAMPLE_STACK, options)));
        // The generator sorts the records, so the text of the file is the same for each split.
        const made = generateTofu(joined.layer, join.stack, options);
        if (!made.ok) throw new Error(JSON.stringify(made.faults));
        expect(documentText(made.document)).toBe(documentText(whole.document));
        expect(JSON.stringify(split)).toBe(before);
      }),
    );
  });
});
