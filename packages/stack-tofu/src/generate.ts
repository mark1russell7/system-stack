import { checkStack, type Fault, type Stack } from "@mark1russell7/system-stack";
import { checkTofu, type TofuOptions } from "./check.ts";
import { resourceAddress, resourceName, type Provider, type Resource, type TofuLayer, type TofuObject, type TofuValue } from "./layer.ts";
import { dependsOn, firstResources } from "./queries.ts";
import { escapeTemplate, renderValue } from "./values.ts";

// The generator of the OpenTofu files. It writes the JSON syntax of OpenTofu, which a program can write with no fault of form.
// The files exist only for records that pass the gate.

/** The name of the file of a document. OpenTofu reads each file with the end `.tf.json` as its JSON syntax. */
export const DOCUMENT_FILE = "main.tf.json";

/** The comment at the start of each document. OpenTofu does not read it. */
export const DOCUMENT_COMMENT = "The generator of @mark1russell7/stack-tofu made this file from the records of a stack. Do not edit it: change the records, and generate it again.";

/** A document of OpenTofu in its JSON syntax, as data. `documentText` gives the text of its file. */
export type TofuDocument = TofuObject;

/**
 * The result of the generator: the document and the warnings, or the faults that stop it.
 * With `ok: false`, one fault or more is an error, and no document exists.
 */
export type Generated = { readonly ok: true; readonly document: TofuDocument; readonly faults: readonly Fault[] } | { readonly ok: false; readonly faults: readonly Fault[] };

/** This function compares two texts by their code units. The result does not change with the language of the computer. */
function byText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** This function gives an object from its entries. An entry with the key `__proto__` becomes a field, as each other entry. */
function objectOf(entries: readonly (readonly [string, TofuValue])[]): TofuObject {
  return Object.fromEntries(entries) as TofuObject;
}

/** This function gives the arguments of a record as OpenTofu reads them. */
function renderArguments(values: TofuObject | undefined): readonly (readonly [string, TofuValue])[] {
  return Object.entries(values ?? {}).map(([name, value]) => [name, renderValue(value)] as const);
}

/** This function gives the body of the block of a resource: a comment, the arguments, then the meta-arguments. */
function renderResource(resource: Resource, depends: readonly string[]): TofuObject {
  const ignore = [...new Set(resource.ignore ?? [])].sort(byText);
  const lifecycle: (readonly [string, TofuValue])[] = [];
  if (resource.keep === true) lifecycle.push(["prevent_destroy", true]);
  if (ignore.length > 0) lifecycle.push(["ignore_changes", ignore]);
  const entries: (readonly [string, TofuValue])[] = [["//", escapeTemplate(`The part "${resource.part}" of the stack.`)], ...renderArguments(resource.values)];
  if (resource.provider !== undefined) entries.push(["provider", resource.provider]);
  if (depends.length > 0) entries.push(["depends_on", depends]);
  if (lifecycle.length > 0) entries.push(["lifecycle", objectOf(lifecycle)]);
  return objectOf(entries);
}

/** This function gives the body of the block of a provider configuration: the alias, then the arguments. */
function renderProvider(provider: Provider): TofuObject {
  return objectOf([...(provider.alias === undefined ? [] : ([["alias", provider.alias]] as const)), ...renderArguments(provider.values)]);
}

/** This function groups items by a key. The keys are sorted, and the items of a key keep their sequence. */
function groups<T>(items: readonly T[], key: (item: T) => string): [string, T[]][] {
  const byKey = new Map<string, T[]>();
  for (const item of items) {
    const group = byKey.get(key(item)) ?? [];
    group.push(item);
    byKey.set(key(item), group);
  }
  return [...byKey].sort(([a], [b]) => byText(a, b));
}

