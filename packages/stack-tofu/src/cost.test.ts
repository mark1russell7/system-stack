import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  accountKey,
  accountStates,
  budgetsByPart,
  COST_LAYER_KEY,
  costSpace,
  evaluateCost,
  isZeroOrMore,
  PLANNED,
  PLANNED_OVER,
  PLANNED_ROOM,
  PLANNED_TOTAL,
  plannedTotal,
  resourceKey,
  UNKNOWN_COSTS,
  type Budget,
} from "./cost.ts";
import { TOFU_SCHEMA, type Provider, type Resource, type TofuLayer } from "./layer.ts";
import { SAMPLE_BUDGETS, SAMPLE_TOFU } from "./sample.ts";

const example: Provider = { name: "example", source: "example-org/example", part: "account" };
const west: Provider = { ...example, alias: "west", part: "account-west" };
const other: Provider = { name: "other", source: "example-org/other", part: "account-other" };
const layer = (...resources: Resource[]): TofuLayer => ({ schema: TOFU_SCHEMA, providers: [example, west, other], resources });
const thing = (name: string, cost?: number, more: Partial<Resource> = {}): Resource => ({ part: "host", type: "example_thing", name, ...(cost === undefined ? {} : { cost }), ...more });
const limit = (hardLimit?: number, part: string = "account"): Budget => ({ part, ...(hardLimit === undefined ? {} : { hardLimit }) });

