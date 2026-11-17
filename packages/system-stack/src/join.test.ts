import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkStack } from "./check.ts";
import { joinRecords, joinStacks, STACK_JOIN_CODES, type StackFragment, type StackJoin, type StackJoiner, type StackJoinFinding } from "./join.ts";
import { checkStackLayers, type LayerFault, type LayerParse } from "./layers.ts";
import { SAMPLE_STACK } from "./sample.ts";
import { partsById, STACK_SCHEMA, type Part, type Stack } from "./stack.ts";

// A small add-on for the tests: a layer of notes. Each note names a part of the stack, and each note has one fragment.
interface Notes {
  readonly notes: readonly string[];
}

/** This function makes an add-on of notes with its join. It counts the starts of its join in `starts`. */
function notesJoiner(schema = "notes/1", starts: { count: number } = { count: 0 }): StackJoiner<Notes> {
  return {
    schema,
    parse(value: unknown): LayerParse<Notes> {
      const notes: unknown = typeof value === "object" && value !== null ? (value as { readonly notes?: unknown }).notes : undefined;
      if (!Array.isArray(notes) || notes.some((note: unknown) => typeof note !== "string")) return { ok: false, errors: [`The layer "${schema}" has no list of notes.`] };
      return { ok: true, layer: { notes: notes as readonly string[] } };
    },
    check(layer: Notes, stack: Stack): LayerFault[] {
      const parts = partsById(stack);
      return layer.notes.filter((note) => !parts.has(note)).map((note) => ({ level: "error", code: "note-part", at: note, message: `The note "${note}" names no part of the stack.` }));
    },
    join(pieces): LayerParse<Notes> {
      starts.count += 1;
      const notes = joinRecords(
        pieces,
        (layer) => layer.notes,
        (note) => note,
        "note",
      );
      return notes.errors.length === 0 ? { ok: true, layer: { notes: notes.items } } : { ok: false, errors: notes.errors };
    },
  };
}

const part = (id: string, needs?: readonly string[]): Part => ({ id, kind: "service", ...(needs === undefined ? {} : { needs }) });
const stack = (parts: readonly Part[], layers?: Readonly<Record<string, unknown>>): Stack => ({ schema: STACK_SCHEMA, parts, ...(layers === undefined ? {} : { layers }) });
const fragment = (name: string, doc: Stack): StackFragment => ({ name, stack: doc });

/** This function gives the stack of a join that has no finding. */
function stackOf(join: StackJoin): Stack {
  if (!join.ok) throw new Error(`The join has findings: ${JSON.stringify(join.findings)}`);
  return join.stack;
}

/** This function gives the findings of a join that has no stack. */
function findingsOf(join: StackJoin): readonly StackJoinFinding[] {
  if (join.ok) throw new Error(`The join has no finding: ${JSON.stringify(join.stack)}`);
  return join.findings;
}

