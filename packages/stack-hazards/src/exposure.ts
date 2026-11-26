import { bboxOfPoints, destinationMeters, distanceMeters, latLon, type BBox } from "@mark1russell7/geo";
import { readNumber, readRecord, readText } from "@mark1russell7/optional/read";
import type { HazardSource } from "./hazard.ts";

// The exposure of a site to a hazard case: a read of an official layer at a point, as a typed value with its source.
// The functions give the requests and read the replies. The caller sends each request, for example through polite-crawler.
// Each function is pure. A reply that the function cannot read gives a no read, not a pass.

/** A point of a site, in WGS84 degrees. */
export interface SitePoint {
  readonly lat: number;
  readonly lon: number;
}

/** A request to the server of a layer. The caller sends it. The header `user-agent` is the value that the caller gives. */
export interface ExposureRequest {
  readonly method: "GET";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: null;
}

/**
 * An official layer of a hazard at a point. The field `fields` is the list of the fields that the request asks for.
 * The list has no field with the name of an owner or an address.
 */
export interface ExposureLayer {
  /** The code of the hazard case of the layer, for example `fire.wildfire`. */
  readonly case: string;
  /** The address of the ArcGIS REST layer. */
  readonly url: string;
  readonly fields: readonly string[];
  /** The id of the source in `EXPOSURE_SOURCES`. */
  readonly source: string;
}

/** No read of an exposure: the reply has an error or a wrong shape, or the layer has no value at the point. */
export interface NoExposure {
  readonly read: false;
  readonly case: string;
  /** The reason, in plain words. */
  readonly reason: string;
  /** The address of the layer. */
  readonly source: string;
}

const READ = "2026-11-25";
const FEDERAL_TERMS = "https://www.copyright.gov/title17/92chap1.html#105";

/** The sources of the exposure layers, by id. Each value of an exposure keeps the address of its layer. */
export const EXPOSURE_SOURCES: Readonly<Record<string, HazardSource>> = {
  "usfs.whp-2023": {
    id: "usfs.whp-2023",
    title: "Wildfire Hazard Potential for the United States (270-m), version 2023, classified",
    url: "https://doi.org/10.2737/RDS-2015-0047-4",
    by: "USDA Forest Service, Rocky Mountain Research Station (Dillon 2023)",
    license: "cc0",
    terms: "https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WildfireHazardPotentialClassified/ImageServer/info/metadata",
    note: "The Forest Service waives copyright through CC0. The data are not a forecast and not a legal document.",
    updated: "2024-07-17",
    checked: READ,
  },
  "fema.reactor-status": {
    id: "fema.reactor-status",
    title: "Nuclear Plant Power Reactor Status",
    url: "https://gis.fema.gov/arcgis/rest/services/Partner/Nuclear_Plant_Power_Reactor_Status/FeatureServer/0",
    by: "FEMA, from the daily power reactor status reports of the NRC",
    license: "us-public-domain",
    terms: FEDERAL_TERMS,
    checked: READ,
  },
  "nrc.epz": {
    id: "nrc.epz",
    title: "10 CFR 50.47(c)(2): the emergency planning zones of a nuclear power plant",
    url: "https://www.ecfr.gov/current/title-10/chapter-I/part-50/section-50.47",
    by: "U.S. Nuclear Regulatory Commission (eCFR)",
    license: "us-public-domain",
    terms: FEDERAL_TERMS,
    checked: READ,
  },
  "usace.nid": {
    id: "usace.nid",
    title: "National Inventory of Dams, public service",
    url: "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0",
    by: "U.S. Army Corps of Engineers",
    license: "us-public-domain",
    terms: FEDERAL_TERMS,
    note: "The hazard potential tells the result of a failure, not the condition of the dam.",
    checked: READ,
  },
};

/** This function gives the query string of the parameters, in their order. */
const query = (params: Readonly<Record<string, string>>): string =>
  Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

/** This function gives a GET request with the user agent of the caller. */
function request(url: string, userAgent: string): ExposureRequest {
  if (userAgent.trim() === "") throw new RangeError("The user agent is empty.");
  return { method: "GET", url, headers: { "user-agent": userAgent, accept: "application/json" }, body: null };
}

/** This function gives the reason of an ArcGIS error reply, or `undefined` for a reply with no error. */
function errorOf(reply: unknown): string | undefined {
  const body = readRecord(reply);
  if (body === undefined) return "The reply is not a JSON object.";
  const error = readRecord(body["error"]);
  if (error === undefined) return undefined;
  const message = typeof error["message"] === "string" ? error["message"] : "no message";
  return `The server gave an error: ${message}.`;
}

