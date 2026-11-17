import { partsById, type Fault, type FaultLevel, type Stack } from "@mark1russell7/system-stack";
import { accountStates, isZeroOrMore, type Budget } from "./cost.ts";
import { BUILTIN_PROVIDER, isBuiltin, providerAddress, resourceAddress, resourceName, resourceProvider, typeProvider, type Provider, type TofuLayer, type TofuObject } from "./layer.ts";
import { firstResources, neededParts, resourceCycles } from "./queries.ts";
import { isForm, NAME_FORM, PATH_FORM, pathText, PROVIDER_FORM, refParts, SOURCE_FORM, TYPE_FORM, valueUses, VERSION_FORM } from "./values.ts";

// The gate of the OpenTofu layer. A gate that passes tells that the files are safe to write:
// each record has a correct form, no resource waits in a cycle, and the planned cost of each account is known and not more than its hard limit.

/** These are the codes of the faults of an OpenTofu layer. */
export const TOFU_CODES: readonly [
  "version",
  "backend",
  "variable-form",
  "variable-duplicate",
  "provider-form",
  "provider-duplicate",
  "provider-source",
  "provider-part",
  "provider-value",
  "resource-form",
  "resource-duplicate",
  "resource-part",
  "provider-none",
  "ignore-form",
  "value-name",
  "value-meta",
  "value-form",
  "value-number",
  "ref-none",
  "var-none",
  "cycle",
  "cost-amount",
  "cost-none",
  "cost-builtin",
  "budget-duplicate",
  "budget-amount",
  "budget-none",
  "limit-none",
  "cost-over",
  "provider-need",
  "variable-unused",
] = [
  "version",
  "backend",
  "variable-form",
  "variable-duplicate",
  "provider-form",
  "provider-duplicate",
  "provider-source",
  "provider-part",
  "provider-value",
  "resource-form",
  "resource-duplicate",
  "resource-part",
  "provider-none",
  "ignore-form",
  "value-name",
  "value-meta",
  "value-form",
  "value-number",
  "ref-none",
  "var-none",
  "cycle",
  "cost-amount",
  "cost-none",
  "cost-builtin",
  "budget-duplicate",
  "budget-amount",
  "budget-none",
  "limit-none",
  "cost-over",
  "provider-need",
  "variable-unused",
];

/** A code of a fault of an OpenTofu layer. */
export type TofuCode = (typeof TOFU_CODES)[number];

/**
 * A fault of an OpenTofu layer. Its field `at` is the place of the fault in the files.
 *
 * - For a resource, `at` is its address.
 * - For a provider configuration, `at` is `provider.` and its address.
 * - For a variable, `at` is `var.` and its name.
 * - For the settings, `at` is `terraform`.
 *
 * For a fault of a budget or of an account, `at` is the `id` of the part.
 */
export interface TofuFault extends Fault {
  readonly code: TofuCode;
  /** The `id` of the part of the stack of the record with the fault. */
  readonly part?: string | undefined;
}

/** The options of the gate and of the generator. */
export interface TofuOptions {
  /**
   * The limit of the cost of each account for a month. The states of a spend layer have this form.
   * An account with resources and no budget stops the gate: the gate has no read of its limit.
   */
  readonly budgets?: readonly Budget[] | undefined;
  /** The currency of the costs and of the budgets, for the text of a fault. */
  readonly currency?: string | undefined;
}

/** These arguments of a resource are meta-arguments. The generator writes them from the records, so the arguments of a record cannot have them. */
export const RESOURCE_META: readonly string[] = ["provider", "depends_on", "lifecycle", "count", "for_each", "provisioner", "connection", "dynamic"];

/** These arguments of a provider configuration are meta-arguments. The generator writes them from the records. */
export const PROVIDER_META: readonly string[] = ["alias", "version", "for_each"];

/** This function gives a list of names for a message, for example `"a", "b"`. */
function names(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(", ");
}