describe("joinStacks", () => {
  it("gives the parts of each fragment, in the order of the fragments", () => {
    const a = stack([part("web", ["db"]), part("db")]);
    const b = stack([part("mail")]);
    expect(joinStacks([fragment("a", a), fragment("b", b)], [])).toEqual({ ok: true, stack: stack([part("web", ["db"]), part("db"), part("mail")]) });
    expect(stackOf(joinStacks([fragment("b", b), fragment("a", a)], [])).parts.map((item) => item.id)).toEqual(["mail", "web", "db"]);
  });

  it("gives the fragment for one fragment, and the empty stack for no fragment", () => {
    expect(joinStacks([fragment("sample", SAMPLE_STACK)], [])).toEqual({ ok: true, stack: SAMPLE_STACK });
    const layered = stack([part("web")], { "notes/1": { notes: ["web"] }, "other/1": 5 });
    expect(joinStacks([fragment("a", layered)], [notesJoiner()])).toEqual({ ok: true, stack: layered });
    expect(joinStacks([], [notesJoiner()])).toEqual({ ok: true, stack: { schema: STACK_SCHEMA, parts: [] } });
  });

  it("lets a fragment need a part of a different fragment, and the check reads the joined stack", () => {
    const a = stack([{ ...part("web", ["db"]), owner: "team" }]);
    const b = stack([part("db"), { id: "team", kind: "person" }]);
    expect(checkStack(a).map((fault) => fault.code)).toEqual(["need-part", "owner-part"]);
    const joined = stackOf(joinStacks([fragment("a", a), fragment("b", b)], []));
    expect(checkStackLayers(joined, [])).toEqual([]);
  });

  it("gives the error part-twice for a part of two or more fragments, also when the parts are equal", () => {
    const a = stack([part("web"), part("db")]);
    const b = stack([part("mail"), part("db")]);
    const c = stack([part("web", ["db"]), part("db")]);
    expect(joinStacks([fragment("a", a), fragment("b", b), fragment("c", c)], [])).toEqual({
      ok: false,
      findings: [
        { level: "error", code: "part-twice", layer: STACK_SCHEMA, at: "web", from: ["a", "c"], message: 'The fragments "a", "c" each have the part "web".' },
        { level: "error", code: "part-twice", layer: STACK_SCHEMA, at: "db", from: ["a", "b", "c"], message: 'The fragments "a", "b", "c" each have the part "db".' },
      ],
    });
  });

  it("keeps a part that one fragment has two times, so the check of the stack gives its fault", () => {
    const joined = stackOf(joinStacks([fragment("a", stack([part("web"), part("web")])), fragment("b", stack([part("db")]))], []));
    expect(joined.parts.map((item) => item.id)).toEqual(["web", "web", "db"]);
    expect(checkStack(joined).map((fault) => `${fault.code} ${fault.at}`)).toEqual(["id-duplicate web"]);
  });

  it("gives the error fragment-name for a name of two or more fragments", () => {
    const fragments = [fragment("a", stack([part("web")])), fragment("b", stack([part("db")])), fragment("a", stack([part("mail")])), fragment("a", stack([]))];
    expect(findingsOf(joinStacks(fragments, []))).toEqual([{ level: "error", code: "fragment-name", layer: STACK_SCHEMA, at: "a", from: ["a"], message: '3 fragments have the name "a".' }]);
  });

  it("keeps a layer of one fragment as it is, and no add-on reads it", () => {
    const starts = { count: 0 };
    const layer = { notes: 5 };
    const joined = stackOf(joinStacks([fragment("a", stack([part("web")], { "notes/1": layer })), fragment("b", stack([part("db")], { "other/1": [1] }))], [notesJoiner("notes/1", starts)]));
    expect(joined.layers).toEqual({ "notes/1": { notes: 5 }, "other/1": [1] });
    expect(joined.layers?.["notes/1"]).toBe(layer);
    expect(starts.count).toBe(0);
  });

  it("gives a layer of two or more fragments to the join of its add-on, in the order of the fragments", () => {
    const starts = { count: 0 };
    const a = stack([part("web")], { "notes/1": { notes: ["web"] } });
    const b = stack([part("db")]);
    const c = stack([part("mail")], { "notes/1": { notes: ["mail", "db"] } });
    const joined = stackOf(joinStacks([fragment("a", a), fragment("b", b), fragment("c", c)], [notesJoiner("notes/1", starts)]));
    expect(joined).toEqual(stack([part("web"), part("db"), part("mail")], { "notes/1": { notes: ["web", "mail", "db"] } }));
    expect(starts.count).toBe(1);
    expect(checkStackLayers(joined, [notesJoiner()])).toEqual([]);
  });

  it("gives the findings of the layers with their fragments: no add-on, a bad form and a fault of the join", () => {
    const a = stack([part("web")], { "notes/1": { notes: ["web"] }, "bad/1": { notes: ["web"] }, "other/1": 1 });
    const b = stack([part("db")], { "notes/1": { notes: ["web"] }, "bad/1": { notes: 7 }, "other/1": 1 });
    const findings = findingsOf(joinStacks([fragment("a", a), fragment("b", b)], [notesJoiner(), notesJoiner("bad/1")]));
    expect(findings.map((finding) => `${finding.layer} ${finding.level} ${finding.code} ${finding.from.join("+")}`)).toEqual(["bad/1 error layer-form b", "notes/1 error layer-join a+b", "other/1 error layer-twice a+b"]);
    expect(findings[1]?.message).toBe('The fragments "a", "b" each have the note "web".');
  });

  it("gives each finding in one list: the names of the fragments, the parts, then the layers", () => {
    const a = stack([part("web")], { "other/1": 1 });
    const findings = findingsOf(joinStacks([fragment("a", a), fragment("a", a)], []));
    expect(findings.map((finding) => `${finding.layer} ${finding.code} ${finding.at}`)).toEqual(["stack/1 fragment-name a", "stack/1 part-twice web", "other/1 layer-twice "]);
    for (const finding of findings) expect(finding.level).toBe("error");
  });

  it("has the field layers only when a fragment has it", () => {
    expect("layers" in stackOf(joinStacks([fragment("a", stack([part("web")])), fragment("b", stack([part("db")]))], []))).toBe(false);
    expect(stackOf(joinStacks([fragment("a", stack([part("web")])), fragment("b", stack([part("db")], {}))], [])).layers).toEqual({});
  });

  it("lists the codes of the core, so a host can show each one", () => {
    expect(STACK_JOIN_CODES).toEqual(["fragment-name", "part-twice"]);
  });
});

