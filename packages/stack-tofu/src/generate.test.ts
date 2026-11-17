import { SAMPLE_STACK, STACK_SCHEMA, type Need, type Part, type Stack } from "@mark1russell7/system-stack";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Budget } from "./cost.ts";
import { DOCUMENT_COMMENT, DOCUMENT_FILE, documentText, generateTofu, type TofuDocument } from "./generate.ts";
import { TOFU_SCHEMA, type Provider, type Resource, type TofuLayer, type TofuValue } from "./layer.ts";
import { SAMPLE_BUDGETS, SAMPLE_TOFU } from "./sample.ts";

const options = { seed: 20261116, numRuns: 200 };
const part = (id: string, ...needs: Need[]): Part => ({ id, kind: "part", needs });
const stack: Stack = { schema: STACK_SCHEMA, parts: [part("account"), part("host", "account"), part("program", "host")] };
const example: Provider = { name: "example", source: "example-org/example", part: "account" };
const server: Resource = { part: "host", type: "example_server", cost: 5 };
const budgets: readonly Budget[] = [{ part: "account", hardLimit: 10 }];
const layer = (more: Partial<TofuLayer> = {}): TofuLayer => ({ schema: TOFU_SCHEMA, providers: [example], resources: [server], ...more });

/** This function gives the document of a layer that passes the gate. A layer that does not pass stops the test. */
function documentOf(of: TofuLayer, on: Stack = stack, limits: readonly Budget[] = budgets): TofuDocument {
  const made = generateTofu(of, on, { budgets: limits });
  if (!made.ok) throw new Error(`The gate stops the layer: ${made.faults.map((fault) => fault.code).join(", ")}`);
  return made.document;
}

/** This function gives the value at a path of a document. */
function at(document: TofuValue, ...path: (string | number)[]): TofuValue | undefined {
  let value: TofuValue | undefined = document;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string | number, TofuValue>)[key];
  }
  return value;
}

/** The text that OpenTofu reads from a template with no live sequence, or `undefined` for a template with a live sequence. */
function literalOf(template: string): string | undefined {
  let text = "";
  let place = 0;
  while (place < template.length) {
    const three = template.slice(place, place + 3);
    const two = template.slice(place, place + 2);
    if (three === "$${" || three === "%%{") {
      text += three.slice(1);
      place += 3;
    } else if (two === "${" || two === "%{") {
      return undefined;
    } else {
      text += template[place] ?? "";
      place += 1;
    }
  }
  return text;
}

describe("the file of a document", () => {
  it("has a name that OpenTofu reads as its JSON syntax", () => {
    expect(DOCUMENT_FILE.endsWith(".tf.json")).toBe(true);
  });

  it("is JSON with an indent of 2 spaces and a line end at its end", () => {
    const text = documentText({ a: { b: [1] } });
    expect(text).toBe('{\n  "a": {\n    "b": [\n      1\n    ]\n  }\n}\n');
  });
});

