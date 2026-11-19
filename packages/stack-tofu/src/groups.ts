import type { TofuFault } from "./check.ts";
import {
  BUILTIN_PROVIDER,
  copyName,
  resourceAddress,
  typeProvider,
  type Copy,
  type Group,
  type GroupResource,
  type Resource,
  type TofuLayer,
  type TofuObject,
  type TofuValue,
} from "./layer.ts";
import { isForm, isList, isObject, NAME_FORM, paramOf, pathText, refOf, refParts, type ValuePath } from "./values.ts";

// The groups of resources and their copies. The resources of a copy are a view of its group. Each function of the package
// reads the resources of a layer through `layerResources`, so each gate, each query and the files cover the copies.

/** This function gives the local address of a resource of a group: its type, a point and its local name. */
export function localAddress(resource: GroupResource): string {
  return `${resource.type}.${resource.name}`;
}

/** This function gives the name in the files of a resource of a copy: the name of the copy, `_` and the local name. */
export function copyResourceName(copy: Copy, resource: GroupResource): string {
  return `${copyName(copy)}_${resource.name}`;
}

/** This function gives the provider name of the address of a provider configuration: the word before the point. */
function providerName(address: string): string {
  const end = address.indexOf(".");
  return end === -1 ? address : address.slice(0, end);
}

/** This function tells if a resource of a group is a part of OpenTofu, with no provider configuration. */
function isBuiltinMember(resource: GroupResource): boolean {
  return resource.provider === undefined && typeProvider(resource.type) === BUILTIN_PROVIDER;
}

/** This function gives the value of each parameter of a group for a copy. It gives `undefined` when a parameter has no value. */
function paramValues(group: Group, copy: Copy): Map<string, TofuValue> | undefined {
  const values = new Map<string, TofuValue>();
  for (const param of group.params ?? []) {
    const value = copy.values !== undefined && Object.hasOwn(copy.values, param.name) ? copy.values[param.name] : param.default;
    if (value === undefined) return undefined;
    values.set(param.name, value);
  }
  return values;
}

/**
 * This function fills a value of a resource of a group for one copy. A parameter form becomes the value of the parameter.
 * A reference to a local address of the group becomes a reference to the resource of the copy. The value of a parameter does not change.
 */
function fill(value: TofuValue, params: ReadonlyMap<string, TofuValue>, addresses: ReadonlyMap<string, string>): TofuValue {
  if (isList(value)) return value.map((item) => fill(item, params, addresses));
  if (!isObject(value)) return value;
  if (isForm(value)) {
    const param = paramOf(value);
    const given = param === undefined ? undefined : params.get(param);
    if (given !== undefined) return given;
    const ref = refOf(value);
    const parts = ref === undefined ? undefined : refParts(ref);
    const address = parts === undefined ? undefined : addresses.get(parts.address);
    return parts !== undefined && address !== undefined ? { $ref: `${address}.${parts.attribute}` } : value;
  }
  return fillObject(value, params, addresses);
}

/** This function fills each argument of an object. The object itself is not a form, also when it has a key that starts with `$`. */
function fillObject(values: TofuObject, params: ReadonlyMap<string, TofuValue>, addresses: ReadonlyMap<string, string>): TofuObject {
  return Object.fromEntries(Object.entries(values).map(([key, item]) => [key, fill(item, params, addresses)]));
}

/** This function gives the provider configuration of a resource of a copy. A configuration of the copy with the same provider name replaces that of the group. */
function copyProvider(copy: Copy, resource: GroupResource): string | undefined {
  if (isBuiltinMember(resource)) return undefined;
  const name = providerName(resource.provider ?? typeProvider(resource.type));
  return copy.providers?.find((address) => providerName(address) === name) ?? resource.provider;
}

/**
 * This function gives the resources of the copies of a layer, in the sequence of the copies and of the resources of each group.
 *
 * - A resource of a copy makes the part of the copy. Its name is the name of the copy, `_` and its local name.
 * - A parameter form becomes the value of the copy, or the default of the parameter.
 * - A reference to a local address of the group reads the resource of the same copy.
 * - A configuration of the copy replaces the configuration of the same provider name.
 *
 * A copy whose group the layer does not have, or that gives no value for a parameter with no default, makes no resource.
 * For two groups with one name, the copies use the first one. The gate `checkTofu` gives a fault for each such record.
 */
