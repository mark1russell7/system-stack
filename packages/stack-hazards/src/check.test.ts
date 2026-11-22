import { describe, expect, it } from "vitest";
import { checkHazards, hasHazardError } from "./check.ts";
import { HAZARD_LIST, HAZARD_SOURCES, NO_LAW } from "./data.ts";
import { EAGLEI_GRID_LAW, EAGLEI_SOURCE } from "./eaglei-law.ts";
import { HAZARDS_SCHEMA, SUPPLY_PARTS, type DurationLaw, type HazardList, type Source } from "./hazard.ts";

const SOURCE: Source = {
  name: "A dataset of outages",
  url: "https://data.example.net/outages",
  publisher: "An agency",
  license: { name: "Public domain", url: "https://data.example.net/terms" },
  read: "2026-11-21",
  regions: { scheme: "test-region", codes: ["A", "B"] },
};
const CURVE = [
  [0, 1],
  [1, 0.5],
  [3, 0],
] as const;
const LAW: DurationLaw = { read: true, source: "outages", fit: { family: "lognormal", method: "maximum likelihood", count: 40 }, scheme: "test-region", curves: { A: CURVE, B: CURVE } };

/** This function gives a list with one case that cuts the grid with a law. */
function withLaw(law: DurationLaw, source: Source = SOURCE): HazardList {
  return {
    schema: HAZARDS_SCHEMA,
    sources: { outages: source },
    hazards: [{ case: "infra.power.outage", title: "Power outage", examined: ["outages"], cuts: [{ part: "power.grid", title: "No power", claims: [{ definition: true, says: "The case is a stop of the grid." }], duration: law }] }],
  };
}

const codes = (list: HazardList): string[] => checkHazards(list).map((fault) => fault.code);

describe("the gate of the reference data", () => {
  it("passes: each cut has a claim, and each source has a license", () => {
    const faults = checkHazards(HAZARD_LIST);
    expect(faults.filter((fault) => fault.level === "error")).toEqual([]);
    expect(hasHazardError(faults)).toBe(false);
  });

  it("gives one warning for each cut with no law: each cut but the grid cut of a power outage", () => {
    const cuts = HAZARD_LIST.hazards.flatMap((hazard) => hazard.cuts.map((cut) => ({ hazard: hazard.case, cut })));
    const laws = cuts.filter(({ cut }) => cut.duration !== NO_LAW);
    expect(laws.map(({ hazard, cut }) => `${hazard} ${cut.part}`)).toEqual(["infra.power.outage power.grid"]);
    expect(checkHazards(HAZARD_LIST).filter((fault) => fault.code === "hazards-no-law")).toHaveLength(cuts.length - 1);
  });

  it("has the law of EAGLE-I on the grid cut, with a curve for each region of its source", () => {
    const law = EAGLEI_GRID_LAW;
    const codes = EAGLEI_SOURCE.regions?.codes ?? [];
    expect([law.source, law.scheme, EAGLEI_SOURCE.license.name]).toEqual(["eaglei.outages", "us-state-fips", "CC BY 4.0"]);
    expect(HAZARD_SOURCES["eaglei.outages"]).toBe(EAGLEI_SOURCE);
    expect(codes.length).toBeGreaterThanOrEqual(51);
    expect(Object.keys(law.curves).sort()).toEqual([...codes].sort());
  });

  it("cuts only reference parts, and uses each source of the table", () => {
    const parts = new Set(SUPPLY_PARTS.map((part) => part.id));
    const used = new Set(HAZARD_LIST.hazards.flatMap((hazard) => [...hazard.examined, ...hazard.cuts.flatMap((cut) => cut.claims.flatMap((claim) => (claim.source === undefined ? [] : [claim.source])))]));
    expect(HAZARD_LIST.hazards.flatMap((hazard) => hazard.cuts.map((cut) => cut.part)).filter((part) => !parts.has(part))).toEqual([]);
    expect(Object.keys(HAZARD_SOURCES).filter((id) => !used.has(id))).toEqual([]);
  });

  it("has each source of a claim in the list examined of its case", () => {
    for (const hazard of HAZARD_LIST.hazards) {
      for (const cut of hazard.cuts) for (const claim of cut.claims) if (claim.source !== undefined) expect(hazard.examined).toContain(claim.source);
    }
  });
});

describe("the gate of a law", () => {
  it("passes a law with a source, a license and a curve for each region of its source", () => {
    expect(checkHazards(withLaw(LAW))).toEqual([]);
  });

  it("refuses a law with no source", () => {
    expect(codes(withLaw({ ...LAW, source: "unknown" }))).toEqual(["hazards-source"]);
  });

  it("refuses a law whose source has no license", () => {
    expect(codes(withLaw(LAW, { ...SOURCE, license: { name: "", url: "" } }))).toEqual(["hazards-license", "hazards-license"]);
    expect(codes(withLaw(LAW, { ...SOURCE, license: { name: "Public domain", url: " " } }))).toContain("hazards-license");
  });

  it("refuses a law of one chosen region: it must cover each region of its source", () => {
    expect(codes(withLaw({ ...LAW, curves: { A: CURVE } }))).toEqual(["hazards-law-region"]);
    expect(codes(withLaw({ ...LAW, scheme: "other" }))).toEqual(["hazards-law-region"]);
    const { regions: _regions, ...noRegions } = SOURCE;
    expect(codes(withLaw(LAW, noRegions))).toEqual(["hazards-law-region"]);
  });

  it("refuses a fit with no count and a curve with a wrong form", () => {
    expect(codes(withLaw({ ...LAW, fit: { ...LAW.fit, count: 0 } }))).toEqual(["hazards-fit"]);
    expect(
      codes(
        withLaw({
          ...LAW,
          curves: {
            A: CURVE,
            B: [
              [0, 1],
              [2, 0.5],
            ],
          },
        }),
      ),
    ).toEqual(["hazards-curve"]);
  });
});

describe("the gate of the cuts and the sources", () => {
  const base = withLaw(LAW);
  const hazard = base.hazards[0]!;
  const cut = hazard.cuts[0]!;

  it("refuses a case two times, a part two times, a part that is not a reference part and a cut with no claim", () => {
    expect(codes({ ...base, hazards: [hazard, hazard] })).toEqual(["hazards-twice"]);
    expect(codes({ ...base, hazards: [{ ...hazard, cuts: [cut, cut] }] })).toEqual(["hazards-twice"]);
    expect(codes({ ...base, hazards: [{ ...hazard, cuts: [{ ...cut, part: "grid" }] }] })).toEqual(["hazards-part-unknown"]);
    expect(codes({ ...base, hazards: [{ ...hazard, cuts: [{ ...cut, claims: [] }] }] })).toEqual(["hazards-no-claim"]);
  });

  it("refuses a claim or an examined id with no source, and a source with no HTTPS URL or a wrong date", () => {
    expect(codes({ ...base, hazards: [{ ...hazard, examined: ["unknown"] }] })).toEqual(["hazards-source"]);
    expect(codes({ ...base, hazards: [{ ...hazard, cuts: [{ ...cut, claims: [{ source: "unknown", says: "A page tells it." }] }] }] })).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, url: "http://data.example.net" }))).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, read: "21.11.2026" }))).toEqual(["hazards-source"]);
  });
});
