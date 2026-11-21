import { stronglyConnectedComponents } from "@mark1russell7/collections/graph";
import { partNeeds, partsById, type Part, type Stack } from "@mark1russell7/system-stack";
import { layerResources } from "./groups.ts";
import { resourceAddress, type Resource, type TofuLayer } from "./layer.ts";
import { refParts, valueUses } from "./values.ts";

// The queries over the records. The sequence of the resources in the files comes from the needs of the stack,
// so a person writes each dependence one time: in the stack.

/** This function gives the first resource of each address of a layer, in the sequence of the records. The resources of the copies come last. */
export function firstResources(layer: TofuLayer): readonly Resource[] {
  const seen = new Set<string>();
  return layerResources(layer).filter((resource) => {
    const address = resourceAddress(resource);
    if (seen.has(address)) return false;
    seen.add(address);
    return true;
  });
}

/**
 * This function gives the addresses of the resources of each part, by the `id` of the part.
 * The addresses of a part are sorted. With them, a host joins a plan or a state to the parts of the stack.
 */
export function resourcesByPart(layer: TofuLayer): Map<string, string[]> {
  const byPart = new Map<string, string[]>();
  for (const resource of firstResources(layer)) {
    const addresses = byPart.get(resource.part) ?? [];
    addresses.push(resourceAddress(resource));
    byPart.set(resource.part, addresses);
  }
  for (const addresses of byPart.values()) addresses.sort();
  return byPart;
}

/**
 * This function gives the address of each resource that the arguments of a resource read, sorted.
 * Each address comes one time. An address can name a resource that the layer does not have.
 */
export function resourceRefs(resource: Resource): string[] {
  const addresses = new Set<string>();
  for (const form of valueUses(resource.values ?? {}).forms) {
    // The arguments as a whole are not a value, so a form at the empty place reads nothing.
    const parts = form.kind === "ref" && form.text !== undefined && form.path.length > 0 ? refParts(form.text) : undefined;
    if (parts !== undefined) addresses.add(parts.address);
  }
  return [...addresses].sort();
}

/**
 * This function walks the needs of a part, nearest first. It gives the `id` of each part where the walk stops or goes on.
 * The walk does not go past a part for which `stop` gives `true`. It does not come back to the first part.
 */
function walkNeeds(parts: ReadonlyMap<string, Part>, from: string, stop: (id: string) => boolean): string[] {
  const seen = new Set<string>([from]);
  const found: string[] = [];
  let level = partNeeds(parts.get(from) ?? { id: from, kind: "" });
  while (level.length > 0) {
    const next: string[] = [];
    for (const id of level) {
      if (seen.has(id)) continue;
      seen.add(id);
      found.push(id);
      const part = parts.get(id);
      if (part !== undefined && !stop(id)) next.push(...partNeeds(part));
    }
    level = next;
  }
  return found;
}

// The core has `neededParts` since system-stack 0.1.6. This entry gives it again, so the API of the package does not change.
export { neededParts } from "@mark1russell7/system-stack";

/**
 * This function gives the dependencies of each resource that come from the needs of the stack, by the address of the resource.
 *
 * - A resource depends on the resources of each part that its part needs.
 * - For a needed part with no resource, the walk goes on to the needs of that part. It stops at the nearest parts with resources.
 * - An address that the arguments of the resource read is not in the list: OpenTofu knows that dependence from the arguments.
 *
 * The addresses of a resource are sorted. The generator writes them as `depends_on`.
 */
export function dependsOn(layer: TofuLayer, stack: Stack): Map<string, string[]> {
  const parts = partsById(stack);
  const byPart = resourcesByPart(layer);
  const result = new Map<string, string[]>();
  for (const resource of firstResources(layer)) {
    const read = new Set(resourceRefs(resource));
    const addresses = walkNeeds(parts, resource.part, (id) => byPart.has(id)).flatMap((id) => byPart.get(id) ?? []);
    result.set(
      resourceAddress(resource),
      addresses.filter((address) => !read.has(address)).sort(),
    );
  }
  return result;
}

/**
 * This function gives the cycles of the resources of a layer. In a cycle, each resource waits for a different one, and OpenTofu can make none of them.
 * A resource waits for each resource that its arguments read, and for each one of `dependsOn`.
 * Each cycle is a sorted list of addresses. A resource that reads its own attribute is a cycle of one resource.
 */
export function resourceCycles(layer: TofuLayer, stack: Stack): string[][] {
  const depends = dependsOn(layer, stack);
  const waits = new Map<string, string[]>();
  for (const resource of firstResources(layer)) {
    const address = resourceAddress(resource);
    waits.set(address, [...resourceRefs(resource), ...(depends.get(address) ?? [])]);
  }
  const nodes = [...waits.keys()].sort();
  return stronglyConnectedComponents(nodes, (address) => waits.get(address) ?? []).filter((component) => {
    const [only = ""] = component;
    return component.length > 1 || (waits.get(only) ?? []).includes(only);
  });
}
