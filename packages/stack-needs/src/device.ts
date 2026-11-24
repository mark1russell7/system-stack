import type { DeviceFacts, SupplyCatalog } from "@mark1russell7/market/supplies";
import { valueIn } from "@mark1russell7/quantity";
import type { FragmentConverter } from "./cook.ts";
import { DAILY_NEEDS, type DailyNeed } from "./daily.ts";
import type { FragmentDraw, FragmentResource } from "./household.ts";

// The devices of a kit that run on cells, as converters of an endurance layer, for example a radio and a flashlight.
// One run of a converter is one cell: the cell gives the hours of the run time of the device for each cell.
// One device gives its need for 24 hours in a day or less. Thus the converter has a limit of runs for each day.
// Each run time comes from a cited fact of the catalog or a cited input. A missing fact gives a no read, and no converter.

/** The hours in one day, from the definition of the day in `@mark1russell7/quantity`. */
export const HOURS_IN_DAY: number = valueIn({ value: 1, unit: "d" }, "h");

/** The run time of a device of the caller: `amount` of `unit` on `per` cells, with its citation. */
export interface DeviceRun {
  readonly amount: number;
  readonly unit: string;
  readonly per: { readonly amount: number; readonly unit: string };
  /** The citation of the value: the `id` of a fact or a source of the caller. */
  readonly cite: string;
}

/** The part of the stack that supplies the needs of the devices, and the level of their draws. */
export interface DeviceDraws {
  readonly level: string;
  readonly supply: string;
}

/** The inputs of the device fragment. */
export interface DeviceFragmentInput {
  /** The catalog of supplies of `@mark1russell7/market`. */
  readonly catalog: SupplyCatalog;
  /** The count of units of each product of the buy list or the kit, by the `id` of the product. */
  readonly units: Readonly<Record<string, number>>;
  /**
   * The run time of each device of the caller, by the `id` of the product. It replaces the run time of the catalog, for
   * example for a model that the catalog does not cite. It has no default.
   */
  readonly runs?: Readonly<Record<string, DeviceRun>> | undefined;
  /** The `id` of each device in the stack, by the `id` of the product. The converter stops when the device stops. */
  readonly parts?: Readonly<Record<string, string>> | undefined;
  /** The level and the supply of the draws. Without it, the fragment has no draw. */
  readonly draws?: DeviceDraws | undefined;
  /** The daily needs. The default is `DAILY_NEEDS`. */
  readonly needs?: readonly DailyNeed[] | undefined;
  /** The start of the `id` of each converter. The default is `device`. */
  readonly prefix?: string | undefined;
}

/** A value of the device model with a read, in its unit, or no read with the reasons. A no read is not 0. */
export type DeviceRead = { readonly read: true; readonly value: number; readonly unit: string } | { readonly read: false; readonly why: string };

/** The values of one device of the buy list. */
export interface DeviceLine {
  readonly product: string;
  /** The code of the need that the device gives, for example `alert.watch`. */
  readonly need: string;
  /** The resource of its cells, for example `battery.aa`. */
  readonly battery: string;
  /** The count of whole devices. */
  readonly devices: number;
  /** The hours of the need for each cell, in `h`. */
  readonly hours: DeviceRead;
}

/** A converter of the device fragment: a converter with its limit of runs for each day and its count of devices. */
export interface DeviceConverter extends FragmentConverter {
  readonly perDay: number;
  readonly devices: number;
}

/** The device fragment of an endurance layer: the resources, one converter for each device with a read, and the draws. It has no store. */
export interface DeviceFragment {
  /** The format of an endurance layer, `endurance/1`. */
  readonly schema: "endurance/1";
  readonly levels: readonly string[];
  readonly resources: readonly FragmentResource[];
  readonly stores: readonly never[];
  readonly draws: readonly FragmentDraw[];
  readonly converters: readonly DeviceConverter[];
}

/** A device or a need with no record in the layer, and the reasons. `product` names a device, and `need` names a draw. */
export type DeviceNoRead = { readonly product: string; readonly need?: never; readonly why: string } | { readonly need: string; readonly product?: never; readonly why: string };

/** The device fragment, the line of each device and the records with no read. */
export interface DeviceFragmentResult {
  readonly layer: DeviceFragment;
  /** The line of each device of the buy list, in the order of the list. */
  readonly lines: readonly DeviceLine[];
  /** The devices with no converter, and the needs with no draw. */
  readonly noReads: readonly DeviceNoRead[];
  /** True when each device has a converter and each need has a draw. When it is false, the days of a need are a lower limit or a no read. */
  readonly read: boolean;
}