/**
 * This function gives each fault of an OpenTofu layer for a stack. A list with no error tells that the gate passes.
 *
 * The settings, the variables and the providers, as errors:
 * - `version`: the versions of OpenTofu do not have the form of a list of versions.
 * - `backend`: the type of the backend does not have the form of a type, or a value of the backend is not literal.
 * - `variable-form`: the name of a variable does not have the form of a name.
 * - `variable-duplicate`: two variables have one name.
 * - `provider-form`: the name, the alias, the source or the versions of a provider configuration do not have their form.
 * - `provider-duplicate`: two provider configurations have one address.
 * - `provider-source`: two configurations of one provider have different sources or versions.
 * - `provider-part`: a provider configuration names no part of the stack.
 * - `provider-value`: a value of a provider configuration reads a resource.
 *
 * The resources, as errors:
 * - `resource-form`: the type, the name or the import id of a resource does not have its form.
 * - `resource-duplicate`: two resources have one address.
 * - `resource-part`: a resource names no part of the stack.
 * - `provider-none`: the layer does not have the provider configuration of a resource.
 * - `ignore-form`: an attribute of `ignore` does not have the form of a path.
 *
 * The values, as errors:
 * - `value-name`: the name of an argument does not have the form of a name.
 * - `value-meta`: an argument is a meta-argument. The generator writes each meta-argument.
 * - `value-form`: an object has a key that starts with `$`, and it is not a correct reference or variable.
 * - `value-number`: a number is not finite. JSON cannot hold it.
 * - `ref-none`: a reference names a resource that the layer does not have.
 * - `var-none`: a value names a variable that the layer does not have.
 *
 * The queries, as errors:
 * - `cycle`: resources wait for each other, so OpenTofu can make none of them.
 *
 * The costs, as errors:
 * - `cost-amount`: the planned cost of a resource is less than 0 or not finite.
 * - `cost-none`: a resource of a provider has no planned cost. A cost that is not known is not 0.
 * - `cost-builtin`: a resource that is a part of OpenTofu has a planned cost above 0. It counts against no account.
 * - `budget-duplicate`: two budgets name one part.
 * - `budget-amount`: the hard limit of a budget is less than 0 or not finite.
 * - `budget-none`: no budget names an account with resources. The gate has no read of its limit, so it does not pass.
 * - `limit-none`: the resources of an account have a planned cost above 0, and the account has no hard limit.
 * - `cost-over`: the planned cost of an account is more than its hard limit.
 *
 * The warnings:
 * - `provider-need`: the part of a resource does not need the part of its provider configuration. The stack does not show that dependence.
 * - `variable-unused`: no value reads a variable.
 *
 * The gate does not examine the stack: `checkStack` of the core does. The function is pure.
 */
