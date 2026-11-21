import { SAMPLE_STACK, STACK_SCHEMA, type Stack } from "@mark1russell7/system-stack";
import { describe, expect, it } from "vitest";
import { SETUP_SCHEMA, type Profile, type SetupLayer } from "./layer.ts";
import { hostProfiles, profileOrder, profilesBefore, setupHosts } from "./order.ts";
import { SAMPLE_SETUP } from "./sample.ts";

const profile = (name: string, part: string, hosts: readonly string[] = ["h"]): Profile => ({ name, part, hosts, steps: [] });
const layer = (...profiles: Profile[]): SetupLayer => ({ schema: SETUP_SCHEMA, profiles });

// The parts: c needs b, b needs a. d needs nothing. x and y need each other.
const STACK: Stack = {
  schema: STACK_SCHEMA,
  parts: [
    { id: "h", kind: "host" },
    { id: "g", kind: "host" },
    { id: "a", kind: "service" },
    { id: "b", kind: "service", needs: ["a"] },
    { id: "c", kind: "service", needs: ["b"] },
    { id: "d", kind: "service" },
    { id: "x", kind: "service", needs: ["y"] },
    { id: "y", kind: "service", needs: ["x"] },
  ],
};

describe("setupHosts and hostProfiles", () => {
  it("gives each host once, in the order of its first profile", () => {
    expect(setupHosts(layer(profile("p", "a", ["g", "h"]), profile("q", "b", ["h", "k"])))).toEqual(["g", "h", "k"]);
  });

  it("gives the profiles of a host in the layer order", () => {
    const set = layer(profile("p", "a", ["g"]), profile("q", "b", ["h"]), profile("r", "c", ["g", "h"]));
    expect(hostProfiles(set, "g").map((item) => item.name)).toEqual(["p", "r"]);
    expect(hostProfiles(set, "none")).toEqual([]);
  });
});

describe("profilesBefore", () => {
  it("gives the profiles whose part a part needs, also through other parts", () => {
    expect(profilesBefore([profile("c", "c"), profile("b", "b"), profile("a", "a")], STACK)).toEqual([[1, 2], [2], []]);
  });

  it("gives no order to two profiles of one part", () => {
    expect(profilesBefore([profile("one", "a"), profile("two", "a")], STACK)).toEqual([[], []]);
  });
});

describe("profileOrder", () => {
  it("puts each profile after the profiles whose part its part needs", () => {
    const order = profileOrder(layer(profile("c", "c"), profile("b", "b"), profile("a", "a")), STACK, "h");
    expect(order).toEqual({ profiles: [profile("a", "a"), profile("b", "b"), profile("c", "c")], cycles: [] });
  });

  it("keeps the layer order where the needs give no order", () => {
    const order = profileOrder(layer(profile("d", "d"), profile("c", "c"), profile("a", "a"), profile("d2", "d")), STACK, "h");
    expect(order.profiles.map((item) => item.name)).toEqual(["d", "a", "c", "d2"]);
  });

  it("orders only the profiles of the host", () => {
    const order = profileOrder(layer(profile("c", "c", ["h"]), profile("b", "b", ["g"])), STACK, "h");
    expect(order.profiles.map((item) => item.name)).toEqual(["c"]);
  });

  it("names each cycle, and gives no order then", () => {
    const order = profileOrder(layer(profile("d", "d"), profile("y", "y"), profile("x", "x")), STACK, "h");
    expect(order).toEqual({ profiles: [], cycles: [["y", "x"]] });
  });

  it("gives the base profile of the sample first", () => {
    expect(profileOrder(SAMPLE_SETUP, SAMPLE_STACK, "cloud-host").profiles.map((item) => item.name)).toEqual(["base", "program"]);
  });
});
