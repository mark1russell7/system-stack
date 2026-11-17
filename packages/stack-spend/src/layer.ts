// The records of the spend add-on. They are one layer of a stack, with the key `spend/1` in `Stack.layers`.
// Each record gives the cost of one part: its plan, its price and the limits of its cost in a month.

/** The name of the format of a spend layer. It is the key of the layer in `Stack.layers`. */
export const SPEND_SCHEMA = "spend/1";

/**
 * These are the kinds of billing of a service.
 *
 * - `free`: the provider cannot take money. The account has no payment method, or the plan has no paid use.
 * - `fixed`: the price of a month is fixed, and the use does not change it. A price that was paid one time is a fixed price of 0.
 * - `metered`: the cost grows with the use. A free allowance with a payment method on the account is `metered`.
 */
export const BILLINGS: readonly ["free", "fixed", "metered"] = ["free", "fixed", "metered"];

/** A kind of billing of a service. */
export type Billing = (typeof BILLINGS)[number];

/**
 * These are the kinds of limit of the cost of a month.
 *
 * - `provider`: a hard limit of the provider. The provider stops the service at the amount.
 * - `prepaid`: a prepaid balance. The provider stops the service when the balance is empty.
 * - `code`: a stop by code. A part of the stack counts the cost and stops the use at the amount.
 * - `alert`: a message at the amount. An alert stops nothing, so it is not a hard limit.
 */
export const LIMIT_KINDS: readonly ["provider", "prepaid", "code", "alert"] = ["provider", "prepaid", "code", "alert"];

/** A kind of limit of the cost of a month. */
export type LimitKind = (typeof LIMIT_KINDS)[number];

/** A limit of the cost of a service in a month. */
export interface Limit {
  readonly kind: LimitKind;
  /** The amount of the limit for a month, in the currency of the layer. For `prepaid`, it is the largest balance. */
  readonly amount: number;
  /** For `prepaid`: the provider adds money to the balance automatically. Such a balance is not a hard limit. */
  readonly recharge?: boolean | undefined;
  /** For `code`: the `id` of the part of the stack that stops the use. */
  readonly stop?: string | undefined;
}

/** The proof of a record: who read the settings of the service, and on which date. */
export interface Proof {
  /** The date of the read, as `YYYY-MM-DD`. */
  readonly date: string;
  /** The reader of the settings, for example the owner of the account or the name of a program. */
  readonly by: string;
  /** The source of the read, for example the name of a page of the account. */
  readonly source?: string | undefined;
}

/**
 * The cost of a service after the end of its plan. It has the fields of a cost record that give a cost.
 * The gate examines it with the rules of a cost record: a cost that grows with the use must have a hard limit.
 */
export interface NextPlan {
  /** The name of the plan after the end. */
  readonly plan?: string | undefined;
  readonly billing: Billing;
  /** The fixed price of a month after the end, in the currency of the layer. A `fixed` plan must have one. */
  readonly price?: number | undefined;
  /** The limits that are in force after the end. A `metered` plan must have one hard limit, or more. */
  readonly limits?: readonly Limit[] | undefined;
}

/**
 * The end of the plan of a service: a trial, a free credit or a term that ends on a date.
 *
 * - With no `next`, the provider stops the service after the date, and it takes no money. The part does not work after the date.
 * - With a `next`, the service continues after the date, with the cost of `next`.
 */
export interface PlanEnd {
  /** The last day of the plan, as `YYYY-MM-DD`. */
  readonly date: string;
  /** The cost of the service after the end. A service that stops has none. */
  readonly next?: NextPlan | undefined;
}

/** The cost record of one part of the stack. */
export interface Service {
  /** The `id` of the part of the stack with the cost. */
  readonly part: string;
  /** The name of the plan of the service. */
  readonly plan?: string | undefined;
  readonly billing: Billing;
  /** The fixed price of a month, in the currency of the layer. A `fixed` service must have one. */
  readonly price?: number | undefined;
  /** The limits that are in force. A `metered` service must have one hard limit, or more. */
  readonly limits?: readonly Limit[] | undefined;
  /** A limit that is not in force: the owner must set it. The gate fails until it is in `limits`. */
  readonly wanted?: Limit | undefined;
  /** The end of the plan, for a plan that ends on a date. The fields `billing`, `price` and `limits` give the cost before the end. */
  readonly ends?: PlanEnd | undefined;
  /** The proof of the record. Each record must have one, and a proof becomes too old. */
  readonly proof?: Proof | undefined;
  /** The steps of the owner in the account of the service, to set or to read a limit. */
  readonly steps?: readonly string[] | undefined;
}

/** The default count of days before the end of a plan from which the gate gives a warning. */
export const END_DAYS = 30;

/** A spend layer: the cost records of the parts of a stack. */
export interface SpendLayer {
  readonly schema: typeof SPEND_SCHEMA;
  /** The currency of each amount of the layer, as a code of ISO 4217, for example `USD`. */
  readonly currency: string;
  /** The kinds of the parts that can have a cost. Each part of one of these kinds must have a record. */
  readonly kinds: readonly string[];
  /** The largest age of a proof, in days. */
  readonly proofDays: number;
  /** The count of days before the end of a plan from which the gate gives a warning. The default is `END_DAYS`. */
  readonly endDays?: number | undefined;
  readonly services: readonly Service[];
}