export function checkTofu(layer: TofuLayer, stack: Stack, options: TofuOptions = {}): TofuFault[] {
  const faults: TofuFault[] = [];
  const add = (level: FaultLevel, code: TofuCode, at: string, message: string, more: { readonly other?: string; readonly part?: string } = {}): void => {
    faults.push({ level, code, at, message, ...more });
  };
  const error = (code: TofuCode, at: string, message: string, more: { readonly other?: string; readonly part?: string } = {}): void => {
    add("error", code, at, message, more);
  };
  const money = (amount: number): string => (options.currency === undefined ? String(amount) : `${String(amount)} ${options.currency}`);
  const parts = partsById(stack);
  const addresses = new Set(firstResources(layer).map(resourceAddress));

  const variables = new Set<string>();
  const readVariables = new Set<string>();
  for (const variable of layer.variables ?? []) {
    const at = `var.${variable.name}`;
    if (variables.has(variable.name)) {
      error("variable-duplicate", at, `Two variables have the name "${variable.name}".`);
      continue;
    }
    variables.add(variable.name);
    if (!NAME_FORM.test(variable.name)) error("variable-form", at, `The name "${variable.name}" of a variable does not have the form of a name.`);
  }

  /** This function examines the arguments of one record. `owner` is the record in words, for a message. */
  const checkValues = (values: TofuObject | undefined, at: string, owner: string, kind: "resource" | "provider" | "backend", meta: readonly string[], part?: string): void => {
    if (values === undefined) return;
    const more = part === undefined ? {} : { part };
    if (isForm(values)) {
      error("value-form", at, `The arguments of ${owner} have a key that starts with "$". The arguments of a record are not a reference and not a variable.`, more);
      return;
    }
    for (const name of Object.keys(values)) {
      if (meta.includes(name)) error("value-meta", at, `The argument "${name}" of ${owner} is a meta-argument. The generator writes it from the records.`, more);
      else if (!NAME_FORM.test(name)) error("value-name", at, `The name "${name}" of an argument of ${owner} does not have the form of a name.`, more);
    }
    const uses = valueUses(values);
    for (const number of uses.numbers) error("value-number", at, `The number ${String(number.value)} at "${pathText(number.path)}" of ${owner} is not finite.`, more);
    for (const form of uses.forms) {
      const place = pathText(form.path);
      if (form.kind === "bad" || form.text === undefined) {
        error("value-form", at, `The object at "${place}" of ${owner} has a key that starts with "$", and it is not a correct reference or variable.`, more);
      } else if (kind === "backend") {
        error("backend", at, `The value at "${place}" of ${owner} is not literal. A backend reads no variable and no resource.`, more);
      } else if (form.kind === "var") {
        if (variables.has(form.text)) readVariables.add(form.text);
        else error("var-none", at, `The value at "${place}" of ${owner} names the variable "${form.text}", which the layer does not have.`, { ...more, other: `var.${form.text}` });
      } else if (kind === "provider") {
        error("provider-value", at, `The value at "${place}" of ${owner} reads the resource attribute "${form.text}". A provider configuration reads no resource.`, more);
      } else {
        const address = refParts(form.text)?.address ?? "";
        if (!addresses.has(address)) error("ref-none", at, `The value at "${place}" of ${owner} reads "${form.text}", and the layer has no resource "${address}".`, { ...more, other: address });
      }
    }
  };

  if (layer.version !== undefined && !VERSION_FORM.test(layer.version)) {
    error("version", "terraform", `The versions "${layer.version}" of OpenTofu do not have the form of a list of versions, for example ">= 1.8".`);
  }
  if (layer.backend !== undefined) {
    if (!TYPE_FORM.test(layer.backend.type)) error("backend", "terraform", `The type "${layer.backend.type}" of the backend does not have the form of a type.`);
    checkValues(layer.backend.values, "terraform", "the backend", "backend", []);
  }

  const providers = new Set<string>();
  const firstOfName = new Map<string, Provider>();
  for (const provider of layer.providers ?? []) {
    const address = providerAddress(provider);
    const at = `provider.${address}`;
    const more = { part: provider.part };
    if (providers.has(address)) {
      error("provider-duplicate", at, `Two provider configurations have the address "${address}".`, more);
      continue;
    }
    providers.add(address);
    if (!PROVIDER_FORM.test(provider.name)) error("provider-form", at, `The name "${provider.name}" of a provider does not have the form of a provider name.`, more);
    else if (provider.name === BUILTIN_PROVIDER) error("provider-form", at, `The provider "${BUILTIN_PROVIDER}" is a part of OpenTofu. It has no configuration.`, more);
    if (provider.alias !== undefined && !NAME_FORM.test(provider.alias)) error("provider-form", at, `The alias "${provider.alias}" of the provider "${provider.name}" does not have the form of a name.`, more);
    if (!SOURCE_FORM.test(provider.source)) error("provider-form", at, `The source "${provider.source}" of the provider "${provider.name}" does not have the form of a source, for example "example-org/example".`, more);
    if (provider.version !== undefined && !VERSION_FORM.test(provider.version)) {
      error("provider-form", at, `The versions "${provider.version}" of the provider "${provider.name}" do not have the form of a list of versions, for example "~> 2.0".`, more);
    }
    const first = firstOfName.get(provider.name);
    if (first === undefined) firstOfName.set(provider.name, provider);
    else if (first.source !== provider.source || first.version !== provider.version) {
      error("provider-source", at, `Two configurations of the provider "${provider.name}" have different sources or versions. A provider has one source and one list of versions.`, more);
    }
    if (!parts.has(provider.part)) error("provider-part", at, `The provider configuration "${address}" names "${provider.part}", which is no part of the stack.`, { ...more, other: provider.part });
    checkValues(provider.values, at, `the provider configuration "${address}"`, "provider", PROVIDER_META, provider.part);
  }

  const seen = new Set<string>();
  for (const resource of layer.resources) {
    const at = resourceAddress(resource);
    const more = { part: resource.part };
    if (seen.has(at)) {
      error("resource-duplicate", at, `Two resources have the address "${at}".`, more);
      continue;
    }
    seen.add(at);
    if (!TYPE_FORM.test(resource.type)) error("resource-form", at, `The type "${resource.type}" of a resource of "${resource.part}" does not have the form of a type.`, more);
    if (!NAME_FORM.test(resourceName(resource))) error("resource-form", at, `The name "${resourceName(resource)}" of a resource of "${resource.part}" does not have the form of a name.`, more);
    if (resource.import === "") error("resource-form", at, `The import id of the resource "${at}" is empty.`, more);
    if (!parts.has(resource.part)) error("resource-part", at, `The resource "${at}" names "${resource.part}", which is no part of the stack.`, { ...more, other: resource.part });
    for (const path of resource.ignore ?? []) {
      if (!PATH_FORM.test(path)) error("ignore-form", at, `The attribute "${path}" of the field "ignore" of the resource "${at}" does not have the form of a path.`, more);
    }
    checkValues(resource.values, at, `the resource "${at}"`, "resource", RESOURCE_META, resource.part);

    const builtin = isBuiltin(resource);
    const provider = builtin ? undefined : resourceProvider(layer, resource);
    if (!builtin && provider === undefined) {
      const wanted = resource.provider ?? typeProvider(resource.type);
      error("provider-none", at, `The resource "${at}" uses the provider configuration "${wanted}", which the layer does not have.`, more);
    }
    if (resource.cost !== undefined && !isZeroOrMore(resource.cost)) {
      error("cost-amount", at, `The planned cost ${String(resource.cost)} of the resource "${at}" is less than 0 or not finite.`, more);
    } else if (builtin) {
      if (resource.cost !== undefined && resource.cost > 0) {
        error("cost-builtin", at, `The resource "${at}" is a part of OpenTofu, and its record has a planned cost of ${money(resource.cost)}. It counts against no account.`, more);
      }
    } else if (resource.cost === undefined) {
      error("cost-none", at, `The resource "${at}" has no planned cost. A cost that is not known is not 0: give the cost of a month, or 0 for a resource with no price.`, more);
    }
    if (provider !== undefined && provider.part !== resource.part && parts.has(resource.part) && parts.has(provider.part) && !neededParts(stack, resource.part).has(provider.part)) {
      add(
        "warning",
        "provider-need",
        at,
        `The resource "${at}" makes the part "${resource.part}" with the provider configuration of "${provider.part}", and "${resource.part}" does not need "${provider.part}" in the stack.`,
        { ...more, other: provider.part },
      );
    }
  }

  for (const cycle of resourceCycles(layer, stack)) {
    const [first = "", second] = cycle;
    const message = cycle.length === 1 ? `The resource "${first}" reads its own attribute, so OpenTofu cannot make it.` : `The resources ${names(cycle)} wait for each other, so OpenTofu can make none of them.`;
    error("cycle", first, message, second === undefined ? {} : { other: second });
  }

  const budgets = options.budgets ?? [];
  const budgetParts = new Set<string>();
  const wrongBudgets = new Set<string>();
  for (const budget of budgets) {
    if (budgetParts.has(budget.part)) {
      error("budget-duplicate", budget.part, `Two budgets name the part "${budget.part}".`, { part: budget.part });
      continue;
    }
    budgetParts.add(budget.part);
    if (budget.hardLimit !== undefined && !isZeroOrMore(budget.hardLimit)) {
      wrongBudgets.add(budget.part);
      error("budget-amount", budget.part, `The hard limit ${String(budget.hardLimit)} of the budget of "${budget.part}" is less than 0 or not finite.`, { part: budget.part });
    }
  }
  for (const state of accountStates(layer, budgets)) {
    const at = state.part;
    const more = { part: at };
    if (!budgetParts.has(at)) {
      error("budget-none", at, `The resources ${names(state.resources)} count against "${at}", and no budget names "${at}". The gate has no read of its limit.`, more);
    } else if (state.limit === undefined) {
      // A hard limit with a wrong amount has its own fault.
      if (state.planned > 0 && !wrongBudgets.has(at)) error("limit-none", at, `The planned cost of the resources of "${at}" is ${money(state.planned)} for a month, and "${at}" has no hard limit.`, more);
    } else if (state.over === true) {
      error("cost-over", at, `The planned cost of the resources of "${at}" is ${money(state.planned)} for a month. Its hard limit is ${money(state.limit)}.`, more);
    }
  }

  for (const name of variables) {
    if (!readVariables.has(name)) add("warning", "variable-unused", `var.${name}`, `No value reads the variable "${name}".`);
  }
  return faults;
}
