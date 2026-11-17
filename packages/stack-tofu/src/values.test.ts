import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TofuValue } from "./layer.ts";
import { escapeTemplate, isForm, NAME_FORM, PATH_FORM, pathText, PROVIDER_FORM, refOf, refParts, renderValue, SOURCE_FORM, TYPE_FORM, valueUses, varOf, VERSION_FORM } from "./values.ts";

const options = { seed: 20261116, numRuns: 300 };

/**
 * The text that OpenTofu reads from a template with no live sequence: each escape gives its sequence back.
 * A template with a live interpolation or a live directive gives `undefined`.
 * It follows the scanner of the template language: a `$` or a `%` before a `{` starts a sequence, and the doubled sign before a `{` is the escape.
 */
function literalOf(template: string): string | undefined {
  let text = "";
  let at = 0;
  while (at < template.length) {
    const three = template.slice(at, at + 3);
    const two = template.slice(at, at + 2);
    if (three === "$${" || three === "%%{") {
      text += three.slice(1);
      at += 3;
    } else if (two === "${" || two === "%{") {
      return undefined;
    } else {
      text += template[at] ?? "";
      at += 1;
    }
  }
  return text;
}

/** The value that OpenTofu reads from a rendered value with no live sequence. A live sequence at any depth gives `undefined`. */
function readBack(value: TofuValue): { readonly value: TofuValue } | undefined {
  if (typeof value === "string") {
    const text = literalOf(value);
    return text === undefined ? undefined : { value: text };
  }
  if (Array.isArray(value)) {
    const items: TofuValue[] = [];
    for (const item of value as readonly TofuValue[]) {
      const read = readBack(item);
      if (read === undefined) return undefined;
      items.push(read.value);
    }
    return { value: items };
  }
  if (typeof value === "object" && value !== null) {
    const entries: [string, TofuValue][] = [];
    for (const [key, item] of Object.entries(value)) {
      const name = literalOf(key);
      const read = readBack(item);
      if (name === undefined || read === undefined) return undefined;
      entries.push([name, read.value]);
    }
    return { value: Object.fromEntries(entries) };
  }
  return { value };
}

// A text with many signs of the template language, so the escapes meet each other.
const sharp = fc.string({ unit: fc.constantFrom("$", "%", "{", "}", "~", "a", " ", '"', "\\"), maxLength: 12 });
const key = sharp.filter((text) => !text.startsWith("$"));
const literal: fc.Arbitrary<TofuValue> = fc.letrec<{ value: TofuValue }>((tie) => ({
  value: fc.oneof(
    { depthSize: "small" },
    sharp,
    fc.integer(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie("value"), { maxLength: 3 }),
    fc.dictionary(key, tie("value"), { maxKeys: 3 }),
  ),
})).value;

describe("escapeTemplate", () => {
  it("escapes an interpolation and a directive", () => {
    expect(escapeTemplate("a ${b} c")).toBe("a $${b} c");
    expect(escapeTemplate("%{ if x }y%{ endif }")).toBe("%%{ if x }y%%{ endif }");
  });

  it("does not change a text with no sequence", () => {
    for (const text of ["", "plain", "100%", "$5", "{a}", "$ {a}", "% {a}", "a$", "a%"]) expect(escapeTemplate(text)).toBe(text);
  });

  it("keeps a text that has the form of an escape", () => {
    expect(literalOf(escapeTemplate("$${a}"))).toBe("$${a}");
    expect(literalOf(escapeTemplate("%%{a}"))).toBe("%%{a}");
    expect(literalOf(escapeTemplate("$$${a}"))).toBe("$$${a}");
  });

  it("gives a template with no live sequence, and OpenTofu reads the text of the record", () => {
    fc.assert(
      fc.property(sharp, (text) => {
        expect(literalOf(escapeTemplate(text))).toBe(text);
      }),
      options,
    );
  });
});

describe("the forms", () => {
  it("accepts the type of a resource", () => {
    for (const type of ["example_server", "terraform_data", "a", "a1_b2"]) expect(TYPE_FORM.test(type)).toBe(true);
    for (const type of ["", "Example", "1a", "a-b", "a.b", "a b", "_a", "a${b}"]) expect(TYPE_FORM.test(type)).toBe(false);
  });

  it("accepts the local name of a provider", () => {
    for (const name of ["example", "example-beta", "a_b"]) expect(PROVIDER_FORM.test(name)).toBe(true);
    for (const name of ["", "Example", "-a", "a.b", "a/b"]) expect(PROVIDER_FORM.test(name)).toBe(false);
  });

  it("accepts a name", () => {
    for (const name of ["web", "cloud-host", "_a", "A1", "a_b-c"]) expect(NAME_FORM.test(name)).toBe(true);
    for (const name of ["", "1a", "-a", "a.b", "a b", "a[0]", "//", "a${b}"]) expect(NAME_FORM.test(name)).toBe(false);
  });

  it("accepts a path of attributes", () => {
    for (const path of ["id", "network[0].address", "a.b.c", "a[0][1]", "a-b.c_d"]) expect(PATH_FORM.test(path)).toBe(true);
    for (const path of ["", ".a", "a.", "a..b", "a[]", "a[x]", "a[0", "a[*]", "a b", "a,b", "a}"]) expect(PATH_FORM.test(path)).toBe(false);
  });

  it("accepts the source of a provider", () => {
    for (const source of ["example-org/example", "registry.example.com/example-org/example"]) expect(SOURCE_FORM.test(source)).toBe(true);
    for (const source of ["", "example", "/example", "example-org/", "a/b/c/d", "Example/x", "a/${b}"]) expect(SOURCE_FORM.test(source)).toBe(false);
  });

  it("accepts a list of versions", () => {
    for (const version of [">= 1.8", "~> 2.0", ">= 1.8, < 2.0", "1.2.3", "!= 1.4.0", "1.9.0-rc1"]) expect(VERSION_FORM.test(version)).toBe(true);
    for (const version of ["", "${a}", "%{a}", "1.0\n2.0", '"1.0"']) expect(VERSION_FORM.test(version)).toBe(false);
  });
});