export function copyResources(layer: TofuLayer): Resource[] {
  const groups = new Map<string, Group>();
  for (const group of layer.groups ?? []) if (!groups.has(group.name)) groups.set(group.name, group);
  return (layer.copies ?? []).flatMap((copy) => {
    const group = groups.get(copy.group);
    const params = group === undefined ? undefined : paramValues(group, copy);
    if (group === undefined || params === undefined) return [];
    const addresses = new Map(group.resources.map((resource) => [localAddress(resource), `${resource.type}.${copyResourceName(copy, resource)}`]));
    return group.resources.map((resource): Resource => {
      const provider = copyProvider(copy, resource);
      return {
        part: copy.part,
        type: resource.type,
        name: copyResourceName(copy, resource),
        ...(provider === undefined ? {} : { provider }),
        ...(resource.values === undefined ? {} : { values: fillObject(resource.values, params, addresses) }),
        ...(resource.cost === undefined ? {} : { cost: resource.cost }),
        ...(resource.keep === undefined ? {} : { keep: resource.keep }),
        ...(resource.ignore === undefined ? {} : { ignore: resource.ignore }),
      };
    });
  });
}

/** This function gives each resource of a layer: the resources of the field `resources`, and then the resources of the copies. */
export function layerResources(layer: TofuLayer): readonly Resource[] {
  return (layer.copies ?? []).length === 0 ? layer.resources : [...layer.resources, ...copyResources(layer)];
}

/** One parameter form of a value, with its place. */
interface ParamUse {
  readonly name: string;
  readonly path: ValuePath;
}

/** This function gives each correct parameter form of the arguments of a record, in the sequence of the arguments. */
function paramUses(values: TofuObject): ParamUse[] {
  const uses: ParamUse[] = [];
  const walk = (item: TofuValue, path: ValuePath): void => {
    if (isList(item)) {
      item.forEach((child, index) => {
        walk(child, [...path, index]);
      });
      return;
    }
    if (!isObject(item)) return;
    const name = isForm(item) ? paramOf(item) : undefined;
    if (name !== undefined) uses.push({ name, path });
    else if (!isForm(item)) for (const [key, child] of Object.entries(item)) walk(child, [...path, key]);
  };
  for (const [key, child] of Object.entries(values)) walk(child, [key]);
  return uses;
}

/** This function gives a list of names for a message, for example `"a", "b"`. */
function quoted(items: readonly string[]): string {
  return items.map((item) => `"${item}"`).join(", ");
}

/**
 * This function gives the faults of the groups and of the copies of a layer. `checkTofu` gives them with its other faults.
 * The resources of the copies get the faults of each resource there: the gate examines them as resources.
 *
 * The errors:
 * - `group-form`: the name of a group, of a parameter or of a copy does not have the form of a name. Or a group has no resource.
 * - `group-duplicate`: two groups, two parameters of a group, two resources of a group with one local address, or two copies have one name.
 * - `group-shadow`: a local address of a group is the address of a resource of the layer. A reference in the group then reads the copy.
 * - `group-none`: a copy names a group that the layer does not have.
 * - `param-none`: a parameter form of a group names a parameter that the group does not have.
 * - `param-missing`: a copy gives no value for a parameter with no default.
 * - `param-unknown`: a copy gives a value for a parameter that the group does not have.
 * - `copy-provider`: a configuration of a copy replaces no configuration of the group, or two of them have one provider name.
 *   A configuration that the layer does not have gives `provider-none` at each resource of the copy.
 *
 * The warnings:
 * - `group-unused`: no copy names a group.
 * - `param-unused`: no resource of a group reads a parameter.
 */