/** This function gives the attribute records of the features of an ArcGIS query reply, or the reason of a no read. */
function featuresOf(reply: unknown): readonly Readonly<Record<string, unknown>>[] | string {
  const error = errorOf(reply);
  if (error !== undefined) return error;
  const body = readRecord(reply) ?? {};
  if (body["exceededTransferLimit"] === true) return "The server gave only a part of the features. Use a smaller radius.";
  const features = body["features"];
  if (!Array.isArray(features)) return "The reply has no list of features.";
  return features.flatMap((feature) => {
    const attributes = readRecord(readRecord(feature)?.["attributes"]);
    return attributes === undefined ? [] : [attributes];
  });
}

/** This function gives the meters from the site to a point. */
const metersTo = (site: SitePoint, lat: number, lon: number): number => distanceMeters(latLon(site.lat, site.lon), latLon(lat, lon));

/** The meters of one statute mile. */
export const METERS_PER_MILE = 1609.344;

/** This function gives the box of a circle around the point, in degrees. */
export function boxAround(point: SitePoint, radiusMeters: number): BBox {
  if (!(radiusMeters > 0) || !Number.isFinite(radiusMeters)) throw new RangeError(`The radius ${radiusMeters} is not a finite number above 0.`);
  const center = latLon(point.lat, point.lon);
  const box = bboxOfPoints([0, 90, 180, 270].map((bearing) => destinationMeters(center, bearing, radiusMeters)));
  if (box === undefined) throw new RangeError("The box has no points.");
  return box;
}

// The wildfire hazard potential.

/** The layer of the classified wildfire hazard potential (WHP 2023) of the Forest Service: an image service of 270 m cells. */
export const WILDFIRE_LAYER: ExposureLayer = {
  case: "fire.wildfire",
  url: "https://imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation/USFS_EDW_RMRS_WildfireHazardPotentialClassified/ImageServer",
  fields: [],
  source: "usfs.whp-2023",
};

/**
 * The classes of the wildfire hazard potential, in the order of the cell values 1 to 7. The legend of the image service gives these labels.
 * The classes 1 to 5 are the five classes of WHP. The class `non-burnable` and the class `water` have no hazard value.
 */
export const WILDFIRE_CLASSES: readonly ["very-low", "low", "moderate", "high", "very-high", "non-burnable", "water"] = [
  "very-low",
  "low",
  "moderate",
  "high",
  "very-high",
  "non-burnable",
  "water",
];

/** A class of the wildfire hazard potential. */
export type WildfireClass = (typeof WILDFIRE_CLASSES)[number];

/** The exposure of a site to wildfire: the class of the cell at the point. */
export interface WildfireExposure {
  readonly read: true;
  readonly case: string;
  /** The value of the cell, from 1 to 7. */
  readonly value: number;
  readonly class: WildfireClass;
  /** The address of the layer. */
  readonly source: string;
}

/** This function gives the request of the class of the cell at the point: an `identify` of the image service. */
export function wildfireRequest(point: SitePoint, userAgent: string): ExposureRequest {
  const geometry = JSON.stringify({ x: point.lon, y: point.lat, spatialReference: { wkid: 4326 } });
  const params = { f: "json", geometryType: "esriGeometryPoint", geometry, returnGeometry: "false", returnCatalogItems: "false" };
  return request(`${WILDFIRE_LAYER.url}/identify?${query(params)}`, userAgent);
}

/** This function reads the reply of `wildfireRequest`. A cell with no data, or a value out of 1 to 7, gives a no read. */
export function wildfireExposure(reply: unknown): WildfireExposure | NoExposure {
  const no = (reason: string): NoExposure => ({ read: false, case: WILDFIRE_LAYER.case, reason, source: WILDFIRE_LAYER.url });
  const error = errorOf(reply);
  if (error !== undefined) return no(error);
  const raw = readRecord(reply)?.["value"];
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : readNumber(raw);
  const label = value !== undefined && Number.isInteger(value) ? WILDFIRE_CLASSES[value - 1] : undefined;
  if (value === undefined || label === undefined) return no(`The layer has no class at the point (the value is ${JSON.stringify(raw ?? null)}).`);
  return { read: true, case: WILDFIRE_LAYER.case, value, class: label, source: WILDFIRE_LAYER.url };
}

// The nuclear power plants.

/** The layer of the power reactors with their status from the NRC. The request asks for no field of the owner or the operator. */
export const REACTOR_LAYER: ExposureLayer = {
  case: "cbrne.radiological",
  url: "https://gis.fema.gov/arcgis/rest/services/Partner/Nuclear_Plant_Power_Reactor_Status/FeatureServer/0",
  fields: ["power_plant", "reactor_name", "latitude", "longitude", "status", "report_date"],
  source: "fema.reactor-status",
};

/** The radius of the plume exposure pathway zone, in miles. 10 CFR 50.47(c)(2) gives "about 10 miles". */
export const PLUME_ZONE_MILES = 10;
/** The radius of the ingestion pathway zone, in miles. 10 CFR 50.47(c)(2) gives "about 50 miles". */
export const INGESTION_ZONE_MILES = 50;