describe("the keys and the small functions", () => {
  it("gives the key of an account node and of a resource node", () => {
    expect(accountKey("cloud-account")).toBe("account:cloud-account");
    expect(resourceKey("example_server.web")).toBe("resource:example_server.web");
  });

  it("tells if a number is finite and 0 or more", () => {
    for (const value of [0, 0.5, 7, 1e9]) expect(isZeroOrMore(value)).toBe(true);
    for (const value of [-0.01, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) expect(isZeroOrMore(value)).toBe(false);
  });

  it("keeps the first budget of each part", () => {
    expect([...budgetsByPart([limit(10), limit(20), limit(5, "b")])]).toEqual([
      ["account", limit(10)],
      ["b", limit(5, "b")],
    ]);
  });
});

describe("the programs of the planned cost", () => {
  const tree = costSpace(SAMPLE_TOFU, SAMPLE_BUDGETS);
  const account = accountKey("cloud-account");

  it("gives the planned cost of an account: the sum of the costs of its resources", () => {
    expect(evaluateCost(PLANNED, tree, account)).toEqual({ ok: true, value: 7 });
  });

  it("gives the count of the resources with no known cost", () => {
    expect(evaluateCost(UNKNOWN_COSTS, tree, account)).toEqual({ ok: true, value: 0 });
    const unknown = costSpace(layer(thing("a", 2), thing("b"), thing("c")));
    expect(evaluateCost(UNKNOWN_COSTS, unknown, accountKey("account"))).toEqual({ ok: true, value: 2 });
  });

  it("compares the planned cost with the hard limit", () => {
    expect(evaluateCost(PLANNED_OVER, tree, account)).toEqual({ ok: true, value: false });
    expect(evaluateCost(PLANNED_ROOM, tree, account)).toEqual({ ok: true, value: 3 });
  });

  it("gives an error value for an account with no hard limit", () => {
    const noLimit = costSpace(SAMPLE_TOFU);
    expect(evaluateCost(PLANNED_OVER, noLimit, account).ok).toBe(false);
    expect(evaluateCost(PLANNED_ROOM, noLimit, account).ok).toBe(false);
  });

  it("gives the planned cost of the layer: the sum of its accounts", () => {
    expect(evaluateCost(PLANNED_TOTAL, tree, COST_LAYER_KEY)).toEqual({ ok: true, value: 7 });
  });
});

describe("accountStates", () => {
  it("gives the state of the sample", () => {
    expect(accountStates(SAMPLE_TOFU, SAMPLE_BUDGETS)).toEqual([
      { part: "cloud-account", resources: ["example_disk.cloud-host", "example_firewall.cloud-host", "example_server.cloud-host"], planned: 7, unknown: 0, limit: 10, over: false, room: 3 },
    ]);
  });

  it("has no limit, no test and no room for an account with no budget", () => {
    expect(accountStates(layer(thing("a", 4)))).toEqual([{ part: "account", resources: ["example_thing.a"], planned: 4, unknown: 0 }]);
  });

  it("has no limit for a budget with no hard limit, and for a hard limit that is not a correct amount", () => {
    for (const budget of [limit(), limit(-1), limit(Number.NaN), limit(Number.POSITIVE_INFINITY)]) {
      expect(accountStates(layer(thing("a", 4)), [budget])).toEqual([{ part: "account", resources: ["example_thing.a"], planned: 4, unknown: 0 }]);
    }
  });

  it("is not over when the planned cost is equal to the hard limit", () => {
    expect(accountStates(layer(thing("a", 4), thing("b", 6)), [limit(10)])[0]).toMatchObject({ planned: 10, limit: 10, over: false, room: 0 });
  });

  it("is over when the planned cost is more than the hard limit", () => {
    expect(accountStates(layer(thing("a", 4), thing("b", 6.5)), [limit(10)])[0]).toMatchObject({ planned: 10.5, limit: 10, over: true, room: -0.5 });
    expect(accountStates(layer(thing("a", 1)), [limit(0)])[0]).toMatchObject({ planned: 1, limit: 0, over: true, room: -1 });
  });

  it("counts a resource with no cost, and a cost that is not a correct amount, as not known", () => {
    const states = accountStates(layer(thing("a", 4), thing("b"), thing("c", -2), thing("d", Number.NaN)), [limit(10)]);
    expect(states[0]).toMatchObject({ planned: 4, unknown: 3, over: false });
  });

  it("gives a planned cost of 0 for an account whose resources have no known cost", () => {
    expect(accountStates(layer(thing("a"), thing("b")), [limit(10)])[0]).toMatchObject({ planned: 0, unknown: 2, limit: 10, over: false, room: 10 });
  });

  it("counts each resource against the account of its provider configuration", () => {
    const states = accountStates(layer(thing("a", 1), thing("b", 2, { provider: "example.west" }), thing("c", 4, { type: "other_thing" }), thing("d", 8)), [limit(5), limit(1, "account-west")]);
    expect(states).toEqual([
      { part: "account", resources: ["example_thing.a", "example_thing.d"], planned: 9, unknown: 0, limit: 5, over: true, room: -4 },
      { part: "account-west", resources: ["example_thing.b"], planned: 2, unknown: 0, limit: 1, over: true, room: -1 },
      { part: "account-other", resources: ["other_thing.c"], planned: 4, unknown: 0 },
    ]);
  });

  it("counts a resource one time when two records have its address", () => {
    expect(accountStates(layer(thing("a", 3), thing("a", 100)))[0]).toMatchObject({ resources: ["example_thing.a"], planned: 3 });
  });

  it("does not count a resource that is a part of OpenTofu, and a resource with no provider configuration", () => {
    const states = accountStates(layer(thing("a", 3), thing("data", 50, { type: "terraform_data" }), thing("b", 60, { type: "missing_thing" }), thing("c", 70, { provider: "example.east" })));
    expect(states).toEqual([{ part: "account", resources: ["example_thing.a"], planned: 3, unknown: 0 }]);
  });

  it("gives no state for a layer with no resource of a provider", () => {
    expect(accountStates(layer())).toEqual([]);
    expect(accountStates(layer(thing("data", undefined, { type: "terraform_data" })))).toEqual([]);
  });
});

describe("plannedTotal", () => {
  it("gives the sum of the planned costs of the accounts", () => {
    expect(plannedTotal(SAMPLE_TOFU)).toBe(7);
    expect(plannedTotal(layer(thing("a", 1), thing("b", 2, { provider: "example.west" }), thing("c", 4, { type: "other_thing" }), thing("d")))).toBe(7);
  });

  it("gives 0 for a layer with no resource of a provider", () => {
    expect(plannedTotal(layer())).toBe(0);
  });
});

describe("the planned cost, for each layer", () => {
  const options = { seed: 20261116, numRuns: 200 };
  // Whole amounts, so a sum has no error of a float.
  const cost = fc.option(fc.integer({ min: 0, max: 1000 }), { nil: undefined });
  const record = fc.record({ cost, provider: fc.constantFrom(undefined, "example.west", "other") });
  const records = fc.array(record, { maxLength: 12 });
  const resources = (items: readonly { cost: number | undefined; provider: string | undefined }[]): Resource[] =>
    items.map((item, at) => thing(`r${String(at)}`, item.cost, item.provider === undefined ? {} : item.provider === "other" ? { type: "other_thing" } : { provider: item.provider }));
  const accountOf = (provider: string | undefined): string => (provider === undefined ? "account" : provider === "other" ? "account-other" : "account-west");

  it("is the sum of the known costs of the resources of each account", () => {
    fc.assert(
      fc.property(records, (items) => {
        const expected = new Map<string, { planned: number; unknown: number }>();
        for (const item of items) {
          const state = expected.get(accountOf(item.provider)) ?? { planned: 0, unknown: 0 };
          expected.set(accountOf(item.provider), { planned: state.planned + (item.cost ?? 0), unknown: state.unknown + (item.cost === undefined ? 1 : 0) });
        }
        const states = accountStates(layer(...resources(items)));
        expect(states.map((state) => [state.part, { planned: state.planned, unknown: state.unknown }])).toEqual([...expected]);
        expect(plannedTotal(layer(...resources(items)))).toBe(items.reduce((sum, item) => sum + (item.cost ?? 0), 0));
      }),
      options,
    );
  });

  it("is over only when the planned cost is more than the hard limit", () => {
    fc.assert(
      fc.property(records, fc.integer({ min: 0, max: 3000 }), (items, hardLimit) => {
        for (const state of accountStates(layer(...resources(items)), [limit(hardLimit), limit(hardLimit, "account-west"), limit(hardLimit, "account-other")])) {
          expect(state.over).toBe(state.planned > hardLimit);
          expect(state.room).toBe(hardLimit - state.planned);
        }
      }),
      options,
    );
  });
});
