// The records of the OpenTofu add-on. They are one layer of a stack, with the key `tofu/1` in `Stack.layers`.
// Each record tells how a part of the stack becomes a resource of OpenTofu.
// The add-on knows no provider: the type of a resource and its arguments are data.

/** The name of the format of an OpenTofu layer. It is the key of the layer in `Stack.layers`. */
export const TOFU_SCHEMA = "tofu/1";

/**
 * A value of an argument, as JSON.
 *
 * - A text is literal. The generator escapes each template sequence, so a text of a record is not an expression.
 * - `{ "$ref": "type.name.attribute" }` is an attribute of a resource of the layer.
 * - `{ "$var": "name" }` is the value of a variable of the layer.
 *
 * A key that starts with `$` has no other use.
 */
export type TofuValue = string | number | boolean | null | readonly TofuValue[] | TofuObject;

/** An object of values. Its keys are the names of arguments, or the keys of a map. */
export interface TofuObject {
  readonly [key: string]: TofuValue;
}

/**
 * A configuration of a provider. It acts for one part of the stack: an account, a project or a tenant.
 * The cost of each resource of the configuration counts against the limit of that part.
 */
export interface Provider {
  /** The local name of the provider, for example `example`. It is the first word of the types of its resources. */
  readonly name: string;
  /** The address of the provider in a registry, for example `example-org/example`. */
  readonly source: string;
  /** The versions of the provider that the files accept, for example `~> 2.0`. */
  readonly version?: string | undefined;
  /** The alias of the configuration. One provider can have one configuration with no alias, and others with an alias each. */
  readonly alias?: string | undefined;
  /** The `id` of the part of the stack that pays for the resources of the configuration. */
  readonly part: string;
  /** The arguments of the configuration. */
  readonly values?: TofuObject | undefined;
}

/** These are the types of a variable. */
export const VARIABLE_TYPES: readonly ["string", "number", "bool"] = ["string", "number", "bool"];

/** A type of a variable. */
export type VariableType = (typeof VARIABLE_TYPES)[number];

/**
 * A variable of the files. A person or a program gives its value when OpenTofu runs.
 * A secret is a variable, so no record holds its value. A variable has no default for that reason.
 */
export interface Variable {
  readonly name: string;
  /** The type of the variable. The default is `string`. */
  readonly type?: VariableType | undefined;
  /** `true`: OpenTofu does not show the value. */
  readonly sensitive?: boolean | undefined;
  readonly description?: string | undefined;
}

/** The place where OpenTofu keeps its state. Each value is literal: a backend reads no variable and no resource. */
export interface Backend {
  /** The type of the backend, for example `local`. */
  readonly type: string;
  readonly values?: TofuObject | undefined;
}

/** A resource of OpenTofu that makes a part of the stack, or a piece of it. */
export interface Resource {
  /** The `id` of the part of the stack that the resource makes. One part can have two resources or more. */
  readonly part: string;
  /** The type of the resource, for example `example_server`. */
  readonly type: string;
  /** The name of the resource in the files. The default comes from the `id` of the part. */
  readonly name?: string | undefined;
  /**
   * The provider configuration of the resource: a name, or a name, a point and an alias.
   * The default is the configuration with no alias whose name is the first word of the type.
   */
  readonly provider?: string | undefined;
  /** The arguments of the resource. A meta-argument is not an argument: the generator writes each one. */
  readonly values?: TofuObject | undefined;
  /**
   * The planned cost of the resource in a month, in the currency of the budgets.
   * It is the standing price of the resource. The cost that grows with the use is not in it.
   */
  readonly cost?: number | undefined;
  /** `true`: the resource holds data or a name that must stay. The files stop a plan that destroys it. */
  readonly keep?: boolean | undefined;
  /** The attributes whose changes outside the files are permitted, for example `labels`. */
  readonly ignore?: readonly string[] | undefined;
  /** The id of an object that exists at the provider. The files import the object as this resource. */
  readonly import?: string | undefined;
}

/** An OpenTofu layer: the resources of the parts of a stack, with their providers. */
export interface TofuLayer {
  readonly schema: typeof TOFU_SCHEMA;
  /** The versions of OpenTofu that the files accept, for example `>= 1.8`. */
  readonly version?: string | undefined;
  readonly backend?: Backend | undefined;
  readonly providers?: readonly Provider[] | undefined;
  readonly variables?: readonly Variable[] | undefined;
  readonly resources: readonly Resource[];
}

/**
 * The first word of the types of the resources that are a part of OpenTofu, for example `terraform_data`.
 * Such a resource has no provider configuration, no account and no cost.
 */
export const BUILTIN_PROVIDER = "terraform";

/**
 * This function gives the name of a resource in the files: its field `name`, or a name from the `id` of its part.
 * In a name from an `id`, `_` replaces each character that a name cannot have, and a name does not start with a digit.
 */
export function resourceName(resource: Resource): string {
  if (resource.name !== undefined) return resource.name;
  const name = resource.part.replace(/[^A-Za-z0-9_-]/g, "_");
  return /^[A-Za-z_]/.test(name) ? name : `_${name}`;
}

/** This function gives the address of a resource in the files: its type, a point and its name. */
export function resourceAddress(resource: Resource): string {
  return `${resource.type}.${resourceName(resource)}`;
}

/** This function gives the address of a provider configuration: its name, or its name, a point and its alias. */
export function providerAddress(provider: Provider): string {
  return provider.alias === undefined ? provider.name : `${provider.name}.${provider.alias}`;
}

/** This function gives the first word of a type: the local name of the provider of the type. */
export function typeProvider(type: string): string {
  const end = type.indexOf("_");
  return end === -1 ? type : type.slice(0, end);
}

/** This function tells if a resource is a part of OpenTofu, with no provider configuration. */
export function isBuiltin(resource: Resource): boolean {
  return resource.provider === undefined && typeProvider(resource.type) === BUILTIN_PROVIDER;
}

/**
 * This function gives the provider configuration of a resource, or `undefined` when the layer has none for it.
 * For two configurations with one address, it gives the first one.
 */
export function resourceProvider(layer: TofuLayer, resource: Resource): Provider | undefined {
  const address = resource.provider ?? typeProvider(resource.type);
  return (layer.providers ?? []).find((provider) => providerAddress(provider) === address);
}