describe("refParts", () => {
  it("gives the address and the path of attributes", () => {
    expect(refParts("example_server.web.id")).toEqual({ address: "example_server.web", attribute: "id" });
    expect(refParts("example_server.cloud-host.network[0].address")).toEqual({ address: "example_server.cloud-host", attribute: "network[0].address" });
  });

  it("refuses a text with a different form", () => {
    for (const text of ["", "web", "example_server.web", "example_server.web.", "Example.web.id", "example_server.web[0].id", "var.token.x y", "a.b.c}", "a.b.${c}", "a.b.c + 1", "a.b.c)"]) {
      expect(refParts(text)).toBeUndefined();
    }
  });
});

describe("refOf and varOf", () => {
  it("reads a correct form", () => {
    expect(refOf({ $ref: "example_server.web.id" })).toBe("example_server.web.id");
    expect(varOf({ $var: "token" })).toBe("token");
  });

  it("refuses a form with a second key, a different type or a wrong text", () => {
    expect(refOf({ $ref: "example_server.web.id", more: 1 })).toBeUndefined();
    expect(refOf({ $ref: 5 })).toBeUndefined();
    expect(refOf({ $ref: "web" })).toBeUndefined();
    expect(refOf({ $var: "token" })).toBeUndefined();
    expect(varOf({ $var: "a.b" })).toBeUndefined();
    expect(varOf({ $var: "token", $ref: "a.b.c" })).toBeUndefined();
    expect(varOf({ $ref: "a.b.c" })).toBeUndefined();
  });

  it("tells that an object with a key that starts with a dollar sign is a form", () => {
    expect(isForm({ $ref: "a.b.c" })).toBe(true);
    expect(isForm({ $other: 1 })).toBe(true);
    expect(isForm({ a: 1, $b: 2 })).toBe(true);
    expect(isForm({ a$: 1 })).toBe(false);
    expect(isForm({})).toBe(false);
  });
});

describe("renderValue", () => {
  it("gives the expression of a reference and of a variable", () => {
    expect(renderValue({ $ref: "example_server.web.id" })).toBe("${example_server.web.id}");
    expect(renderValue({ $var: "token" })).toBe("${var.token}");
  });

  it("keeps a number, a boolean and null", () => {
    expect(renderValue(5)).toBe(5);
    expect(renderValue(false)).toBe(false);
    expect(renderValue(null)).toBeNull();
  });

  it("escapes each text and each key, at each depth", () => {
    expect(renderValue({ a: ["${x}", { "%{y}": "${z}" }], b: { $ref: "t.n.a" } })).toEqual({ a: ["$${x}", { "%%{y}": "$${z}" }], b: "${t.n.a}" });
  });

  it("does not make an expression from a form that is not correct", () => {
    expect(renderValue({ $ref: "file(x)" })).toEqual({ $ref: "file(x)" });
    expect(renderValue({ $ref: "a.b.c", more: "${x}" })).toEqual({ $ref: "a.b.c", more: "$${x}" });
    expect(renderValue({ $var: "a}${b" })).toEqual({ $var: "a}$${b" });
  });

  it("keeps a key with the name __proto__ as a field", () => {
    const value = JSON.parse('{"__proto__": "${x}"}') as TofuValue;
    expect(JSON.stringify(renderValue(value))).toBe('{"__proto__":"$${x}"}');
  });

  it("gives no live sequence for a value with no form, and OpenTofu reads the value of the record", () => {
    fc.assert(
      fc.property(literal, (value) => {
        expect(readBack(renderValue(value))).toEqual({ value });
      }),
      options,
    );
  });
});

describe("valueUses", () => {
  it("gives each form with its place", () => {
    const value: TofuValue = { a: { $ref: "t.n.id" }, b: [{ $var: "token" }, { c: { $bad: 1 } }], d: "${x}" };
    expect(valueUses(value).forms).toEqual([
      { kind: "ref", path: ["a"], text: "t.n.id" },
      { kind: "var", path: ["b", 0], text: "token" },
      { kind: "bad", path: ["b", 1, "c"] },
    ]);
  });

  it("gives each number that is not finite, with its place", () => {
    expect(valueUses({ a: [1, Number.NaN], b: { c: Number.POSITIVE_INFINITY }, d: 0 }).numbers).toEqual([
      { path: ["a", 1], value: Number.NaN },
      { path: ["b", "c"], value: Number.POSITIVE_INFINITY },
    ]);
  });

  it("does not read the inside of a form", () => {
    expect(valueUses({ $ref: "t.n.id", more: { $var: "x" } })).toEqual({ forms: [{ kind: "bad", path: [] }], numbers: [] });
  });

  it("gives the place of a value as a text", () => {
    expect(pathText([])).toBe("(the value)");
    expect(pathText(["disk", 0, "size"])).toBe("disk.0.size");
  });
});
