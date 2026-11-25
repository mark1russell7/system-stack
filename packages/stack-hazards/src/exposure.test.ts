import { checkSources } from "@mark1russell7/guidebook";
import { describe, expect, it } from "vitest";
import {
  boxAround,
  DAM_LAYER,
  damExposure,
  damRequest,
  damsOf,
  EXPOSURE_SOURCES,
  METERS_PER_MILE,
  nuclearExposure,
  REACTOR_LAYER,
  reactorRequest,
  reactorsOf,
  WILDFIRE_CLASSES,
  wildfireExposure,
  wildfireRequest,
  type Dam,
  type Reactor,
} from "./exposure.ts";

// A made-up site. The fixtures are synthetic replies in the shape of the ArcGIS REST replies.
const SITE = { lat: 40, lon: -100 };
const UA = "exposure-test/0.0";
/** The miles of 1 degree of latitude, approximately. */
const DEGREE_MILES = 69.1;

describe("the sources", () => {
  it("pass the source gate of the guidebook", () => {
    const findings = checkSources(Object.values(EXPOSURE_SOURCES));
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
  });
  it("name each source of a layer", () => {
    for (const layer of [REACTOR_LAYER, DAM_LAYER]) expect(EXPOSURE_SOURCES[layer.source]).toBeDefined();
  });
});

describe("the requests", () => {
  it("carry the user agent of the caller", () => {
    expect(wildfireRequest(SITE, UA).headers["user-agent"]).toBe(UA);
    expect(() => reactorRequest(" ")).toThrow(RangeError);
  });
  it("ask for no name and no owner of a dam", () => {
    const url = new URL(damRequest(SITE, 1000, UA).url);
    const fields = url.searchParams.get("outFields")?.split(",") ?? [];
    expect(fields).toEqual([...DAM_LAYER.fields]);
    expect(fields.some((f) => /NAME|OWNER/.test(f))).toBe(false);
    expect(new URL(reactorRequest(UA).url).searchParams.get("outFields")).not.toMatch(/owner/);
  });
  it("give the box of the circle", () => {
    const box = boxAround(SITE, 10_000);
    expect(box.south).toBeLessThan(SITE.lat);
    expect(box.north).toBeGreaterThan(SITE.lat);
    expect(box.west).toBeLessThan(SITE.lon);
    expect(box.east).toBeGreaterThan(SITE.lon);
    expect(() => boxAround(SITE, 0)).toThrow(RangeError);
  });
});

describe("wildfireExposure", () => {
  it("reads the class of the cell", () => {
    expect(wildfireExposure({ value: "4" })).toMatchObject({ read: true, value: 4, class: "high" });
    expect(wildfireExposure({ value: 6 })).toMatchObject({ read: true, class: "non-burnable" });
    expect(WILDFIRE_CLASSES).toHaveLength(7);
  });
  it("gives a no read for no data, a bad value and an error", () => {
    expect(wildfireExposure({ value: "NoData" }).read).toBe(false);
    expect(wildfireExposure({ value: "8" }).read).toBe(false);
    expect(wildfireExposure({ error: { code: 500, message: "down" } })).toMatchObject({ read: false, reason: "The server gave an error: down." });
    expect(wildfireExposure("text").read).toBe(false);
  });
});

describe("the nuclear plants", () => {
  const reply = {
    features: [
      { attributes: { power_plant: "Plant A", reactor_name: "A 1", latitude: 40.1, longitude: -100, status: "Online, Full Capacity" } },
      { attributes: { power_plant: "Plant A", reactor_name: "A 2", latitude: 40.11, longitude: -100, status: "Offline" } },
      { attributes: { power_plant: "Plant B", reactor_name: "B 1", latitude: 40.5, longitude: -100, status: "Online, Reduced Capacity" } },
      { attributes: { power_plant: "Plant C", reactor_name: "C 1", latitude: 40.01, longitude: -100, status: null } },
      { attributes: { power_plant: "Plant D", reactor_name: "D 1", latitude: null, longitude: -100, status: "Offline" } },
    ],
  };
  it("reads the reactors with a point", () => {
    const reactors = reactorsOf(reply) as Reactor[];
    expect(reactors.map((r) => r.unit)).toEqual(["A 1", "A 2", "B 1", "C 1"]);
    expect(reactors.map((r) => r.reported)).toEqual([true, true, true, false]);
  });
  it("gives the plume zone for a plant within 10 miles, and skips the unreported reactors", () => {
    const exposure = nuclearExposure(SITE, reactorsOf(reply) as Reactor[]);
    expect(exposure.zone).toBe("plume");
    expect(exposure.nearest?.plant).toBe("Plant A");
    expect(exposure.nearest?.miles).toBeCloseTo(0.1 * DEGREE_MILES, 0);
    expect(exposure.within.map((p) => p.plant)).toEqual(["Plant A", "Plant B"]);
    expect(exposure.unreported).toBe(1);
  });
  it("gives the ingestion zone and the outside", () => {
    const at = (lat: number): Reactor[] => [{ plant: "P", unit: "P 1", lat, lon: -100, reported: true }];
    expect(nuclearExposure(SITE, at(40.3)).zone).toBe("ingestion");
    expect(nuclearExposure(SITE, at(41)).zone).toBe("outside");
    expect(nuclearExposure(SITE, []).nearest).toBeNull();
  });
  it("gives a no read for an error reply", () => {
    expect(reactorsOf({ error: { message: "Token Required" } })).toMatchObject({ read: false });
  });
});

describe("the dams", () => {
  const dam = (id: string, lat: number, hazard: string | null): Record<string, unknown> => ({
    attributes: { NIDID: id, HAZARD_POTENTIAL: hazard, LATITUDE: lat, LONGITUDE: -100, CONDITION_ASSESSMENT: "Fair", EAP_PREPARED: 1700000000000, NID_STORAGE: 120, NID_HEIGHT: 30, RIVER_OR_STREAM: "A creek" },
  });
  const reply = { features: [dam("XX001", 40.01, "High"), dam("XX002", 40.02, "Significant"), dam("XX003", 40.03, "Undetermined"), dam("XX004", 40.5, "High"), dam("XX005", 40.005, null)] };
  it("reads each dam with no name", () => {
    const dams = damsOf(reply) as Dam[];
    expect(dams).toHaveLength(5);
    expect(dams[0]).toMatchObject({ id: "XX001", hazard: "high", eap: "2023-11-14", heightFt: 30 });
    expect(Object.keys(dams[0] ?? {})).not.toContain("name");
  });
  it("counts the dams in the radius and lists the high hazard dams", () => {
    const exposure = damExposure(SITE, damsOf(reply) as Dam[], 5 * METERS_PER_MILE);
    expect(exposure.counts).toEqual({ high: 1, significant: 1, low: 0, undetermined: 1, none: 1 });
    expect(exposure.high.map((d) => d.id)).toEqual(["XX001"]);
    expect(exposure.high[0]?.meters).toBeGreaterThan(1000);
  });
  it("gives a no read for a part of the features", () => {
    expect(damsOf({ features: [], exceededTransferLimit: true })).toMatchObject({ read: false });
  });
});