/** A power reactor of the layer. */
export interface Reactor {
  readonly plant: string;
  readonly unit: string;
  readonly lat: number;
  readonly lon: number;
  /** This field is `true` when the daily status report has the reactor. A reactor that is shut down for good has no status. */
  readonly reported: boolean;
}

/** This function gives the request of all the reactors of the layer. The layer has approximately 100 reactors, so one page is enough. */
export function reactorRequest(userAgent: string): ExposureRequest {
  const params = { f: "json", where: "1=1", outFields: REACTOR_LAYER.fields.join(","), returnGeometry: "false", resultRecordCount: "2000" };
  return request(`${REACTOR_LAYER.url}/query?${query(params)}`, userAgent);
}

/** This function reads the reply of `reactorRequest`. A reactor with no point is not in the list. */
export function reactorsOf(reply: unknown): readonly Reactor[] | NoExposure {
  const features = featuresOf(reply);
  if (typeof features === "string") return { read: false, case: REACTOR_LAYER.case, reason: features, source: REACTOR_LAYER.url };
  return features.flatMap((a) => {
    const lat = readNumber(a["latitude"]);
    const lon = readNumber(a["longitude"]);
    const plant = readText(a["power_plant"]);
    if (lat === undefined || lon === undefined || plant === undefined) return [];
    return [{ plant, unit: readText(a["reactor_name"]) ?? plant, lat, lon, reported: readText(a["status"]) !== undefined }];
  });
}

/** The zone of a site: in the plume zone of a plant, in the ingestion zone, or out of both. */
export type NuclearZone = "plume" | "ingestion" | "outside";

/** A plant near a site: the nearest reactor of the plant. */
export interface PlantDistance {
  readonly plant: string;
  readonly meters: number;
  readonly miles: number;
}

/** The exposure of a site to the nuclear power plants. */
export interface NuclearExposure {
  readonly read: true;
  readonly case: string;
  /** The nearest plant with a reported reactor, or `null` for a list with no reported reactor. */
  readonly nearest: PlantDistance | null;
  /** The zone of the nearest plant. The radii are the nominal radii of 10 CFR 50.47(c)(2). The real zone follows local bounds. */
  readonly zone: NuclearZone;
  /** The plants within `INGESTION_ZONE_MILES`, the nearest first. */
  readonly within: readonly PlantDistance[];
  /** The count of the reactors with no status, which the function does not use. */
  readonly unreported: number;
  readonly source: string;
}

/** This function gives the exposure of the site to the plants with a reported reactor. The function is pure. */
export function nuclearExposure(point: SitePoint, reactors: readonly Reactor[]): NuclearExposure {
  const byPlant = new Map<string, number>();
  for (const reactor of reactors) {
    if (!reactor.reported) continue;
    const meters = metersTo(point, reactor.lat, reactor.lon);
    byPlant.set(reactor.plant, Math.min(meters, byPlant.get(reactor.plant) ?? Number.POSITIVE_INFINITY));
  }
  const plants = [...byPlant]
    .map(([plant, meters]) => ({ plant, meters: Math.round(meters), miles: Math.round((meters / METERS_PER_MILE) * 10) / 10 }))
    .sort((a, b) => a.meters - b.meters || a.plant.localeCompare(b.plant));
  const nearest = plants[0] ?? null;
  const miles = nearest === null ? Number.POSITIVE_INFINITY : nearest.meters / METERS_PER_MILE;
  const zone: NuclearZone = miles <= PLUME_ZONE_MILES ? "plume" : miles <= INGESTION_ZONE_MILES ? "ingestion" : "outside";
  return {
    read: true,
    case: REACTOR_LAYER.case,
    nearest,
    zone,
    within: plants.filter((p) => p.meters / METERS_PER_MILE <= INGESTION_ZONE_MILES),
    unreported: reactors.filter((r) => !r.reported).length,
    source: REACTOR_LAYER.url,
  };
}

// The dams.

/**
 * The layer of the National Inventory of Dams. The request asks for no name, no owner and no address.
 * The name of a dam can be the name of a person, so the dam id is the name of a record.
 */
export const DAM_LAYER: ExposureLayer = {
  case: "met.flood",
  url: "https://geospatial.sec.usace.army.mil/dls/rest/services/NID/National_Inventory_of_Dams_Public_Service/FeatureServer/0",
  fields: ["NIDID", "HAZARD_POTENTIAL", "CONDITION_ASSESSMENT", "EAP_PREPARED", "RIVER_OR_STREAM", "NID_STORAGE", "NID_HEIGHT", "LATITUDE", "LONGITUDE"],
  source: "usace.nid",
};