/** This function gives the value of an amount in a unit, or `undefined` when the units do not convert. */
function amountIn(value: number, unit: string, to: string): number | undefined {
  try {
    const out = valueIn({ value, unit }, to);
    return Number.isFinite(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

/** This function gives the hours for each cell of a run time, or a no read with its reason. */
function hoursOf(run: { readonly amount: number; readonly unit: string; readonly per: { readonly amount: number; readonly unit: string } }, cell: string, where: string): DeviceRead {
  const hours = amountIn(run.amount, run.unit, "h");
  const cells = amountIn(run.per.amount, run.per.unit, cell);
  if (hours === undefined || !(hours > 0)) return { read: false, why: `The run time ${run.amount} ${run.unit} of ${where} is not a time above 0.` };
  if (cells === undefined || !(cells > 0)) return { read: false, why: `The run time of ${where} is on ${run.per.amount} ${run.per.unit}, and that is not a count of cells above 0 in ${cell}.` };
  return { read: true, value: hours / cells, unit: "h" };
}

/** This function gives the hours for each cell of a device: the input of the caller first, then the catalog. */
function deviceHours(facts: DeviceFacts, run: DeviceRun | undefined, cell: string, product: string): DeviceRead {
  if (run !== undefined) {
    if (run.cite.trim() === "") return { read: false, why: `The run time of the caller for ${product} has no citation.` };
    return hoursOf(run, cell, `the caller for ${product}`);
  }
  if (!("amount" in facts.run)) return { read: false, why: `The catalog gives no run time for ${product}: ${facts.run.why}` };
  return hoursOf(facts.run, cell, `the catalog for ${product}`);
}

/**
 * This function gives the device fragment of an endurance layer. Each device of the buy list with a cited run time gives
 * one converter. One run takes one cell and gives the hours of the need for each cell. The limit of runs for each day is
 * `HOURS_IN_DAY` divided by those hours. Thus one device gives 24 hours of its need in a day or less. The count of
 * devices is the count of whole units of the product. A device with no cited run time gives no converter, and a no read.
 *
 * With `draws`, each need of a device gives one draw. Its rate is the daily rate of the need in its unit for each day. The users are 1
 * for a need of the household. A need with no read of its rate gives no draw, and a no read.
 *
 * @param input - The catalog, the counts of the buy list, the run times of the caller and the parts and draws
 * @throws RangeError for a device whose cells are not a resource of the catalog
 */
export function deviceFragment(input: DeviceFragmentInput): DeviceFragmentResult {
  const { catalog, units } = input;
  const prefix = input.prefix ?? "device";
  const unitOf = new Map(catalog.resources.map((resource) => [resource.code, resource.unit]));
  const lines: DeviceLine[] = [];
  const noReads: DeviceNoRead[] = [];
  const converters: DeviceConverter[] = [];
  const resources: FragmentResource[] = [];
  const needs: string[] = [];
  const needList = input.needs ?? DAILY_NEEDS;
  for (const [id, count] of Object.entries(units)) {
    const product = catalog.products.find((each) => each.id === id);
    const facts = product?.device;
    if (facts === undefined || !(count > 0)) continue;
    const cell = unitOf.get(facts.battery);
    if (cell === undefined) throw new RangeError(`The device ${id} runs on "${facts.battery}", and the catalog has no such resource.`);
    const devices = Math.floor(count);
    const hours = deviceHours(facts, input.runs?.[id], cell, id);
    lines.push({ product: id, need: facts.need, battery: facts.battery, devices, hours });
    if (devices < 1) noReads.push({ product: id, why: `The buy list has ${count} of ${id}, less than one whole device.` });
    else if (!hours.read) noReads.push({ product: id, why: hours.why });
    else {
      // The gift is in the unit of the need. A need that is not in the list takes hours.
      const unit = needList.find((each) => each.code === facts.need)?.unit ?? "h";
      const gift = amountIn(hours.value, "h", unit);
      if (gift === undefined) {
        noReads.push({ product: id, why: `The need ${facts.need} is in ${unit}, and that is not a time.` });
        if (!needs.includes(facts.need)) needs.push(facts.need);
        continue;
      }
      const part = input.parts?.[id];
      converters.push({
        id: `${prefix}:${id}`,
        ...(part === undefined ? {} : { device: part }),
        takes: [{ resource: facts.battery, amount: 1 }],
        gives: { need: facts.need, amount: gift },
        perDay: HOURS_IN_DAY / hours.value,
        devices,
      });
      if (!resources.some((each) => each.code === facts.battery)) resources.push({ code: facts.battery, unit: cell });
    }
    if (!needs.includes(facts.need)) needs.push(facts.need);
  }
  const draws: FragmentDraw[] = [];
  if (input.draws !== undefined) {
    const { level, supply } = input.draws;
    for (const code of needs) {
      const need = needList.find((each) => each.code === code);
      if (need === undefined) noReads.push({ need: code, why: `The daily needs have no need ${code}.` });
      else if (!need.rate.read) noReads.push({ need: code, why: need.rate.why });
      else {
        const perDay = amountIn(need.rate.perDay.value, need.rate.perDay.unit, `${need.unit}/d`);
        if (perDay === undefined || !(perDay > 0)) noReads.push({ need: code, why: `The daily rate of ${code} is not an amount in ${need.unit} for each day above 0.` });
        else if (need.users !== "household") noReads.push({ need: code, why: `The need ${code} is for each person. The device fragment has no count of persons.` });
        else draws.push({ need: code, level, perDay, users: 1, supply });
      }
    }
  }
  const layer: DeviceFragment = {
    schema: "endurance/1",
    levels: input.draws === undefined ? [] : [input.draws.level],
    resources,
    stores: [],
    draws,
    converters,
  };
  return { layer, lines, noReads, read: noReads.length === 0 };
}
