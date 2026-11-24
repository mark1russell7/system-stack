import { unknownKinds } from "@mark1russell7/alerts";
import { describe, expect, it } from "vitest";
import { checkHazards, hasHazardError } from "./check.ts";
import { HAZARD_LIST, HAZARD_SOURCES, NO_COLLAPSE_LAW, NO_CYBER_LAW, NO_EVENT_LAW, NO_FOLLOW_LAW, NO_GEOMAGNETIC_LAW, NO_LAW } from "./data.ts";
import { EAGLEI_CAUSE_LAWS, EAGLEI_CAUSE_SOURCES, EAGLEI_GRID_LAW, EAGLEI_SOURCE } from "./eaglei-law.ts";
import { STORM_CLASSES } from "./storms.ts";
import { CLAIM_BASES, HAZARDS_SCHEMA, SUPPLY_PARTS, type Claim, type DurationLaw, type HazardList, type HazardSource } from "./hazard.ts";
import { supplyState } from "./case.ts";

/** The catastrophic cases, in the order of the list. */
const CATASTROPHIC = [
  "civic.ai-collapse",
  "security.nuclear-war",
  "cbrne.nuclear-detonation",
  "health.outbreak.pandemic",
  "infra.power.grid-collapse",
  "cyber.infrastructure-attack",
  "infra.supply-chain.food",
  "civic.economy.collapse",
  "security.civil-unrest",
  "security.armed-conflict",
  "cbrne.emp",
  "geo.space-weather.geomagnetic-storm",
];

const SOURCE: HazardSource = {
  id: "outages",
  title: "A dataset of outages",
  url: "https://data.example.net/outages",
  by: "An agency",
  license: "public-domain",
  terms: "https://data.example.net/terms",
  checked: "2026-11-21",
  regions: { scheme: "test-region", codes: ["A", "B"] },
};
const CURVE = [
  [0, 1],
  [1, 0.5],
  [3, 0],
] as const;
const LAW: DurationLaw = { read: true, source: "outages", fit: { family: "lognormal", method: "maximum likelihood", count: 40 }, scheme: "test-region", curves: { A: CURVE, B: CURVE } };

