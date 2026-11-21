import { dayNumber, type Fault, type Stack } from "@mark1russell7/system-stack";
import type { EnduranceLayer, Survival } from "./layer.ts";

// The gate of an endurance layer: the meaning of a layer with a correct form, for its base stack.

/**
 * These are the codes of the gate. Each code is an error, except `endurance-no-way`, which is a warning.
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
 * - `endurance-no-way` (warning): a draw has no direct use and no converter, so it holds 0 days when its supply stops.
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
  "endurance-no-way",
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
  "endurance-no-way",
];

/** A code of `ENDURANCE_CODES`. */
export type EnduranceCode = (typeof ENDURANCE_CODES)[number];

/** A fault of the gate of an endurance layer. */
export interface EnduranceFault extends Fault {
  readonly code: EnduranceCode;
}

/** This function gives the first fault of a survival curve, or `undefined`. */
export function curveFault(curve: Survival): string | undefined {
  const first = curve[0];
  if (first === undefined || first[0] !== 0 || first[1] !== 1) return "The curve does not start at [0, 1].";
  for (let index = 1; index < curve.length; index += 1) {
    const [t0, p0] = curve[index - 1] ?? [0, 1];
    const [t1, p1] = curve[index] ?? [0, 0];
    if (!(Number.isFinite(t1) && t1 > t0)) return `The days of the point ${String(index)} are not more than the days of the point before it.`;
    if (!(p1 >= 0 && p1 <= p0)) return `The chance of the point ${String(index)} is not from 0 to the chance of the point before it.`;
  }
  if (curve[curve.length - 1]?.[1] !== 0) return "The curve does not end at a chance of 0.";
  return undefined;
}

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
    const ways = direct.some((use) => use.need === draw.need) || converters.some((converter) => converter.gives.need === draw.need);
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
    if (!converter.takes.some((input) => input.amount > 0) || converter.gives.amount === 0) add("error", "endurance-converter-empty", converter.id, `The converter "${converter.id}" takes nothing, or it gives nothing.`);
    part(converter.id, "device", converter.device);
  }
  const caseCodes = new Set(cases.map((item) => item.case));
  for (const item of cases) {
    once(`cuts of the case "${item.case}"`, item.cuts.map((cut) => cut.part));
    for (const cut of item.cuts) {
      const at = `${item.case}/${cut.part}`;
      part(at, "cut", cut.part);
      const fault = curveFault(cut.duration);
      if (fault !== undefined) add("error", "endurance-curve", at, `The duration of the cut "${at}": ${fault}`);
    }
    for (const [need, factor] of Object.entries(item.factors ?? {})) range(`${item.case}/${need}`, "factor", factor);
    if (item.leadSeconds !== undefined) range(item.case, "lead time", item.leadSeconds);
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

/** This function tells if a list of faults has an error. */
export function hasEnduranceError(faults: readonly EnduranceFault[]): boolean {
  return faults.some((fault) => fault.level === "error");
}
