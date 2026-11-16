import { describe, expect, it } from "vitest";
import { HARD_COUNT, IS_HARD } from "./formulas.ts";
import { SPEND_SCHEMA, type Limit, type Service, type SpendLayer } from "./layer.ts";
import { SAMPLE_SPEND } from "./sample.ts";
import { evaluateService, firstServices, monthTotal, serviceKey, serviceStates, spendSpace } from "./states.ts";
import { evaluate } from "@mark1russell7/vex";
import { BoolDomain, NumDomain, TextDomain } from "@mark1russell7/vex-domains";

const layer = (...services: Service[]): SpendLayer => ({ schema: SPEND_SCHEMA, currency: "USD", kinds: [], proofDays: 90, services });
const metered = (part: string, ...limits: Limit[]): Service => ({ part, billing: "metered", limits });
const stateOf = (service: Service): unknown => serviceStates(layer(service))[0];

describe("the hard limit of a service", () => {
  it("counts a limit of the provider, a stop by code and a prepaid balance", () => {
    for (const kind of ["provider", "code", "prepaid"] as const) {
      expect(stateOf(metered("a", { kind, amount: 7 }))).toEqual({ part: "a", billing: "metered", hardLimit: 7, monthMax: 7 });
    }
  });

  it("does not count an alert, and does not count a balance with automatic recharge", () => {
    expect(stateOf(metered("a", { kind: "alert", amount: 7 }))).toEqual({ part: "a", billing: "metered" });
    expect(stateOf(metered("a", { kind: "prepaid", amount: 7, recharge: true }))).toEqual({ part: "a", billing: "metered" });
    expect(stateOf(metered("a", { kind: "prepaid", amount: 7, recharge: false }))).toEqual({ part: "a", billing: "metered", hardLimit: 7, monthMax: 7 });
  });

  it("is the smallest amount of the hard limits", () => {
    const service = metered("a", { kind: "alert", amount: 1 }, { kind: "prepaid", amount: 20 }, { kind: "code", amount: 10, stop: "x" }, { kind: "provider", amount: 30 });
    expect(stateOf(service)).toEqual({ part: "a", billing: "metered", hardLimit: 10, monthMax: 10 });
    const tree = spendSpace(layer(service));
    expect(evaluateService(HARD_COUNT, tree, "a")).toEqual({ ok: true, value: 3 });
  });

  it("tells for each limit node if it is hard", () => {
    const tree = spendSpace(layer(metered("a", { kind: "alert", amount: 1 }, { kind: "provider", amount: 2 })));
    const at = (origin: string): unknown => evaluate(IS_HARD, { space: tree, origin, domains: [NumDomain, BoolDomain, TextDomain] });
    expect(at("limit:a:0")).toEqual({ ok: true, value: false });
    expect(at("limit:a:1")).toEqual({ ok: true, value: true });
  });
});

describe("the largest cost of a service in a month", () => {
  it("is 0 for a free service", () => {
    expect(stateOf({ part: "a", billing: "free" })).toEqual({ part: "a", billing: "free", monthMax: 0 });
  });

  it("is the price for a fixed service, and a fixed service with no price has none", () => {
    expect(stateOf({ part: "a", billing: "fixed", price: 4.5 })).toEqual({ part: "a", billing: "fixed", monthMax: 4.5 });
    expect(stateOf({ part: "a", billing: "fixed" })).toEqual({ part: "a", billing: "fixed" });
  });

  it("does not add a limit to a fixed price", () => {
    expect(stateOf({ part: "a", billing: "fixed", price: 4, limits: [{ kind: "provider", amount: 9 }] })).toEqual({ part: "a", billing: "fixed", hardLimit: 9, monthMax: 4 });
  });

  it("is the price plus the hard limit for a metered service", () => {
    expect(stateOf({ part: "a", billing: "metered", price: 2, limits: [{ kind: "provider", amount: 9 }] })).toEqual({ part: "a", billing: "metered", hardLimit: 9, monthMax: 11 });
  });

  it("has no bound for a metered service with no hard limit", () => {
    expect(stateOf({ part: "a", billing: "metered", price: 2 })).toEqual({ part: "a", billing: "metered" });
  });

  it("does not use a wanted limit, because it is not in force", () => {
    expect(stateOf({ part: "a", billing: "metered", wanted: { kind: "provider", amount: 9 } })).toEqual({ part: "a", billing: "metered" });
  });
});

describe("monthTotal", () => {
  it("adds the largest costs, and names each service with no bound", () => {
    const total = monthTotal(layer({ part: "a", billing: "fixed", price: 4.5 }, metered("b", { kind: "code", amount: 10, stop: "x" }), metered("c"), { part: "d", billing: "free" }, metered("e", { kind: "alert", amount: 3 })));
    expect(total).toEqual({ bounded: 14.5, open: ["c", "e"] });
  });

  it("gives 0 and no open service for an empty layer", () => {
    expect(monthTotal(layer())).toEqual({ bounded: 0, open: [] });
  });

  it("gives the total of the sample: the cloud account has no bound", () => {
    expect(monthTotal(SAMPLE_SPEND)).toEqual({ bounded: 10, open: ["cloud-account"] });
  });

  it("keeps a colon in the id of a part", () => {
    expect(monthTotal(layer(metered("a:b")))).toEqual({ bounded: 0, open: ["a:b"] });
  });
});

describe("spendSpace", () => {
  it("uses the first record of a part", () => {
    const twice = layer({ part: "a", billing: "fixed", price: 1 }, { part: "a", billing: "fixed", price: 2 });
    expect(firstServices(twice).map((service) => service.price)).toEqual([1]);
    expect(serviceStates(twice)).toEqual([{ part: "a", billing: "fixed", monthMax: 1 }]);
    expect(monthTotal(twice)).toEqual({ bounded: 1, open: [] });
  });

  it("gives the key of a service", () => {
    expect(serviceKey("a")).toBe("service:a");
  });
});