/** This function gives a list with one case that cuts the grid with a law. */
function withLaw(law: DurationLaw, source: HazardSource = SOURCE): HazardList {
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

  it("gives one warning for each cut with no law: each cut but the grid cuts of a power outage, of a physical attack and of the storm cases", () => {
    const cuts = HAZARD_LIST.hazards.flatMap((hazard) => hazard.cuts.map((cut) => ({ hazard: hazard.case, cut })));
    const laws = cuts.filter(({ cut }) => cut.duration.read);
    expect(laws.map(({ hazard, cut }) => `${hazard} ${cut.part}`)).toEqual([
      "infra.power.outage power.grid",
      "infra.power.physical-attack power.grid",
      "met.winter.storm power.grid",
      "met.heat.extreme power.grid",
      "met.tropical.hurricane power.grid",
      "met.flood power.grid",
      "met.tornado power.grid",
    ]);
    const noLaw = cuts.filter(({ hazard, cut }) => !cut.duration.read && !CATASTROPHIC.includes(hazard));
    expect(noLaw.every(({ cut }) => cut.duration === NO_LAW)).toBe(true);
    expect(checkHazards(HAZARD_LIST).filter((fault) => fault.code === "hazards-no-law")).toHaveLength(cuts.length - laws.length);
  });

  it("has a law of its own on the grid cut of each storm case, with a curve for each region of its source", () => {
    expect(Object.keys(EAGLEI_CAUSE_LAWS)).toEqual(Object.keys(STORM_CLASSES));
    for (const [name, law] of Object.entries(EAGLEI_CAUSE_LAWS)) {
      const source = EAGLEI_CAUSE_SOURCES[law.source];
      const grid = HAZARD_LIST.hazards.find((hazard) => hazard.case === name)?.cuts.find((cut) => cut.part === "power.grid");
      expect(grid?.duration).toBe(law);
      expect(HAZARD_SOURCES[law.source]).toBe(source);
      expect([law.source, law.scheme, source?.license, source?.id]).toEqual([`eaglei.${name}`, "us-state-fips", "cc-by-4.0", law.source]);
      expect(Object.keys(law.curves).sort()).toEqual([...(source?.regions?.codes ?? [])].sort());
      expect(law.fit.method).toContain("a storm event of the case");
      for (const code of Object.keys(law.curves)) expect(EAGLEI_SOURCE.regions?.codes).toContain(code);
    }
  });

  it("has the law of EAGLE-I on the grid cut, with a curve for each region of its source", () => {
    const law = EAGLEI_GRID_LAW;
    const codes = EAGLEI_SOURCE.regions?.codes ?? [];
    expect([law.source, law.scheme, EAGLEI_SOURCE.license, EAGLEI_SOURCE.id]).toEqual(["eaglei.outages", "us-state-fips", "cc-by-4.0", "eaglei.outages"]);
    expect(HAZARD_SOURCES["eaglei.outages"]).toBe(EAGLEI_SOURCE);
    expect(codes.length).toBeGreaterThanOrEqual(51);
    expect(Object.keys(law.curves).sort()).toEqual([...codes].sort());
  });

  it("cuts only reference parts, and uses each source of the table", () => {
    const parts = new Set(SUPPLY_PARTS.map((part) => part.id));
    const used = new Set(
      HAZARD_LIST.hazards.flatMap((hazard) => [
        ...hazard.examined,
        ...hazard.cuts.flatMap((cut) => [...cut.claims.flatMap((claim) => (claim.source === undefined ? [] : [claim.source])), ...(cut.duration.read ? [cut.duration.source] : [])]),
      ]),
    );
    expect(HAZARD_LIST.hazards.flatMap((hazard) => hazard.cuts.map((cut) => cut.part)).filter((part) => !parts.has(part))).toEqual([]);
    expect(Object.keys(HAZARD_SOURCES).filter((id) => !used.has(id))).toEqual([]);
  });

  it("has each catastrophic case once, and no cut for a case with no source that names one", () => {
    const codes = HAZARD_LIST.hazards.map((hazard) => hazard.case);
    expect(codes.filter((code) => CATASTROPHIC.includes(code))).toEqual(CATASTROPHIC);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of ["security.civil-unrest", "health.outbreak.pandemic"]) {
      const hazard = HAZARD_LIST.hazards.find((item) => item.case === code);
      expect(hazard?.cuts, code).toEqual([]);
      for (const part of SUPPLY_PARTS) expect(supplyState(hazard!, part.id).state).toBe("no-read");
    }
    // Each catastrophic case has a source read. A case with no cut has sources that name no cut.
    const examined = (code: string): readonly string[] | undefined => HAZARD_LIST.hazards.find((item) => item.case === code)?.examined;
    expect(examined("health.outbreak.pandemic")).toEqual(["ready.pandemic", "ready.financial-preparedness", "cdc.community-mitigation"]);
    expect(examined("security.civil-unrest")).toEqual(["ready.mass-gatherings", "cisa.physical-security", "fema.cpg-201"]);
    expect(HAZARD_LIST.hazards.filter((hazard) => CATASTROPHIC.includes(hazard.case) && hazard.examined.length === 0).map((hazard) => hazard.case)).toEqual([]);
  });

  it("gives war the cuts of the four sectors of the advisory AA24-038A, with no law", () => {
    const war = HAZARD_LIST.hazards.find((hazard) => hazard.case === "security.armed-conflict");
    expect(war?.examined).toEqual(["cisa.aa24-038a"]);
    expect(war?.cuts.map((cut) => cut.part)).toEqual(["power.grid", "phone.network", "road.local", "water.main", "sewer.main"]);
    for (const cut of war?.cuts ?? []) expect(cut.duration.read, cut.part).toBe(false);
  });

  it("gives a long collapse of the grid the cuts of a power outage, with no law of EAGLE-I", () => {
    const cutsOf = (code: string) => HAZARD_LIST.hazards.find((hazard) => hazard.case === code)?.cuts ?? [];
    const [grid, ...effects] = cutsOf("infra.power.grid-collapse");
    expect(grid?.part).toBe("power.grid");
    expect(grid?.claims.every((claim) => claim.definition === true)).toBe(true);
    expect(grid?.duration).toBe(NO_COLLAPSE_LAW);
    expect(effects.map(({ duration: _duration, ...cut }) => cut)).toEqual(cutsOf("infra.power.outage").slice(1).map(({ duration: _duration, ...cut }) => cut));
    for (const cut of effects) expect(cut.duration, cut.part).toBe(NO_FOLLOW_LAW);
    for (const cut of cutsOf("infra.power.outage").slice(1)) expect(cut.duration, cut.part).toBe(NO_LAW);
  });

  it("gives each cut of a catastrophic case no law, with the reason of the sources that it read", () => {
    const reasons = Object.fromEntries(
      HAZARD_LIST.hazards.filter((hazard) => CATASTROPHIC.includes(hazard.case)).flatMap((hazard) => hazard.cuts.map((cut) => [`${hazard.case} ${cut.part}`, cut.duration])),
    );
    const specific = {
      "infra.power.grid-collapse power.grid": NO_COLLAPSE_LAW,
      "cyber.infrastructure-attack power.grid": NO_CYBER_LAW,
      "geo.space-weather.geomagnetic-storm power.grid": NO_GEOMAGNETIC_LAW,
      "geo.space-weather.geomagnetic-storm water.main": NO_FOLLOW_LAW,
      "geo.space-weather.geomagnetic-storm sewer.main": NO_FOLLOW_LAW,
      "geo.space-weather.geomagnetic-storm road.local": NO_FOLLOW_LAW,
      "geo.space-weather.geomagnetic-storm fuel.retail": NO_FOLLOW_LAW,
      ...Object.fromEntries(["phone.network", "water.main", "road.local", "food.retail", "fuel.retail", "cash.retail"].map((part) => [`infra.power.grid-collapse ${part}`, NO_FOLLOW_LAW])),
    };
    for (const [key, law] of Object.entries(reasons)) expect(law, key).toBe(specific[key as keyof typeof specific] ?? NO_EVENT_LAW);
    expect(Object.keys(reasons)).toHaveLength(39);
    for (const law of [NO_EVENT_LAW, NO_FOLLOW_LAW, NO_COLLAPSE_LAW, NO_CYBER_LAW, NO_GEOMAGNETIC_LAW]) {
      expect(law.read).toBe(false);
      for (const sentence of law.reason.split(/(?<=\.) /u)) expect(sentence.split(" ").length, sentence).toBeLessThanOrEqual(25);
    }
  });

  it("examines the sources of the event records that the reasons name", () => {
    const examined = (code: string): readonly string[] | undefined => HAZARD_LIST.hazards.find((item) => item.case === code)?.examined;
    expect(examined("infra.power.grid-collapse")).toEqual(["ready.power-outages", "doe.maria-2017-10-23", "doe.maria-2018-02-21", "doe.oe-417"]);
    expect(examined("cyber.infrastructure-attack")).toEqual(["ready.cybersecurity", "cisa.ir-alert-h-16-056-01", "doe.oe-417"]);
    expect(examined("geo.space-weather.geomagnetic-storm")).toEqual(["ready.space-weather", "swpc.electric-power", "doe.oe-417"]);
    for (const id of ["doe.maria-2017-10-23", "doe.maria-2018-02-21", "cisa.ir-alert-h-16-056-01", "swpc.electric-power", "doe.oe-417"]) expect([HAZARD_SOURCES[id]?.license, HAZARD_SOURCES[id]?.terms], id).toEqual(["us-public-domain", expect.stringContaining("copyright.gov")]);
  });

  it("has a code of the alert taxonomy for each case, so that an alert can reach each case", () => {
    expect(unknownKinds(HAZARD_LIST.hazards.map((hazard) => hazard.case))).toEqual([]);
  });

  it("gives each claim of a source a basis of the set, and no basis to a claim of the definition", () => {
    const claims = HAZARD_LIST.hazards.flatMap((hazard) => hazard.cuts.flatMap((cut) => cut.claims));
    expect(CLAIM_BASES).toEqual(["told", "assessed"]);
    for (const claim of claims) {
      if (claim.definition === true) expect(claim.basis, claim.says).toBeUndefined();
      else expect(CLAIM_BASES, claim.says).toContain(claim.basis);
    }
    // Each basis of the set has a claim.
    expect(new Set(claims.flatMap((claim) => (claim.basis === undefined ? [] : [claim.basis])))).toEqual(new Set(CLAIM_BASES));
  });

  it("gives the basis assessed only to the claims of the sources that assess a risk", () => {
    const assessed = new Set(HAZARD_LIST.hazards.flatMap((hazard) => hazard.cuts.flatMap((cut) => cut.claims.flatMap((claim) => (claim.basis === "assessed" ? [claim.source] : [])))));
    expect([...assessed].sort()).toEqual(["cisa.aa24-038a", "cisa.emp", "dhs.ai-framework"]);
    const told = HAZARD_LIST.hazards.flatMap((hazard) => hazard.cuts.flatMap((cut) => cut.claims.flatMap((claim) => (claim.basis === "told" ? [claim.source] : []))));
    for (const source of assessed) expect(told, source).not.toContain(source);
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

  it("refuses a law whose source has a license that the guidebook does not know, or a license that permits no fact", () => {
    const unknown = "Public domain" as unknown as HazardSource["license"];
    expect(codes(withLaw(LAW, { ...SOURCE, license: unknown }))).toEqual(["hazards-license"]);
    expect(checkHazards(withLaw(LAW, { ...SOURCE, license: unknown }))[0]?.message).toContain("(unknown-license)");
    expect(codes(withLaw(LAW, { ...SOURCE, license: "link-only" }))).toEqual(["hazards-license"]);
    // The license of the test fixtures of the guidebook is not a real license, so a list of hazards refuses it.
    expect(codes(withLaw(LAW, { ...SOURCE, license: "invented" }))).toEqual(["hazards-license"]);
  });

  it("passes a law whose source has a license with a credit line", () => {
    expect(checkHazards(withLaw(LAW, { ...SOURCE, license: "cc-by-4.0", terms: "https://creativecommons.org/licenses/by/4.0/" }))).toEqual([]);
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

  it("refuses a claim or an examined id with no source, and a source that the source gate of the guidebook refuses", () => {
    expect(codes({ ...base, hazards: [{ ...hazard, examined: ["unknown"] }] })).toEqual(["hazards-source"]);
    expect(codes({ ...base, hazards: [{ ...hazard, cuts: [{ ...cut, claims: [{ source: "unknown", basis: "told", says: "A page tells it." }] }] }] })).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, url: "ftp://data.example.net" }))).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, terms: "the terms" }))).toEqual(["hazards-source"]);
    // The rules of the list: an HTTPS address, a publisher and a page of the terms.
    expect(codes(withLaw(LAW, { ...SOURCE, url: "http://data.example.net" }))).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, by: " " }))).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, by: undefined as unknown as string }))).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, terms: undefined as unknown as string }))).toEqual(["hazards-license"]);
    expect(codes(withLaw(LAW, { ...SOURCE, terms: "" }))).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, terms: "http://data.example.net/terms" }))).toEqual(["hazards-license"]);
    expect(codes(withLaw(LAW, { ...SOURCE, title: " " }))).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, checked: "21.11.2026" }))).toEqual(["hazards-source"]);
    expect(codes(withLaw(LAW, { ...SOURCE, updated: "2026-11-22" }))).toEqual(["hazards-source"]);
    const [fault] = checkHazards(withLaw(LAW, { ...SOURCE, url: "ftp://data.example.net" }));
    expect(fault).toMatchObject({ level: "error", at: "sources.outages" });
    expect(fault?.message).toMatch(/\(bad-url\)$/u);
  });

  it("refuses a source whose id is not its key in the table, and two sources with one id", () => {
    expect(codes(withLaw(LAW, { ...SOURCE, id: "other" }))).toEqual(["hazards-source"]);
    // The gate of the guidebook gets the keys, so a second source with the id of the first gives one finding at its own key.
    const twice = { ...base, sources: { outages: SOURCE, copy: SOURCE } };
    expect(checkHazards(twice).map((fault) => [fault.code, fault.at])).toEqual([["hazards-source", "sources.copy"]]);
  });

  it("passes a claim of a source with each basis of the set", () => {
    for (const basis of CLAIM_BASES) expect(codes({ ...base, hazards: [{ ...hazard, cuts: [{ ...cut, claims: [{ source: "outages", basis, says: "A page tells it." }] }] }] }), basis).toEqual([]);
  });

  it("refuses a claim of a source with no basis or a wrong basis, and a claim of the definition with a basis", () => {
    const withClaim = (claim: unknown): HazardList => ({ ...base, hazards: [{ ...hazard, cuts: [{ ...cut, claims: [claim as Claim] }] }] });
    expect(codes(withClaim({ source: "outages", says: "A page tells it." }))).toEqual(["hazards-source"]);
    expect(codes(withClaim({ source: "outages", basis: "rumor", says: "A page tells it." }))).toEqual(["hazards-source"]);
    expect(codes(withClaim({ source: "outages", basis: "", says: "A page tells it." }))).toEqual(["hazards-source"]);
    expect(codes(withClaim({ definition: true, basis: "told", says: "The case is a stop of the grid." }))).toEqual(["hazards-source"]);
    expect(checkHazards(withClaim({ source: "outages", basis: "rumor", says: "A page tells it." }))[0]?.message).toContain('"rumor"');
  });
});
