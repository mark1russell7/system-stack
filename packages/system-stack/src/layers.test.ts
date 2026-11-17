import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkStackLayers, readLayer, type LayerFault, type LayerParse, type StackAddOn } from "./layers.ts";
import { SAMPLE_STACK } from "./sample.ts";
import { partsById, STACK_SCHEMA, type Stack } from "./stack.ts";

// A small add-on for the tests: a layer of notes, and each note names a part of the stack.
interface Notes {
  readonly notes: readonly string[];
}

/** This function makes an add-on of notes. It counts the starts of its check in `starts`. */
function notesAddOn(schema: string, starts: { count: number } = { count: 0 }): StackAddOn<Notes> {
  return {
    schema,
    parse(value: unknown): LayerParse<Notes> {
      const notes: unknown = typeof value === "object" && value !== null ? (value as { readonly notes?: unknown }).notes : undefined;
      if (!Array.isArray(notes)) return { ok: false, errors: [`The layer "${schema}" has no list of notes.`] };
      const errors = notes.flatMap((note: unknown, index) => (typeof note === "string" ? [] : [`The note ${index} of the layer "${schema}" is not a text.`]));
      return errors.length > 0 ? { ok: false, errors } : { ok: true, layer: { notes: notes as readonly string[] } };
    },
    check(layer: Notes, stack: Stack): LayerFault[] {
      starts.count += 1;
      const parts = partsById(stack);
      return layer.notes.filter((note) => !parts.has(note)).map((note) => ({ level: "error", code: "note-part", at: note, message: `The note "${note}" names no part of the stack.` }));
    },
  };
}

const withLayers = (layers: Readonly<Record<string, unknown>>): Stack => ({ ...SAMPLE_STACK, layers });
const lines = (stack: Stack, addOns: readonly StackAddOn<unknown>[]): string[] => checkStackLayers(stack, addOns).map((finding) => `${finding.layer} ${finding.level} ${finding.code} ${finding.at}`);

describe("checkStackLayers", () => {
  it("finds no fault in the sample, with no add-on and with an add-on", () => {
    expect(checkStackLayers(SAMPLE_STACK, [])).toEqual([]);
    expect(checkStackLayers(withLayers({ "notes/1": { notes: ["alert", "phone"] } }), [notesAddOn("notes/1")])).toEqual([]);
  });

  it("gives the faults of an add-on with the name of its layer", () => {
    expect(checkStackLayers(withLayers({ "notes/1": { notes: ["alert", "nothing"] } }), [notesAddOn("notes/1")])).toEqual([
      { layer: "notes/1", level: "error", code: "note-part", at: "nothing", message: 'The note "nothing" names no part of the stack.' },
    ]);
  });

  it("gives a fault of the core with the layer of the core, and starts no add-on then", () => {
    const starts = { count: 0 };
    const broken: Stack = { schema: STACK_SCHEMA, parts: [{ id: "a", kind: "x", needs: ["none"] }], layers: { "notes/1": { notes: ["nothing"] }, "Bad Name": 1 } };
    expect(lines(broken, [notesAddOn("notes/1", starts)])).toEqual(["stack/1 error need-part a"]);
    expect(starts.count).toBe(0);
  });

  it("gives a wrong name, a layer of no add-on and a fault of the form", () => {
    const stack = withLayers({ "notes/2": { notes: [] }, "Bad Name": 1, "notes/1": { notes: ["alert", 5, null] } });
    expect(lines(stack, [notesAddOn("notes/1")])).toEqual(["Bad Name error layer-name ", "notes/1 error layer-form ", "notes/1 error layer-form ", "notes/2 warning layer-unknown "]);
  });

  it("starts the check of each add-on one time, and of no add-on without its layer", () => {
    const first = { count: 0 };
    const second = { count: 0 };
    checkStackLayers(withLayers({ "notes/1": { notes: [] } }), [notesAddOn("notes/1", first), notesAddOn("notes/2", second)]);
    expect([first.count, second.count]).toEqual([1, 0]);
  });

  it("does not change with the order of the layers and of the add-ons", () => {
    const names = ["a/1", "b/1", "c/2", "notes/1"];
    const subset = fc.subarray(names).chain((kept) => fc.shuffledSubarray(kept, { minLength: kept.length }));
    fc.assert(
      fc.property(subset, subset, fc.array(fc.constantFrom("alert", "phone", "nothing", "other"), { maxLength: 3 }), (layerNames, addOnNames, notes) => {
        const layersOf = (order: readonly string[]): Stack => withLayers(Object.fromEntries(order.map((name) => [name, { notes }])));
        const addOnsOf = (order: readonly string[]): StackAddOn<unknown>[] => order.map((name) => notesAddOn(name));
        const sorted = (list: readonly string[]): string[] => [...list].sort();
        expect(checkStackLayers(layersOf(layerNames), addOnsOf(addOnNames))).toEqual(checkStackLayers(layersOf(sorted(layerNames)), addOnsOf(sorted(addOnNames))));
      }),
    );
  });
});

describe("readLayer", () => {
  it("gives the layer of an add-on, and nothing for a stack without it", () => {
    const addOn = notesAddOn("notes/1");
    expect(readLayer(withLayers({ "notes/1": { notes: ["alert"] } }), addOn)).toEqual({ ok: true, layer: { notes: ["alert"] } });
    expect(readLayer(SAMPLE_STACK, addOn)).toBeUndefined();
  });
});