describe("generateTofu", () => {
  it("gives the document of the smallest layer, with its keys in a fixed sequence", () => {
    const expected = {
      "//": DOCUMENT_COMMENT,
      terraform: { required_providers: { example: { source: "example-org/example" } } },
      provider: { example: [{}] },
      resource: { example_server: { host: { "//": 'The part "host" of the stack.' } } },
    };
    expect(documentText(documentOf(layer()))).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it("gives the document of the sample", () => {
    const made = generateTofu(SAMPLE_TOFU, SAMPLE_STACK, { budgets: SAMPLE_BUDGETS });
    const expected = {
      "//": DOCUMENT_COMMENT,
      terraform: { required_version: ">= 1.8", required_providers: { example: { source: "example-org/example", version: "~> 2.0" } } },
      variable: { example_token: { type: "string", description: "The token of the account of the cloud provider", sensitive: true } },
      provider: { example: [{ token: "${var.example_token}" }] },
      resource: {
        example_disk: { "cloud-host": { "//": 'The part "cloud-host" of the stack.', size_gb: 10, lifecycle: { prevent_destroy: true } } },
        example_firewall: { "cloud-host": { "//": 'The part "cloud-host" of the stack.', server: "${example_server.cloud-host.id}", ports: [22, 443] } },
        example_server: {
          "cloud-host": {
            "//": 'The part "cloud-host" of the stack.',
            name: "alerts",
            size: "small",
            disk: "${example_disk.cloud-host.id}",
            lifecycle: { prevent_destroy: true, ignore_changes: ["labels"] },
          },
        },
        terraform_data: {
          "program-cloud": {
            "//": 'The part "program-cloud" of the stack.',
            input: { release: "1.4.0" },
            depends_on: ["example_disk.cloud-host", "example_firewall.cloud-host", "example_server.cloud-host"],
          },
        },
      },
    };
    expect(made).toEqual({ ok: true, document: expected, faults: [] });
    expect(made.ok && documentText(made.document)).toBe(`${JSON.stringify(expected, null, 2)}\n`);
  });

  it("gives no document for a layer with an error", () => {
    for (const wrong of [layer({ resources: [{ part: "host", type: "example_server" }] }), layer({ resources: [{ ...server, cost: 11 }] }), layer({ resources: [{ ...server, values: { a: { $ref: "x" } } }] })]) {
      const made = generateTofu(wrong, stack, { budgets });
      expect(made.ok).toBe(false);
      expect(made).not.toHaveProperty("document");
      expect(made.faults.some((fault) => fault.level === "error")).toBe(true);
    }
  });

  it("gives no document without the budget of an account", () => {
    const made = generateTofu(layer(), stack);
    expect(made.ok).toBe(false);
    expect(made.faults.map((fault) => fault.code)).toEqual(["budget-none"]);
  });

  it("gives no document for a stack with an error", () => {
    const wrong: Stack = { schema: STACK_SCHEMA, parts: [...stack.parts, part("extra", "missing")] };
    const made = generateTofu(layer(), wrong, { budgets });
    expect(made.ok).toBe(false);
    expect(made.faults.map((fault) => fault.code)).toEqual(["need-part"]);
  });

  it("gives the document and the warnings for a layer with warnings only", () => {
    const made = generateTofu(layer({ variables: [{ name: "token" }] }), stack, { budgets });
    expect(made.ok).toBe(true);
    expect(made.faults.map((fault) => [fault.level, fault.code])).toEqual([["warning", "variable-unused"]]);
  });

  it("gives a document with no provider for a layer with only resources that are a part of OpenTofu", () => {
    const document = documentOf({ schema: TOFU_SCHEMA, resources: [{ part: "program", type: "terraform_data", values: { input: "a" } }] }, stack, []);
    expect(Object.keys(document)).toEqual(["//", "resource"]);
  });

  it("gives a document with only the comment for a layer with no record", () => {
    expect(documentOf({ schema: TOFU_SCHEMA, resources: [] }, stack, [])).toEqual({ "//": DOCUMENT_COMMENT });
  });
});

describe("the blocks of a document", () => {
  it("writes the settings: the versions, the providers and the backend", () => {
    const document = documentOf(layer({ version: ">= 1.8", backend: { type: "local", values: { path: "state/example.tfstate" } } }));
    expect(at(document, "terraform")).toEqual({
      required_version: ">= 1.8",
      required_providers: { example: { source: "example-org/example" } },
      backend: { local: { path: "state/example.tfstate" } },
    });
    expect(Object.keys(at(document, "terraform") ?? {})).toEqual(["required_version", "required_providers", "backend"]);
  });

  it("writes a backend with no value as an empty block", () => {
    expect(at(documentOf(layer({ backend: { type: "local" } })), "terraform", "backend")).toEqual({ local: {} });
  });

  it("writes each variable with its type, and the type string as the default", () => {
    const document = documentOf(
      layer({
        variables: [{ name: "token", sensitive: true }, { name: "count", type: "number", description: "The count of ${things}" }, { name: "flag", type: "bool", sensitive: false }],
        providers: [{ ...example, values: { token: { $var: "token" }, count: { $var: "count" }, flag: { $var: "flag" } } }],
      }),
    );
    expect(at(document, "variable")).toEqual({
      count: { type: "number", description: "The count of $${things}" },
      flag: { type: "bool" },
      token: { type: "string", sensitive: true },
    });
    expect(Object.keys(at(document, "variable") ?? {})).toEqual(["count", "flag", "token"]);
  });

  it("writes the configurations of a provider as a list, the one with no alias first", () => {
    const document = documentOf(
      layer({
        providers: [
          { ...example, alias: "west", values: { region: "west" } },
          { name: "another", source: "example-org/another", version: "1.2.3", part: "account" },
          { ...example, alias: "east", values: { region: "east" } },
          { ...example, values: { region: "main" } },
        ],
        resources: [server, { part: "host", type: "example_disk", provider: "example.west", cost: 1 }],
      }),
    );
    expect(at(document, "provider")).toEqual({
      another: [{}],
      example: [{ region: "main" }, { alias: "east", region: "east" }, { alias: "west", region: "west" }],
    });
    expect(Object.keys(at(document, "provider") ?? {})).toEqual(["another", "example"]);
    expect(at(document, "terraform", "required_providers")).toEqual({ another: { source: "example-org/another", version: "1.2.3" }, example: { source: "example-org/example" } });
    expect(at(document, "resource", "example_disk", "host", "provider")).toBe("example.west");
    expect(at(document, "resource", "example_server", "host", "provider")).toBeUndefined();
  });

  it("writes an import for each resource that names an object, sorted by the address", () => {
    const document = documentOf(
      layer({
        providers: [example, { ...example, alias: "west" }],
        resources: [
          { ...server, import: "servers/${7}" },
          { part: "host", type: "example_disk", provider: "example.west", cost: 1, import: "disk-1" },
          { part: "host", type: "example_firewall", cost: 0 },
        ],
      }),
    );
    expect(at(document, "import")).toEqual([
      { to: "example_disk.host", id: "disk-1", provider: "example.west" },
      { to: "example_server.host", id: "servers/$${7}" },
    ]);
    expect(Object.keys(document)).toEqual(["//", "terraform", "provider", "import", "resource"]);
  });

  it("writes the arguments in the sequence of the record, then the meta-arguments", () => {
    const stackOfTwo: Stack = { schema: STACK_SCHEMA, parts: [part("account"), part("disk", "account"), part("host", "disk")] };
    const document = documentOf(
      layer({
        providers: [example, { ...example, alias: "west" }],
        resources: [
          { ...server, provider: "example.west", values: { zeta: 1, alpha: 2 }, keep: true, ignore: ["tags", "labels", "tags"] },
          { part: "disk", type: "example_disk", cost: 1 },
        ],
      }),
      stackOfTwo,
    );
    const block = at(document, "resource", "example_server", "host");
    expect(block).toEqual({
      "//": 'The part "host" of the stack.',
      zeta: 1,
      alpha: 2,
      provider: "example.west",
      depends_on: ["example_disk.disk"],
      lifecycle: { prevent_destroy: true, ignore_changes: ["labels", "tags"] },
    });
    expect(Object.keys(block ?? {})).toEqual(["//", "zeta", "alpha", "provider", "depends_on", "lifecycle"]);
  });

  it("writes no lifecycle for a resource with keep false and no ignore", () => {
    expect(at(documentOf(layer({ resources: [{ ...server, keep: false, ignore: [] }] })), "resource", "example_server", "host")).toEqual({ "//": 'The part "host" of the stack.' });
  });

  it("writes the name of a resource from its field, or from the id of its part", () => {
    const names: Stack = { schema: STACK_SCHEMA, parts: [part("account"), part("9 lives/of a.cat", "account")] };
    const document = documentOf(layer({ resources: [{ ...server, part: "9 lives/of a.cat" }, { ...server, part: "9 lives/of a.cat", name: "web" }] }), names);
    expect(Object.keys(at(document, "resource", "example_server") ?? {})).toEqual(["_9_lives_of_a_cat", "web"]);
  });

  it("keeps a resource with the name __proto__ as a block", () => {
    const text = documentText(documentOf(layer({ resources: [{ ...server, name: "__proto__" }] })));
    expect(text).toContain('"__proto__": {');
    expect(JSON.parse(text)).toHaveProperty(["resource", "example_server"]);
  });

  it("gives JSON that reads back as the document", () => {
    const made = generateTofu(SAMPLE_TOFU, SAMPLE_STACK, { budgets: SAMPLE_BUDGETS });
    expect(made.ok && JSON.parse(documentText(made.document))).toEqual(made.ok && made.document);
  });
});

describe("the document, for each layer", () => {
  const rich: TofuLayer = {
    schema: TOFU_SCHEMA,
    version: ">= 1.8",
    backend: { type: "local", values: { path: "state/example.tfstate" } },
    providers: [
      { name: "example", source: "example-org/example", version: "~> 2.0", part: "cloud-account", values: { token: { $var: "example_token" } } },
      { name: "example", alias: "west", source: "example-org/example", version: "~> 2.0", part: "cloud-account", values: { token: { $var: "example_token" }, region: { $var: "region" } } },
      { name: "another", source: "example-org/another", part: "push-account", values: { key: { $var: "another_key" } } },
    ],
    variables: [{ name: "example_token", sensitive: true }, { name: "region" }, { name: "another_key", sensitive: true, description: "The key of the push service" }],
    resources: [
      ...SAMPLE_TOFU.resources,
      { part: "cloud-host", type: "example_address", provider: "example.west", cost: 1, import: "address-1" },
      { part: "push", type: "another_topic", cost: 0, values: { server: { $ref: "example_address.cloud-host.value" } }, import: "topic-1" },
      { part: "alert", type: "terraform_data", name: "check" },
    ],
  };
  const limits: readonly Budget[] = [...SAMPLE_BUDGETS, { part: "push-account", hardLimit: 0 }];
  const text = documentText(documentOf(rich, SAMPLE_STACK, limits));
  const sequence = <T>(items: readonly T[]): fc.Arbitrary<T[]> => fc.shuffledSubarray([...items], { minLength: items.length });

  it("does not change with the sequence of the records", () => {
    fc.assert(
      fc.property(sequence(rich.resources), sequence(rich.providers ?? []), sequence(rich.variables ?? []), (resources, providers, variables) => {
        // Two configurations of one provider keep their fields, so a different sequence gives no different source.
        expect(documentText(documentOf({ ...rich, resources, providers, variables }, SAMPLE_STACK, limits))).toBe(text);
      }),
      options,
    );
  });

  it("holds each text of a record as a literal text", () => {
    const sharp = fc.string({ unit: fc.constantFrom("$", "%", "{", "}", "~", "a", " ", '"', "\\"), maxLength: 12 });
    fc.assert(
      fc.property(sharp, sharp, sharp, sharp, (note, key, description, id) => {
        fc.pre(!key.startsWith("$") && id !== "");
        const document = documentOf(
          layer({
            variables: [{ name: "token", description }],
            resources: [{ ...server, values: { note, map: { [key]: [note] }, key: { $var: "token" } }, import: id }],
          }),
        );
        const block = at(document, "resource", "example_server", "host");
        expect(literalOf(String(at(block ?? null, "note")))).toBe(note);
        const map = at(block ?? null, "map") as Record<string, readonly string[]>;
        expect(Object.keys(map).map(literalOf)).toEqual([key]);
        expect(literalOf(Object.values(map)[0]?.[0] ?? "")).toBe(note);
        expect(literalOf(String(at(document, "variable", "token", "description")))).toBe(description);
        expect(literalOf(String(at(document, "import", 0, "id")))).toBe(id);
        expect(at(block ?? null, "key")).toBe("${var.token}");
      }),
      options,
    );
  });
});