/**
 * The classes of the hazard potential of a dam, from the classification of the Interagency Committee on Dam Safety.
 * A failure of a `high` dam will probably cause loss of human life. A `significant` dam causes no probable loss of life, but economic or environmental loss.
 * A `low` dam causes no probable loss of life and low loss. The NID also has `undetermined`.
 */
export const DAM_HAZARDS: readonly ["high", "significant", "low", "undetermined"] = ["high", "significant", "low", "undetermined"];

/** A class of the hazard potential of a dam. */
export type DamHazard = (typeof DAM_HAZARDS)[number];

/** A dam of the NID, with no name and no owner. */
export interface Dam {
  readonly id: string;
  /** The hazard potential, or `null` when the NID gives no class. */
  readonly hazard: DamHazard | null;
  readonly lat: number;
  readonly lon: number;
  readonly river: string | null;
  /** The condition assessment of the NID, for example `Satisfactory`, or `null`. */
  readonly condition: string | null;
  /** The date or the value of the field `EAP_PREPARED` (the emergency action plan), or `null`. */
  readonly eap: string | null;
  readonly storageAcreFeet: number | null;
  readonly heightFt: number | null;
}

/** This function gives the request of the dams in the box of a circle around the point. */
export function damRequest(point: SitePoint, radiusMeters: number, userAgent: string): ExposureRequest {
  const box = boxAround(point, radiusMeters);
  const params = {
    f: "json",
    where: "1=1",
    geometry: [box.west, box.south, box.east, box.north].map((n) => n.toFixed(6)).join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: DAM_LAYER.fields.join(","),
    returnGeometry: "false",
    resultRecordCount: "2000",
  };
  return request(`${DAM_LAYER.url}/query?${query(params)}`, userAgent);
}

/** This function gives the class of a value of the field `HAZARD_POTENTIAL`, or `null`. */
function damHazardOf(value: unknown): DamHazard | null {
  const text = readText(value)?.toLowerCase();
  return DAM_HAZARDS.find((hazard) => hazard === text) ?? null;
}

/** This function reads the reply of `damRequest`. A dam with no point or no id is not in the list. */
export function damsOf(reply: unknown): readonly Dam[] | NoExposure {
  const features = featuresOf(reply);
  if (typeof features === "string") return { read: false, case: DAM_LAYER.case, reason: features, source: DAM_LAYER.url };
  return features.flatMap((a) => {
    const id = readText(a["NIDID"]);
    const lat = readNumber(a["LATITUDE"]);
    const lon = readNumber(a["LONGITUDE"]);
    if (id === undefined || lat === undefined || lon === undefined) return [];
    const eap = a["EAP_PREPARED"];
    return [
      {
        id,
        hazard: damHazardOf(a["HAZARD_POTENTIAL"]),
        lat,
        lon,
        river: readText(a["RIVER_OR_STREAM"]) ?? null,
        condition: readText(a["CONDITION_ASSESSMENT"]) ?? null,
        eap: typeof eap === "number" && Number.isFinite(eap) ? new Date(eap).toISOString().slice(0, 10) : (readText(eap) ?? null),
        storageAcreFeet: readNumber(a["NID_STORAGE"]) ?? null,
        heightFt: readNumber(a["NID_HEIGHT"]) ?? null,
      },
    ];
  });
}

/** A dam near a site, with its distance. */
export interface DamDistance extends Dam {
  readonly meters: number;
}

/**
 * The exposure of a site to the dams within a radius. The NID gives no inundation area to the public.
 * Thus a dam in the radius is not always upstream of the site.
 */
export interface DamExposure {
  readonly read: true;
  readonly case: string;
  readonly radiusMeters: number;
  /** The count of the dams in the radius for each class. The key `none` counts the dams with no class. */
  readonly counts: Readonly<Record<DamHazard | "none", number>>;
  /** The high hazard dams in the radius, the nearest first. */
  readonly high: readonly DamDistance[];
  readonly source: string;
}

/** This function gives the exposure of the site to the dams within the radius. A dam out of the radius is not counted. The function is pure. */
export function damExposure(point: SitePoint, dams: readonly Dam[], radiusMeters: number): DamExposure {
  const near = dams
    .map((dam) => ({ ...dam, meters: Math.round(metersTo(point, dam.lat, dam.lon)) }))
    .filter((dam) => dam.meters <= radiusMeters)
    .sort((a, b) => a.meters - b.meters || a.id.localeCompare(b.id));
  const counts: Record<DamHazard | "none", number> = { high: 0, significant: 0, low: 0, undetermined: 0, none: 0 };
  for (const dam of near) counts[dam.hazard ?? "none"] += 1;
  return { read: true, case: DAM_LAYER.case, radiusMeters, counts, high: near.filter((dam) => dam.hazard === "high"), source: DAM_LAYER.url };
}