/** Some different part ids and some fragments: each `id` gets the position of its fragment. */
const owned = fc.uniqueArray(fc.stringMatching(/^[a-z]{1,6}$/), { maxLength: 12 }).chain((ids) => fc.tuple(fc.constant(ids), fc.array(fc.nat({ max: 2 }), { minLength: ids.length, maxLength: ids.length })));

/** This function makes three fragments from the ids. Each fragment has a note for each of its parts. */
function threeFragments(ids: readonly string[], owners: readonly number[]): StackFragment[] {
  return ["a", "b", "c"].map((name, position) => {
    const mine = ids.filter((_, index) => owners[index] === position);
    return fragment(name, stack(mine.map((id) => part(id)), mine.length === 0 ? undefined : { "notes/1": { notes: mine } }));
  });
}

describe("the laws of joinStacks", () => {
  const joiners = [notesJoiner()];

  it("is associative: a join of joins gives the stack of one join", () => {
    fc.assert(
      fc.property(owned, ([ids, owners]) => {
        const [a, b, c] = threeFragments(ids, owners) as [StackFragment, StackFragment, StackFragment];
        const all = stackOf(joinStacks([a, b, c], joiners));
        const left = stackOf(joinStacks([fragment("ab", stackOf(joinStacks([a, b], joiners))), c], joiners));
        const right = stackOf(joinStacks([a, fragment("bc", stackOf(joinStacks([b, c], joiners)))], joiners));
        expect(left).toEqual(all);
        expect(right).toEqual(all);
      }),
    );
  });

  it("has the empty stack as its identity", () => {
    fc.assert(
      fc.property(owned, ([ids, owners]) => {
        const [a] = threeFragments(ids, owners) as [StackFragment, StackFragment, StackFragment];
        const empty = fragment("empty", stack([]));
        expect(stackOf(joinStacks([empty, a], joiners))).toEqual(a.stack);
        expect(stackOf(joinStacks([a, empty], joiners))).toEqual(a.stack);
      }),
    );
  });

  it("keeps each part and each note one time, and the add-on reads the joined layer", () => {
    fc.assert(
      fc.property(owned, ([ids, owners]) => {
        const fragments = threeFragments(ids, owners);
        const before = JSON.stringify(fragments);
        const joined = stackOf(joinStacks(fragments, joiners));
        expect(joined.parts.map((item) => item.id).sort()).toEqual([...ids].sort());
        expect(checkStackLayers(joined, joiners)).toEqual([]);
        // The join does not change a fragment.
        expect(JSON.stringify(fragments)).toBe(before);
      }),
    );
  });

  it("gives part-twice for each id that two fragments have, and no stack", () => {
    fc.assert(
      fc.property(owned, fc.nat({ max: 11 }), ([ids, owners], pick) => {
        fc.pre(ids.length > 0);
        const fragments = threeFragments(ids, owners);
        const id = ids[pick % ids.length] as string;
        const findings = findingsOf(joinStacks([...fragments, fragment("d", stack([part(id)]))], joiners));
        expect(findings.map((finding) => `${finding.code} ${finding.at}`)).toEqual([`part-twice ${id}`]);
      }),
    );
  });
});
