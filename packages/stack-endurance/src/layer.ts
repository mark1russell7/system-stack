// The records of the endurance add-on. They are one layer of a stack, with the key `endurance/1` in `Stack.layers`.
// A store holds an amount of a resource. A draw takes a need each day. A converter changes resources into a need.
// A case cuts some parts for a time. The queries give the days that each draw holds, and the days that it does not get its need.
// The add-on names no topic: the resources, the needs and the levels are data. The unit of time is the day.

/** The name of the format of an endurance layer. It is the key of the layer in `Stack.layers`. */
export const ENDURANCE_SCHEMA = "endurance/1";

/** A date as `YYYY-MM-DD`. */
export type IsoDate = string;

/** A resource of a store, with its unit, for example `L`, `kg` or `Wh`. */
export interface Resource {
  readonly code: string;
  readonly unit: string;
}

/** A store: an amount of one resource. */
export interface Store {
  readonly id: string;
  /** The `code` of the resource. */
  readonly resource: string;
  /** The amount, in the unit of the resource. */
  readonly amount: number;
  /** The due date. On this date and after it, the store gives nothing. A store with no due date does not expire. */
  readonly due?: IsoDate | undefined;
  /** The `id` of the part of the stack that holds the store. When the part stops, the store gives nothing. */
  readonly part?: string | undefined;
}

/**
 * A draw: a need that a load takes each day from its supply.
 * Examples are the power of a rack and the drinking water of a building.
 * When the supply part stops, the draw takes the need from the stores.
 */
export interface Draw {
  /** The code of the need. One draw has each code. */
  readonly need: string;
  /** The level of the draw. It is one of the `levels` of the layer. */
  readonly level: string;
  /** The amount of the need for each day. */
  readonly perDay: number;
  /** The count of the users of the draw, for example the persons or the machines. The shortfall counts each user. The default is 1. */
  readonly users?: number | undefined;
  /** The `id` of the part of the stack that supplies the need when no case stops it. */
  readonly supply: string;
}

/** The direct use of a resource for a need: 1 unit of the resource gives `amount` of the need. */
export interface DirectUse {
  readonly resource: string;
  readonly need: string;
  readonly amount: number;
}

/** The gift of one run of a converter: an amount of a need, or an amount of a resource, in its unit. */
export type Gift = { readonly need: string; readonly resource?: never; readonly amount: number } | { readonly resource: string; readonly need?: never; readonly amount: number };

/**
 * A converter: a device or an action that changes resources into a need or into a resource.
 * Example: a stove cooks 1 kg of dry rice with 2 L of water and 0.05 kg of fuel, and gives 3600 kcal.
 * Example: a generator changes 1 L of fuel into 3000 Wh of the battery. Then a direct use of the battery can take that energy.
 */
export interface Converter {
  readonly id: string;
  /** The `id` of the device in the stack. The converter stops when the device stops. */
  readonly device?: string | undefined;
  /** The resources that one run takes. */
  readonly takes: readonly { readonly resource: string; readonly amount: number }[];
  /** The need or the resource that one run gives, and its amount. A chain of converters cannot make a resource from itself. */
  readonly gives: Gift;
}

/**
 * The chance that a cut lasts more than a time: a list of points `[days, chance]`, from `[0, 1]` down to a chance of 0.
 * The days increase, and the chance does not increase. Between two points the chance is linear. This is a survival curve.
 */
export type Survival = readonly (readonly [days: number, chance: number])[];

/** A cut of a case: a part that the case stops, and the curve of the duration of the stop. */
export interface Cut {
  /** The `id` of the part of the stack. */
  readonly part: string;
  /** The printed name of the cut, for example "Power outage". */
  readonly title: string;
  readonly duration: Survival;
  /** The source of the curve. */
  readonly source: string;
}

/** A case: an event that cuts some parts at the same time, and the change that it makes to the draws. */
export interface CaseCuts {
  /** The code of the case. */
  readonly case: string;
  /** The printed name of the case, for example "Winter storm". */
  readonly title: string;
  readonly cuts: readonly Cut[];
  /** A factor on the amount of a need for each day, by the code of the need. Example: 1.5 for water in a heat wave. The default is 1. */
  readonly factors?: Readonly<Record<string, number>> | undefined;
  /** The usual time from the warning to the start, in seconds. A case with no warning has no lead time. */
  readonly leadSeconds?: number | undefined;
}

/** The yearly prior of one case at one place. */
export interface Prior {
  readonly case: string;
  readonly place: string;
  /** The events in one year in the area (`lambda`), 0 or more. */
  readonly perYear: number;
  /** The share of the events of the area that reach the place (`q`), from 0 to 1. */
  readonly reach: number;
  readonly source: string;
  /** The date of the data of the source. */
  readonly asOf: IsoDate;
}

/** The days that one draw holds, and the resources that are used up at that time. */
export interface DrawEndurance {
  readonly days: number;
  /**
   * The inputs of the draw that are used up at `days`, through each chain of converters, in the order of their codes. A higher draw can use up an input first.
   * A resource that only converters make, with no store of the layer, is not in the list.
   */
  readonly binding: readonly string[];
  /** The amount of each resource that the draw takes in its days, by the code of the resource. A resource with no take is not in the record. */
  readonly takes: Readonly<Record<string, number>>;
}

/** The days that each draw holds when a case stops its supply. A draw whose supply works is not in `needs`. */
export interface Endurance {
  readonly case: string;
  readonly at: IsoDate;
  /** The result of each draw, by the code of its need. */
  readonly needs: Readonly<Record<string, DrawEndurance>>;
}

/** An endurance layer: the levels, the resources, the stores, the draws, the uses and the converters, the cases and their priors. */
export interface EnduranceLayer {
  readonly schema: typeof ENDURANCE_SCHEMA;
  /** The levels of the draws, the most important first, for example `["critical", "normal"]`. A higher level takes the resources first. */
  readonly levels: readonly string[];
  readonly resources: readonly Resource[];
  readonly stores: readonly Store[];
  readonly draws: readonly Draw[];
  readonly direct?: readonly DirectUse[] | undefined;
  readonly converters?: readonly Converter[] | undefined;
  readonly cases?: readonly CaseCuts[] | undefined;
  readonly priors?: readonly Prior[] | undefined;
}
