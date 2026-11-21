import { stronglyConnectedComponents } from "@mark1russell7/collections/graph";
import { neededParts, type Stack } from "@mark1russell7/system-stack";
import type { Profile, SetupLayer } from "./layer.ts";

// The order of the profiles of a host. The needs of the stack give it: a profile comes after each profile
// of the same host whose part its part needs, directly or through other parts. Where the needs give no order, the layer order holds.

/** The order of the profiles of one host. */
export interface ProfileOrder {
  /** The profiles of the host in the order of the setup. It is empty when the needs have a cycle. */
  readonly profiles: readonly Profile[];
  /** The names of the profiles in each cycle of the needs. Each cycle has two or more profiles. */
  readonly cycles: readonly (readonly string[])[];
}

/** This function gives each host of a layer once, in the order of its first profile. */
export function setupHosts(layer: SetupLayer): string[] {
  const hosts: string[] = [];
  for (const profile of layer.profiles) for (const host of profile.hosts) if (!hosts.includes(host)) hosts.push(host);
  return hosts;
}

/** This function gives the profiles of a layer that name a host, in the layer order. */
export function hostProfiles(layer: SetupLayer, host: string): Profile[] {
  return layer.profiles.filter((profile) => profile.hosts.includes(host));
}

/**
 * This function gives, for each profile of a list, the positions of the profiles of the list that come before it.
 * A profile comes after each other profile whose part is a needed part of its part. Two profiles of one part have no order.
 *
 * @param profiles - The profiles of one host.
 * @param stack - The stack. `neededParts` of the core gives the needs.
 * @returns For each position of the list, the positions that come before it.
 */
export function profilesBefore(profiles: readonly Profile[], stack: Stack): number[][] {
  return profiles.map((profile, at) => {
    const needed = neededParts(stack, profile.part);
    const before: number[] = [];
    profiles.forEach((other, position) => {
      if (position !== at && other.part !== profile.part && needed.has(other.part)) before.push(position);
    });
    return before;
  });
}

/**
 * This function gives the profiles of a host in the order of the setup.
 *
 * - A profile comes after each profile of the host whose part its part needs.
 * - Where the needs give no order, the layer order holds. Thus the order is stable.
 * - When the needs of two or more profiles make a cycle, the result has no order and names each cycle.
 *
 * `stronglyConnectedComponents` of `@mark1russell7/collections/graph` finds the cycles.
 *
 * @param layer - The setup layer.
 * @param stack - The stack.
 * @param host - The `id` of the host.
 * @returns The order, or the cycles.
 */
export function profileOrder(layer: SetupLayer, stack: Stack, host: string): ProfileOrder {
  const profiles = hostProfiles(layer, host);
  const before = profilesBefore(profiles, stack);
  const positions = profiles.map((_, at) => at);
  const cycles = stronglyConnectedComponents(positions, (at) => before[at] ?? [])
    .filter((component) => component.length > 1)
    .map((component) => [...component].sort((a, b) => a - b).map((at) => profiles[at]?.name ?? String(at)));
  if (cycles.length > 0) return { profiles: [], cycles };
  const placed = new Set<number>();
  const order: Profile[] = [];
  while (order.length < profiles.length) {
    const next = positions.find((at) => !placed.has(at) && (before[at] ?? []).every((other) => placed.has(other)));
    // With no cycle, a free profile is always there. The guard stops a loop that has none.
    if (next === undefined) break;
    placed.add(next);
    const profile = profiles[next];
    if (profile !== undefined) order.push(profile);
  }
  return { profiles: order, cycles: [] };
}
