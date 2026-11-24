import { stronglyConnectedComponents } from "@mark1russell7/collections/graph";
import { curveFault, dayNumber, type Fault, type Stack } from "@mark1russell7/system-stack";
import { giftNeed, giftResource } from "./endurance.ts";
import type { Converter, EnduranceLayer } from "./layer.ts";

// The gate of an endurance layer: the meaning of a layer with a correct form, for its base stack.

/**
 * These are the codes of the gate. Each code is an error, except `endurance-device-mix`, `endurance-no-way` and `endurance-cut-no-curve`, which are warnings.
 *
 * - `endurance-twice`: two or more records of one list have one key. A key is a level, a resource, a store, a need, a converter or a case.
 *   The key of a prior is its case and its place. A converter takes each resource on one line, and a case cuts each part one time.
 * - `endurance-level-unknown`: the level of a draw is not a level of the layer.
 * - `endurance-resource-unknown`: a store, a use or a converter names a resource that the layer does not have.
 * - `endurance-part-unknown`: a supply, a device, the part of a store or a cut is not a part of the base stack.
 * - `endurance-range`: an amount, a rate, a count or a factor is not a finite number of 0 or more. Or a reach is not from 0 to 1.
 * - `endurance-date`: a date is not a date `YYYY-MM-DD`.
 * - `endurance-converter-empty`: a converter takes nothing, or it gives an amount of 0.
 * - `endurance-curve`: a survival curve does not start at `[0, 1]`, or it does not end at a chance of 0.
 *   Or its days do not increase, or its chance increases.
 * - `endurance-prior-case`: a prior names a case that the layer does not have.
 * - `endurance-cycle`: converters make a resource from itself, through one converter or a chain. One fault names each cycle.
 * - `endurance-devices`: two converters of one device give two different counts of devices.
 * - `endurance-device-mix` (warning): a device has a converter with a limit `perDay` and a converter with no limit. The
 *   converter with no limit uses no device-days, so its runs do not reduce the runs of the limited converter.
 * - `endurance-no-way` (warning): a draw has no direct use and no converter, so it holds 0 days when its supply stops.
 * - `endurance-cut-no-curve` (warning): a cut has no curve of its duration. The draws whose stop it can be part of are no read in the shortfall.
 */
export const ENDURANCE_CODES: readonly [
  "endurance-twice",
  "endurance-level-unknown",
  "endurance-resource-unknown",
  "endurance-part-unknown",
  "endurance-range",
  "endurance-date",
  "endurance-converter-empty",
  "endurance-curve",
  "endurance-prior-case",
  "endurance-cycle",
  "endurance-devices",
  "endurance-device-mix",
  "endurance-no-way",
  "endurance-cut-no-curve",
] = [
  "endurance-twice",
  "endurance-level-unknown",
  "endurance-resource-unknown",
  "endurance-part-unknown",
  "endurance-range",
  "endurance-date",
  "endurance-converter-empty",
  "endurance-curve",
  "endurance-prior-case",
  "endurance-cycle",
  "endurance-devices",
  "endurance-device-mix",
  "endurance-no-way",
  "endurance-cut-no-curve",
];

/** A code of `ENDURANCE_CODES`. */
export type EnduranceCode = (typeof ENDURANCE_CODES)[number];

/** A fault of the gate of an endurance layer. */
export interface EnduranceFault extends Fault {
  readonly code: EnduranceCode;
}

export { curveFault } from "@mark1russell7/system-stack";

/**
 * This function gives each fault of an endurance layer. With a base stack, it also examines the `id` of each part. A list with no error tells that the gate passes.
 *
 * The faults are in the order of the layer. The function is pure.
 *
 * @param layer - The endurance layer
 * @param stack - The base stack, with the layer. With no stack, the gate does not examine the parts.
 * @returns The faults
 */
