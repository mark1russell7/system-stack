import { describe, expect, it } from "vitest";
import { HARD_COUNT, IS_HARD, MONTH_MAX, NODE_KINDS, PLAN_MAX } from "./formulas.ts";
import { SPEND_SCHEMA, type Limit, type NextPlan, type Service, type SpendLayer } from "./layer.ts";
import { SAMPLE_ENDS, SAMPLE_SPEND } from "./sample.ts";
import { evaluateNext, evaluateService, firstServices, monthTotal, nextKey, serviceKey, serviceStates, spendSpace } from "./states.ts";
import { SAMPLE_STACK, STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { evaluate, ref, type Expr } from "@mark1russell7/vex";
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

describe("the plan after the end of a plan", () => {
  const ends = (service: Omit<Service, "part" | "ends">, next?: NextPlan): Service => ({ part: "a", ...service, ends: { date: "2026-12-01", ...(next === undefined ? {} : { next }) } });

  it("gives the cost of the plan before the end for a service that stops", () => {
    expect(stateOf(ends({ billing: "free" }))).toEqual({ part: "a", billing: "free", monthMax: 0 });
    expect(stateOf(ends({ billing: "fixed", price: 4 }))).toEqual({ part: "a", billing: "fixed", monthMax: 4 });
  });

  it("gives the larger of the cost before the end and the cost after it", () => {
    expect(stateOf(ends({ billing: "free" }, { billing: "fixed", price: 20 }))).toEqual({ part: "a", billing: "free", monthMax: 20 });
    expect(stateOf(ends({ billing: "fixed", price: 30 }, { billing: "fixed", price: 20 }))).toEqual({ part: "a", billing: "fixed", monthMax: 30 });
    expect(stateOf(ends({ billing: "fixed", price: 30 }, { billing: "free" }))).toEqual({ part: "a", billing: "fixed", monthMax: 30 });
    const metered: NextPlan = { billing: "metered", price: 5, limits: [{ kind: "alert", amount: 1 }, { kind: "provider", amount: 15 }, { kind: "prepaid", amount: 40 }] };
    expect(stateOf(ends({ billing: "free" }, metered))).toEqual({ part: "a", billing: "free", nextLimit: 15, monthMax: 20 });
  });

  it("has no bound when the cost after the end has no bound", () => {
    expect(stateOf(ends({ billing: "free" }, { billing: "metered" }))).toEqual({ part: "a", billing: "free" });
    expect(stateOf(ends({ billing: "free" }, { billing: "metered", limits: [{ kind: "alert", amount: 5 }] }))).toEqual({ part: "a", billing: "free" });
    expect(stateOf(ends({ billing: "fixed", price: 3 }, { billing: "metered", limits: [{ kind: "prepaid", amount: 5, recharge: true }] }))).toEqual({ part: "a", billing: "fixed" });
    expect(stateOf(ends({ billing: "free" }, { billing: "fixed" }))).toEqual({ part: "a", billing: "free" });
  });

  it("has no bound when the cost before the end has no bound", () => {
    expect(stateOf(ends({ billing: "metered" }, { billing: "free" }))).toEqual({ part: "a", billing: "metered" });
    expect(stateOf(ends({ billing: "metered" }, { billing: "metered", limits: [{ kind: "provider", amount: 5 }] }))).toEqual({ part: "a", billing: "metered", nextLimit: 5 });
  });

  it("keeps the limits of the two plans apart", () => {
    const service = ends({ billing: "metered", limits: [{ kind: "provider", amount: 9 }] }, { billing: "metered", limits: [{ kind: "provider", amount: 2 }, { kind: "code", amount: 1, stop: "x" }] });
    expect(stateOf(service)).toEqual({ part: "a", billing: "metered", hardLimit: 9, nextLimit: 1, monthMax: 9 });
    const tree = spendSpace(layer(service));
    expect(evaluateService(HARD_COUNT, tree, "a")).toEqual({ ok: true, value: 1 });
    expect(evaluateNext(HARD_COUNT, tree, "a")).toEqual({ ok: true, value: 2 });
    expect(evaluateNext(PLAN_MAX, tree, "a")).toEqual({ ok: true, value: 1 });
    expect(evaluateService(PLAN_MAX, tree, "a")).toEqual({ ok: true, value: 9 });
    expect(evaluateService(MONTH_MAX, tree, "a")).toEqual({ ok: true, value: 9 });
  });

  it("gives an error value for the plan after the end of a service that has none", () => {
    const tree = spendSpace(layer(ends({ billing: "free" }), { part: "b", billing: "free" }));
    expect(evaluateNext(PLAN_MAX, tree, "a").ok).toBe(false);
    expect(evaluateNext(PLAN_MAX, tree, "b").ok).toBe(false);
  });

  it("names a service with no bound after the end in the total, and adds the larger cost of each other service", () => {
    const total = monthTotal(layer(ends({ billing: "free" }, { billing: "metered" }), { part: "b", billing: "free", ends: { date: "2026-12-01", next: { billing: "fixed", price: 20 } } }, { part: "c", billing: "fixed", price: 3 }));
    expect(total).toEqual({ bounded: 23, open: ["a"] });
    expect(monthTotal(SAMPLE_ENDS)).toEqual({ bounded: 0, open: ["cloud-account"] });
  });

  it("has a node for the plan after the end, with its limits as children", () => {
    const tree = spendSpace(layer(ends({ billing: "free" }, { billing: "metered", price: 2, limits: [{ kind: "alert", amount: 1 }, { kind: "provider", amount: 2 }] })));
    const at = (program: Expr, origin: string): unknown => evaluate(program, { space: tree, origin, domains: [NumDomain, BoolDomain, TextDomain] });
    expect(nextKey("a")).toBe("next:a");
    expect(at(ref("kind"), "next:a")).toEqual({ ok: true, value: "next" });
    expect(at(ref("billing"), "next:a")).toEqual({ ok: true, value: "metered" });
    expect(at(ref("price"), "next:a")).toEqual({ ok: true, value: 2 });
    expect(at(IS_HARD, "next-limit:a:0")).toEqual({ ok: true, value: false });
    expect(at(IS_HARD, "next-limit:a:1")).toEqual({ ok: true, value: true });
    expect(NODE_KINDS).toEqual(["layer", "service", "limit", "next"]);
  });

  it("uses the plan after the end of the first record of a part", () => {
    const twice = layer({ part: "a", billing: "free" }, ends({ billing: "free" }, { billing: "metered" }));
    expect(serviceStates(twice)).toEqual([{ part: "a", billing: "free", monthMax: 0 }]);
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

describe("the limits with parts down", () => {
  const stack: Stack = {
    schema: STACK_SCHEMA,
    parts: [
      { id: "power", kind: "power" },
      { id: "program", kind: "service", needs: ["power"] },
      { id: "a", kind: "account" },
    ],
  };
  const stopBy = (stop?: string): Service => metered("a", { kind: "alert", amount: 1 }, { kind: "code", amount: 10, ...(stop === undefined ? {} : { stop }) });

  it("keeps a stop by code while its part works", () => {
    for (const down of [[], ["a"]]) {
      expect(serviceStates(layer(stopBy("program")), { stack, down })).toEqual([{ part: "a", billing: "metered", hardLimit: 10, monthMax: 10 }]);
    }
  });

  it("removes a stop by code when its part is down, or when a need of its part is down", () => {
    for (const down of [["program"], ["power"]]) {
      expect(serviceStates(layer(stopBy("program")), { stack, down })).toEqual([{ part: "a", billing: "metered" }]);
      expect(monthTotal(layer(stopBy("program")), { stack, down })).toEqual({ bounded: 0, open: ["a"] });
    }
  });

  it("removes a stop by code with no part, or with a part that is not in the stack", () => {
    expect(serviceStates(layer(stopBy()), { stack, down: [] })).toEqual([{ part: "a", billing: "metered" }]);
    expect(serviceStates(layer(stopBy("x")), { stack, down: [] })).toEqual([{ part: "a", billing: "metered" }]);
  });

  it("keeps the other kinds of limit, and the key of each limit", () => {
    const service = metered("a", { kind: "code", amount: 5, stop: "program" }, { kind: "provider", amount: 30 });
    expect(serviceStates(layer(service), { stack, down: ["power"] })).toEqual([{ part: "a", billing: "metered", hardLimit: 30, monthMax: 30 }]);
    const tree = spendSpace(layer(service), { stack, down: ["power"] });
    expect(evaluate(ref("amount"), { space: tree, origin: "limit:a:1", domains: [NumDomain] })).toEqual({ ok: true, value: 30 });
  });

  it("removes a stop by code of the plan after the end", () => {
    const service: Service = { part: "a", billing: "free", ends: { date: "2026-12-01", next: { billing: "metered", limits: [{ kind: "code", amount: 8, stop: "program" }] } } };
    expect(serviceStates(layer(service), { stack, down: [] })).toEqual([{ part: "a", billing: "free", nextLimit: 8, monthMax: 8 }]);
    expect(serviceStates(layer(service), { stack, down: ["program"] })).toEqual([{ part: "a", billing: "free" }]);
  });

  it("gives the sample: with the power of the home down, the cost of the call account has no bound", () => {
    expect(monthTotal(SAMPLE_SPEND, { stack: SAMPLE_STACK, down: ["home-power"] })).toEqual({ bounded: 0, open: ["cloud-account", "call-account"] });
    expect(monthTotal(SAMPLE_SPEND, { stack: SAMPLE_STACK, down: ["program-cloud"] })).toEqual(monthTotal(SAMPLE_SPEND));
  });
});
