import { HAZARDS_SCHEMA, type Claim, type HazardList, type License, type NoLaw, type Source } from "./hazard.ts";

// The reference data: the hazard cases, the cuts that public pages name, and the table of the sources.
// Each claim is in own words. The dataset holds no quote. A cut that no source names is not in the list: it is no read.

const FEDERAL = "Public domain (a work of the United States federal government)";
const FEMA: License = { name: FEDERAL, url: "https://www.fema.gov/about/website-information#copyright" };
const NWS: License = { name: FEDERAL, url: "https://www.weather.gov/disclaimer" };
const READ = "2026-11-21";

const ready = (name: string, path: string, updated: string): Source => ({ name, url: `https://www.ready.gov/${path}`, publisher: "FEMA (Ready.gov)", license: FEMA, updated, read: READ });
const nws = (name: string, path: string): Source => ({ name, url: `https://www.weather.gov/safety/${path}`, publisher: "National Weather Service", license: NWS, read: READ });

/** The sources of the reference data, by id. */
export const HAZARD_SOURCES: Readonly<Record<string, Source>> = {
  "ready.power-outages": ready("Power outages", "power-outages", "2026-06-04"),
  "ready.winter-weather": ready("Winter weather", "winter-weather", "2026-11-03"),
  "ready.heat": ready("Extreme heat", "heat", "2026-07-16"),
  "ready.hurricanes": ready("Hurricanes", "hurricanes", "2026-10-16"),
  "ready.floods": ready("Floods", "floods", "2026-11-18"),
  "ready.tornadoes": ready("Tornadoes", "tornadoes", "2026-06-02"),
  "ready.earthquakes": ready("Earthquakes", "earthquakes", "2026-09-09"),
  "ready.wildfires": ready("Wildfires", "wildfires", "2026-11-18"),
  "ready.home-fires": ready("Home fires", "home-fires", "2026-02-26"),
  "ready.hazardous-materials": ready("Hazardous materials incidents", "hazardous-materials-incidents", "2023-04-24"),
  "ready.radiological-dispersion-device": ready("Radiological dispersion device", "radiological-dispersion-device", "2025-01-07"),
  "ready.pandemic": ready("Pandemic", "pandemic", "2026-03-05"),
  "nws.hurricane": nws("Hurricane safety", "hurricane"),
  "nws.tornado": nws("Tornado safety", "tornado"),
  "nws.winter": nws("Winter safety", "winter"),
  "nws.flood": nws("Flood safety", "flood"),
  "nws.wildfire": nws("Wildfire safety", "wildfire"),
  "nws.heat": nws("Heat safety", "heat"),
};

/** The duration of each cut of the reference data. No source with a law of a duration is read yet. */
export const NO_LAW: NoLaw = { read: false, reason: "No source with a law of the duration of this cut is read yet." };

const said = (source: string, says: string): Claim => ({ source, says });
const defined = (says: string): Claim => ({ definition: true, says });

/**
 * The reference list of hazard cases. A case has a generic name and a code of the alert taxonomy.
 * The list names no person and no place. The region of a user is input data of `hazardCase`.
 */