export function checkEndurance(layer: EnduranceLayer, stack?: Stack): EnduranceFault[] {
  const faults: EnduranceFault[] = [];
  const add = (level: EnduranceFault["level"], code: EnduranceCode, at: string, message: string): void => {
    faults.push({ level, code, at, message });
  };
  const once = (what: string, keys: readonly string[]): void => {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) add("error", "endurance-twice", key, `Two or more ${what} have the key "${key}".`);
      seen.add(key);
    }
  };
  const range = (at: string, what: string, value: number): void => {
    if (!(Number.isFinite(value) && value >= 0)) add("error", "endurance-range", at, `The ${what} of "${at}" is ${String(value)}. It must be a finite number of 0 or more.`);
  };
  const date = (at: string, value: string): void => {
    if (dayNumber(value) === undefined) add("error", "endurance-date", at, `The date "${value}" of "${at}" is not a date YYYY-MM-DD.`);
  };
  const parts = stack === undefined ? undefined : new Set(stack.parts.map((part) => part.id));
  const part = (at: string, what: string, id: string | undefined): void => {
    if (parts !== undefined && id !== undefined && !parts.has(id)) add("error", "endurance-part-unknown", at, `The ${what} "${id}" of "${at}" is not a part of the stack.`);
  };
  const resources = new Set(layer.resources.map((resource) => resource.code));
  const resource = (at: string, code: string): void => {
    if (!resources.has(code)) add("error", "endurance-resource-unknown", at, `The resource "${code}" of "${at}" is not a resource of the layer.`);
  };
  const direct = layer.direct ?? [];
  const converters = layer.converters ?? [];
  const cases = layer.cases ?? [];
  const priors = layer.priors ?? [];

  once("levels", layer.levels);
  once("resources", layer.resources.map((item) => item.code));
  once("stores", layer.stores.map((store) => store.id));
  once("draws", layer.draws.map((draw) => draw.need));
  once("converters", converters.map((converter) => converter.id));
  once("cases", cases.map((item) => item.case));
  once("priors", priors.map((prior) => `${prior.case}@${prior.place}`));

  for (const store of layer.stores) {
    resource(store.id, store.resource);
    range(store.id, "amount", store.amount);
    if (store.due !== undefined) date(store.id, store.due);
    part(store.id, "part", store.part);
  }
  const levels = new Set(layer.levels);
  for (const draw of layer.draws) {
    if (!levels.has(draw.level)) add("error", "endurance-level-unknown", draw.need, `The level "${draw.level}" of the draw "${draw.need}" is not a level of the layer.`);
    range(draw.need, "rate", draw.perDay);
    if (draw.users !== undefined) range(draw.need, "count of users", draw.users);
    part(draw.need, "supply", draw.supply);
    const ways = direct.some((use) => use.need === draw.need) || converters.some((converter) => giftNeed(converter) === draw.need);
    if (!ways) add("warning", "endurance-no-way", draw.need, `The draw "${draw.need}" has no direct use and no converter. It holds 0 days when its supply stops.`);
  }
  for (const use of direct) {
    const at = `${use.resource}>${use.need}`;
    resource(at, use.resource);
    range(at, "amount", use.amount);
  }
  for (const converter of converters) {
    once(`resources of the converter "${converter.id}"`, converter.takes.map((input) => input.resource));
    for (const input of converter.takes) {
      resource(converter.id, input.resource);
      range(converter.id, "amount", input.amount);
    }
    range(converter.id, "amount", converter.gives.amount);
    const made = giftResource(converter);
    if (made !== undefined) resource(converter.id, made);
    if (!converter.takes.some((input) => input.amount > 0) || converter.gives.amount === 0) add("error", "endurance-converter-empty", converter.id, `The converter "${converter.id}" takes nothing, or it gives nothing.`);
    part(converter.id, "device", converter.device);
    if (converter.perDay !== undefined) range(converter.id, "rate perDay", converter.perDay);
    if (converter.devices !== undefined && !(Number.isSafeInteger(converter.devices) && converter.devices >= 1))
      add("error", "endurance-range", converter.id, `The count of devices of "${converter.id}" is ${String(converter.devices)}. It must be a whole number of 1 or more.`);
  }
  const counts = new Map<string, number>();
  for (const converter of converters) {
    if (converter.device === undefined) continue;
    const count = converter.devices ?? 1;
    const seen = counts.get(converter.device);
    if (seen !== undefined && seen !== count)
      add("error", "endurance-devices", converter.id, `The converter "${converter.id}" gives the count ${String(count)} for the device "${converter.device}". An other converter gives the count ${String(seen)}.`);
    if (seen === undefined) counts.set(converter.device, count);
  }
  // One fault names each device with a limited converter and a converter with no limit, at the first converter with no limit.
  const mixed = new Set<string>();
  for (const converter of converters) {
    const device = converter.device;
    if (device === undefined || converter.perDay !== undefined || mixed.has(device)) continue;
    const limited = converters.find((other) => other.device === device && other.perDay !== undefined);
    if (limited === undefined) continue;
    mixed.add(device);
    add("warning", "endurance-device-mix", converter.id, `The device "${device}" has the limited converter "${limited.id}" and the converter "${converter.id}" with no limit. "${converter.id}" uses no device-days.`);
  }
  const caseCodes = new Set(cases.map((item) => item.case));
  for (const item of cases) {
    once(`cuts of the case "${item.case}"`, item.cuts.map((cut) => cut.part));
    for (const cut of item.cuts) {
      const at = `${item.case}/${cut.part}`;
      part(at, "cut", cut.part);
      if (cut.duration === undefined) {
        add("warning", "endurance-cut-no-curve", at, `The cut "${at}" has no curve of its duration, so the draws that it can stop are no read.`);
        continue;
      }
      const fault = curveFault(cut.duration);
      if (fault !== undefined) add("error", "endurance-curve", at, `The duration of the cut "${at}": ${fault}`);
    }
    for (const [need, factor] of Object.entries(item.factors ?? {})) range(`${item.case}/${need}`, "factor", factor);
    if (item.leadSeconds !== undefined) range(item.case, "lead time", item.leadSeconds);
  }
  for (const cycle of resourceCycles(converters)) {
    const [first = ""] = cycle;
    const names = cycle.map((code) => `"${code}"`).join(", ");
    const message = cycle.length === 1 ? `A converter makes the resource ${names} from itself.` : `Converters make the resources ${names} from each other.`;
    add("error", "endurance-cycle", first, `${message} A chain of converters cannot end.`);
  }
  for (const prior of priors) {
    const at = `${prior.case}@${prior.place}`;
    if (!caseCodes.has(prior.case)) add("error", "endurance-prior-case", at, `The prior "${at}" names the case "${prior.case}", which the layer does not have.`);
    range(at, "count of events in one year", prior.perYear);
    if (!(prior.reach >= 0 && prior.reach <= 1)) add("error", "endurance-range", at, `The reach of "${at}" is ${String(prior.reach)}. It must be from 0 to 1.`);
    date(at, prior.asOf);
  }
  return faults;
}

/** This function gives each cycle of resources: a resource is made from a resource that a converter makes from it. Each cycle is a list of codes. */
function resourceCycles(converters: readonly Converter[]): string[][] {
  const from = new Map<string, Set<string>>();
  for (const converter of converters) {
    const made = giftResource(converter);
    if (made === undefined) continue;
    const inputs = from.get(made) ?? new Set<string>();
    for (const input of converter.takes) if (input.amount > 0) inputs.add(input.resource);
    from.set(made, inputs);
  }
  const successors = (code: string): Iterable<string> => from.get(code) ?? [];
  return stronglyConnectedComponents(from.keys(), successors).filter((component) => {
    const [only = ""] = component;
    return component.length > 1 || (from.get(only)?.has(only) ?? false);
  });
}

/** This function tells if a list of faults has an error. */
export function hasEnduranceError(faults: readonly EnduranceFault[]): boolean {
  return faults.some((fault) => fault.level === "error");
}