export function groupFaults(layer: TofuLayer): TofuFault[] {
  const faults: TofuFault[] = [];
  const add = (level: TofuFault["level"], code: TofuFault["code"], at: string, message: string, more: { readonly other?: string; readonly part?: string } = {}): void => {
    faults.push({ level, code, at, message, ...more });
  };
  const top = new Set(layer.resources.map(resourceAddress));
  const groups = new Map<string, Group>();
  for (const group of layer.groups ?? []) {
    const at = `group.${group.name}`;
    if (groups.has(group.name)) {
      add("error", "group-duplicate", at, `Two groups have the name "${group.name}".`);
      continue;
    }
    groups.set(group.name, group);
    if (!NAME_FORM.test(group.name)) add("error", "group-form", at, `The name "${group.name}" of a group does not have the form of a name.`);
    if (group.resources.length === 0) add("error", "group-form", at, `The group "${group.name}" has no resource.`);
    const params = new Set<string>();
    for (const param of group.params ?? []) {
      if (params.has(param.name)) add("error", "group-duplicate", at, `Two parameters of the group "${group.name}" have the name "${param.name}".`);
      else if (!NAME_FORM.test(param.name)) add("error", "group-form", at, `The name "${param.name}" of a parameter of the group "${group.name}" does not have the form of a name.`);
      params.add(param.name);
    }
    const locals = new Set<string>();
    const read = new Set<string>();
    for (const resource of group.resources) {
      const local = localAddress(resource);
      if (locals.has(local)) add("error", "group-duplicate", at, `Two resources of the group "${group.name}" have the local address "${local}".`);
      locals.add(local);
      if (top.has(local)) {
        add("error", "group-shadow", at, `The group "${group.name}" has the local address "${local}", and the layer has a resource with that address. A reference in the group reads the resource of the copy.`, {
          other: local,
        });
      }
      for (const use of paramUses(resource.values ?? {})) {
        if (params.has(use.name)) read.add(use.name);
        else add("error", "param-none", at, `The value at "${pathText(use.path)}" of the resource "${local}" of the group "${group.name}" names the parameter "${use.name}", which the group does not have.`);
      }
    }
    for (const name of params) {
      if (!read.has(name)) add("warning", "param-unused", at, `No resource of the group "${group.name}" reads the parameter "${name}".`);
    }
  }

  const copies = new Set<string>();
  const copied = new Set<string>();
  for (const copy of layer.copies ?? []) {
    const name = copyName(copy);
    const at = `copy.${name}`;
    const more = { part: copy.part };
    if (copies.has(name)) {
      add("error", "group-duplicate", at, `Two copies have the name "${name}".`, more);
      continue;
    }
    copies.add(name);
    if (!NAME_FORM.test(name)) add("error", "group-form", at, `The name "${name}" of a copy does not have the form of a name.`, more);
    const group = groups.get(copy.group);
    if (group === undefined) {
      add("error", "group-none", at, `The copy "${name}" names the group "${copy.group}", which the layer does not have. It makes no resource.`, { ...more, other: `group.${copy.group}` });
      continue;
    }
    copied.add(group.name);
    const params = group.params ?? [];
    const given = Object.keys(copy.values ?? {});
    for (const key of given) {
      if (!params.some((param) => param.name === key)) add("error", "param-unknown", at, `The copy "${name}" gives the parameter "${key}", which the group "${group.name}" does not have.`, more);
    }
    const missing = params.filter((param) => param.default === undefined && !given.includes(param.name)).map((param) => param.name);
    if (missing.length > 0) add("error", "param-missing", at, `The copy "${name}" gives no value for the parameters ${quoted(missing)} of the group "${group.name}". It makes no resource.`, more);
    const used = new Set(group.resources.filter((resource) => !isBuiltinMember(resource)).map((resource) => providerName(resource.provider ?? typeProvider(resource.type))));
    const replaced = new Set<string>();
    for (const address of copy.providers ?? []) {
      const provider = providerName(address);
      if (replaced.has(provider)) {
        add("error", "copy-provider", at, `The copy "${name}" has two configurations of the provider "${provider}". Each one replaces the configuration of its provider name.`, more);
      } else if (!used.has(provider)) {
        add("error", "copy-provider", at, `The configuration "${address}" of the copy "${name}" replaces no configuration: no resource of the group "${group.name}" uses the provider "${provider}".`, more);
      }
      replaced.add(provider);
    }
  }
  for (const group of groups.values()) {
    if (!copied.has(group.name)) add("warning", "group-unused", `group.${group.name}`, `No copy names the group "${group.name}". It makes no resource.`);
  }
  return faults;
}