/** This function gives the document of a layer that passed the gate. */
function render(layer: TofuLayer, stack: Stack): TofuDocument {
  const resources = [...firstResources(layer)].sort((a, b) => byText(resourceAddress(a), resourceAddress(b)));
  const providers = [...(layer.providers ?? [])].sort((a, b) => byText(a.name, b.name) || byText(a.alias ?? "", b.alias ?? ""));
  const variables = [...(layer.variables ?? [])].sort((a, b) => byText(a.name, b.name));
  const depends = dependsOn(layer, stack);
  const document: (readonly [string, TofuValue])[] = [["//", DOCUMENT_COMMENT]];

  const settings: (readonly [string, TofuValue])[] = [];
  if (layer.version !== undefined) settings.push(["required_version", layer.version]);
  const required = groups(providers, (provider) => provider.name).map(([name, [first]]) => {
    const source: (readonly [string, TofuValue])[] = first === undefined ? [] : [["source", first.source], ...(first.version === undefined ? [] : ([["version", first.version]] as const))];
    return [name, objectOf(source)] as const;
  });
  if (required.length > 0) settings.push(["required_providers", objectOf(required)]);
  if (layer.backend !== undefined) settings.push(["backend", objectOf([[layer.backend.type, objectOf(renderArguments(layer.backend.values))]])]);
  if (settings.length > 0) document.push(["terraform", objectOf(settings)]);

  if (variables.length > 0) {
    document.push([
      "variable",
      objectOf(
        variables.map((variable) => {
          const body: (readonly [string, TofuValue])[] = [["type", variable.type ?? "string"]];
          if (variable.description !== undefined) body.push(["description", escapeTemplate(variable.description)]);
          if (variable.sensitive === true) body.push(["sensitive", true]);
          return [variable.name, objectOf(body)] as const;
        }),
      ),
    ]);
  }

  if (providers.length > 0) {
    document.push(["provider", objectOf(groups(providers, (provider) => provider.name).map(([name, configurations]) => [name, configurations.map(renderProvider)] as const))]);
  }

  const imports = resources.filter((resource) => resource.import !== undefined);
  if (imports.length > 0) {
    document.push([
      "import",
      imports.map((resource) =>
        objectOf([["to", resourceAddress(resource)], ["id", escapeTemplate(resource.import ?? "")], ...(resource.provider === undefined ? [] : ([["provider", resource.provider]] as const))]),
      ),
    ]);
  }

  if (resources.length > 0) {
    document.push([
      "resource",
      objectOf(
        groups(resources, (resource) => resource.type).map(([type, ofType]) => {
          const blocks = ofType.map((resource) => [resourceName(resource), renderResource(resource, depends.get(resourceAddress(resource)) ?? [])] as const);
          return [type, objectOf(blocks)] as const;
        }),
      ),
    ]);
  }
  return objectOf(document);
}

/**
 * This function generates the OpenTofu document of a layer for a stack.
 *
 * - It starts with `checkStack` of the core and `checkTofu`. With one error or more, it gives the faults and no document.
 * - The document has a `resource` block for each resource, and the `provider`, `variable`, `import` and `terraform` blocks of the layer.
 * - `depends_on` of a resource comes from the needs of the stack, by `dependsOn`.
 * - A resource with `keep` gets `prevent_destroy`, so OpenTofu refuses a plan that destroys it.
 * - Each text of a record is literal in the document. A record cannot hold an expression of OpenTofu.
 *
 * The same records give the same document. The sequence of the records of the layer has no effect. The function is pure.
 */
export function generateTofu(layer: TofuLayer, stack: Stack, options: TofuOptions = {}): Generated {
  const faults: Fault[] = [...checkStack(stack), ...checkTofu(layer, stack, options)];
  if (faults.some((fault) => fault.level === "error")) return { ok: false, faults };
  return { ok: true, document: render(layer, stack), faults };
}

/** This function gives the text of the file of a document: JSON with an indent of 2 spaces, and a line end at its end. */
export function documentText(document: TofuDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