export const HAZARD_LIST: HazardList = {
  schema: HAZARDS_SCHEMA,
  sources: HAZARD_SOURCES,
  hazards: [
    {
      case: "infra.power.outage",
      title: "Power outage",
      examined: ["ready.power-outages"],
      cuts: [
        {
          part: "power.grid",
          title: "No power from the grid",
          claims: [defined("The case is a stop of the power from the grid."), said("ready.power-outages", "The page tells that the electrical power goes out.")],
          duration: NO_LAW,
        },
        { part: "phone.network", title: "No telephone service", claims: [said("ready.power-outages", "The page tells that a power outage can stop communications.")], duration: NO_LAW },
        { part: "water.main", title: "No water from the main", claims: [said("ready.power-outages", "The page tells that a power outage can stop the water supply.")], duration: NO_LAW },
        { part: "road.local", title: "No transport", claims: [said("ready.power-outages", "The page tells that a power outage can stop transportation.")], duration: NO_LAW },
        { part: "food.retail", title: "The food shops are closed", claims: [said("ready.power-outages", "The page tells that a power outage can close the grocery stores.")], duration: NO_LAW },
        { part: "fuel.retail", title: "The fuel stations are closed", claims: [said("ready.power-outages", "The page tells that a power outage can close the gas stations.")], duration: NO_LAW },
        { part: "cash.retail", title: "No banks and no cash machines", claims: [said("ready.power-outages", "The page tells that a power outage can close the banks and the ATMs.")], duration: NO_LAW },
      ],
    },
    {
      case: "infra.water.outage",
      title: "Water outage",
      examined: [],
      cuts: [{ part: "water.main", title: "No water from the main", claims: [defined("The case is a stop of the water from the public main.")], duration: NO_LAW }],
    },
    {
      case: "met.winter.storm",
      title: "Winter storm",
      examined: ["ready.winter-weather", "nws.winter"],
      cuts: [
        { part: "power.grid", title: "No power from the grid", claims: [said("ready.winter-weather", "The page tells that a winter storm can cut off the power.")], duration: NO_LAW },
        { part: "phone.network", title: "No telephone service", claims: [said("ready.winter-weather", "The page tells that a winter storm can cut off the communication services.")], duration: NO_LAW },
        { part: "road.local", title: "The roads are closed", claims: [said("nws.winter", "The page tells that a blizzard can make the roads impassable.")], duration: NO_LAW },
      ],
    },
    {
      case: "met.heat.extreme",
      title: "Extreme heat",
      examined: ["ready.heat", "nws.heat"],
      cuts: [{ part: "power.grid", title: "No power from the grid", claims: [said("ready.heat", "The page tells that a heat wave can cause a loss of power.")], duration: NO_LAW }],
    },
    {
      case: "met.tropical.hurricane",
      title: "Hurricane or tropical storm",
      examined: ["ready.hurricanes", "nws.hurricane"],
      cuts: [
        { part: "phone.network", title: "No telephone service", claims: [said("ready.hurricanes", "The page tells that the phone systems are often down after a disaster.")], duration: NO_LAW },
        { part: "home.dwelling", title: "The home is damaged", claims: [said("nws.hurricane", "The page tells that a hurricane can destroy buildings and manufactured homes.")], duration: NO_LAW },
      ],
    },
    {
      case: "met.flood",
      title: "Flood",
      examined: ["ready.floods", "nws.flood"],
      cuts: [
        { part: "road.local", title: "The roads are closed", claims: [said("ready.floods", "The page tells that a flood can stop transportation and wash bridges away.")], duration: NO_LAW },
        { part: "home.dwelling", title: "The home is damaged", claims: [said("ready.floods", "The page tells that a flood can damage buildings.")], duration: NO_LAW },
      ],
    },
    {
      case: "met.tornado",
      title: "Tornado",
      examined: ["ready.tornadoes", "nws.tornado"],
      cuts: [
        { part: "power.grid", title: "No power from the grid", claims: [said("ready.tornadoes", "The page tells a person to stay clear of fallen power lines after a tornado.")], duration: NO_LAW },
        {
          part: "home.dwelling",
          title: "The home is damaged",
          claims: [said("ready.tornadoes", "The page tells that a tornado can destroy buildings."), said("nws.tornado", "The page tells that a tornado can destroy strong structures.")],
          duration: NO_LAW,
        },
      ],
    },
    {
      case: "geo.earthquake",
      title: "Earthquake",
      examined: ["ready.earthquakes"],
      cuts: [
        { part: "gas.main", title: "No gas from the main", claims: [said("ready.earthquakes", "The page tells that an earthquake can cause leaks of the gas lines.")], duration: NO_LAW },
        { part: "water.main", title: "No water from the main", claims: [said("ready.earthquakes", "The page tells that an earthquake can cause leaks of the water lines.")], duration: NO_LAW },
        { part: "power.grid", title: "No power from the grid", claims: [said("ready.earthquakes", "The page tells that an earthquake can bring down power lines.")], duration: NO_LAW },
        { part: "home.dwelling", title: "The home is damaged", claims: [said("ready.earthquakes", "The page tells that an earthquake can damage the building.")], duration: NO_LAW },
      ],
    },
    {
      case: "fire.wildfire",
      title: "Wildfire",
      examined: ["ready.wildfires", "nws.wildfire"],
      cuts: [{ part: "home.dwelling", title: "The home is damaged", claims: [said("ready.wildfires", "The page tells a person to record the damage to the property after a wildfire.")], duration: NO_LAW }],
    },
    {
      case: "fire.structure",
      title: "Home fire",
      examined: ["ready.home-fires"],
      cuts: [
        {
          part: "home.dwelling",
          title: "The home is damaged",
          claims: [defined("The case is a fire in the home."), said("ready.home-fires", "The page tells a person to make sure that the home is safe before entry.")],
          duration: NO_LAW,
        },
      ],
    },
    { case: "cbrne.hazardous-materials", title: "Release of hazardous materials", examined: ["ready.hazardous-materials"], cuts: [] },
    { case: "cbrne.radiological", title: "Radiation emergency", examined: ["ready.radiological-dispersion-device"], cuts: [] },
    { case: "health.outbreak", title: "Outbreak or pandemic", examined: ["ready.pandemic"], cuts: [] },
    { case: "health.medical-emergency", title: "Medical emergency", examined: [], cuts: [] },
  ],
};
