import { EAGLEI_CAUSE_LAWS, EAGLEI_CAUSE_SOURCES, EAGLEI_GRID_LAW, EAGLEI_SOURCE, STORM_EVENTS_SOURCE, ZONE_COUNTY_SOURCE } from "./eaglei-law.ts";
import { OE417_SOURCE } from "./oe417.ts";
import { HAZARDS_SCHEMA, type Claim, type IsoDate, type DurationLaw, type HazardCut, type HazardList, type License, type NoLaw, type Source } from "./hazard.ts";

// The reference data: the hazard cases, the cuts that public pages name, and the table of the sources.
// Each claim is in own words. The dataset holds no quote. A cut that no source names is not in the list: it is no read.

const FEDERAL = "Public domain (a work of the United States federal government)";
const FEMA: License = { name: FEDERAL, url: "https://www.fema.gov/about/website-information#copyright" };
const NWS: License = { name: FEDERAL, url: "https://www.weather.gov/disclaimer" };
/** The law that puts the works of the United States federal government in the public domain (17 U.S.C. 105). */
const FEDERAL_WORK: License = { name: FEDERAL, url: "https://www.copyright.gov/title17/92chap1.html#105" };
const READ = "2026-11-21";
const READ_CASES = "2026-11-22";

const ready = (name: string, path: string, updated: string, read: string = READ): Source => ({
  name,
  url: `https://www.ready.gov/${path}`,
  publisher: "FEMA (Ready.gov)",
  license: FEMA,
  updated,
  read,
});
const dhs = (name: string, path: string, updated?: string): Source => ({
  name,
  url: `https://www.dhs.gov/sites/default/files/${path}`,
  publisher: "U.S. Department of Homeland Security",
  license: FEDERAL_WORK,
  updated,
  read: READ_CASES,
});
const doe = (name: string, path: string, updated: IsoDate): Source => ({
  name,
  url: `https://www.energy.gov/sites/${path}`,
  publisher: "U.S. Department of Energy",
  license: FEDERAL_WORK,
  updated,
  read: READ_CASES,
});
const cisa = (name: string, path: string): Source => ({ name, url: `https://www.cisa.gov/${path}`, publisher: "CISA", license: FEDERAL_WORK, read: READ_CASES });
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
  "ready.radiation": ready("Radiation emergencies", "radiation", "2025-01-07", READ_CASES),
  "ready.space-weather": ready("Space weather", "space-weather", "2026-03-05", READ_CASES),
  "ready.cybersecurity": ready("Cybersecurity", "cybersecurity", "2026-02-20", READ_CASES),
  "ready.financial-preparedness": ready("Financial preparedness", "financial-preparedness", "2026-03-13", READ_CASES),
  "ready.food": ready("Food", "food", "2026-03-12", READ_CASES),
  "cdc.community-mitigation": {
    name: "Community mitigation guidelines to prevent pandemic influenza, United States, 2017",
    url: "https://www.cdc.gov/mmwr/volumes/66/rr/rr6601a1.htm",
    publisher: "CDC (MMWR Recommendations and Reports)",
    license: FEDERAL_WORK,
    updated: "2017-04-21",
    read: READ_CASES,
  },
  "ready.mass-gatherings": ready("Mass gathering incidents", "public-spaces", "2026-05-13", READ_CASES),
  "cisa.physical-security": cisa("Physical security", "topics/physical-security"),
  "fema.cpg-201": {
    name: "Threat and hazard identification and risk assessment (THIRA) and stakeholder preparedness review (SPR) guide, CPG 201, 3rd edition",
    url: "https://www.fema.gov/sites/default/files/2020-04/CPG201Final20180525.pdf",
    publisher: "FEMA",
    license: FEDERAL_WORK,
    read: READ_CASES,
  },
  // A joint advisory: CISA, NSA and FBI, with US and foreign partners. The claims are facts in own words, not quotes.
  "cisa.aa24-038a": {
    name: "PRC state-sponsored actors compromise and maintain persistent access to U.S. critical infrastructure (AA24-038A)",
    url: "https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-038a",
    publisher: "CISA, NSA and FBI",
    license: FEDERAL_WORK,
    updated: "2024-02-07",
    read: READ_CASES,
  },
  "cisa.emp": cisa("Electromagnetic pulse", "topics/risk-management/electromagnetic-pulse"),
  "cisa.ir-alert-h-16-056-01": {
    name: "Cyber-attack against Ukrainian critical infrastructure (IR-ALERT-H-16-056-01)",
    url: "https://www.cisa.gov/news-events/ics-alerts/ir-alert-h-16-056-01",
    publisher: "CISA",
    license: FEDERAL_WORK,
    updated: "2021-07-20",
    read: READ_CASES,
  },
  "swpc.electric-power": {
    name: "Electric power transmission",
    url: "https://www.spaceweather.gov/impacts/electric-power-transmission",
    publisher: "NOAA Space Weather Prediction Center",
    license: FEDERAL_WORK,
    read: READ_CASES,
  },
  "doe.maria-2017-10-23": doe("Hurricanes Maria and Irma event summary, October 23, 2017", "prod/files/2017/10/f38/Hurricanes%20Maria%20and%20Irma%20Event%20Summary%20October%2023%2C%202017.pdf", "2017-10-23"),
  "doe.maria-2018-02-21": doe("Hurricanes Maria and Irma event summary, February 21, 2018", "default/files/2018/02/f49/Hurricanes%20Maria%20and%20Irma%20Event%20Summary%20February%2021%2C%202018.pdf", "2018-02-21"),
  "dhs.ai-framework": dhs(
    "Roles and responsibilities framework for artificial intelligence in critical infrastructure",
    "2024-11/24_1114_dhs_ai-roles-and-responsibilities-framework-508.pdf",
    "2024-11-14",
  ),
  "dhs.ai-guidelines": dhs("Mitigating AI risk: safety and security guidelines for critical infrastructure owners and operators", "2024-04/24_0426_dhs_ai-ci-safety-security-guidelines-508c.pdf"),
  "nws.hurricane": nws("Hurricane safety", "hurricane"),
  "nws.tornado": nws("Tornado safety", "tornado"),
  "nws.winter": nws("Winter safety", "winter"),
  "nws.flood": nws("Flood safety", "flood"),
  "nws.wildfire": nws("Wildfire safety", "wildfire"),
  "nws.heat": nws("Heat safety", "heat"),
  "doe.oe-417": OE417_SOURCE,
  "eaglei.outages": EAGLEI_SOURCE,
  "noaa.storm-events": STORM_EVENTS_SOURCE,
  "nws.zone-county": ZONE_COUNTY_SOURCE,
  ...EAGLEI_CAUSE_SOURCES,
};

/** The duration of each cut with no law yet. Only the grid cuts have laws, from EAGLE-I: for all causes, and for each storm case. */
export const NO_LAW: NoLaw = { read: false, reason: "No source with a law of the duration of this cut is read yet." };

/** The duration of the grid cut of a storm case with no state of 30 outages of EAGLE-I in the storm events of the case. */
export const NO_STORM_LAW: NoLaw = { read: false, reason: "No state has 30 outages of EAGLE-I in the storm events of this case." };

/**
 * The duration of a cut of a catastrophic case with no record of its events. A source or the definition tells that the case can stop the part.
 * The sources read give no duration and no record of the events of the cut, so no law comes from data.
 */
export const NO_EVENT_LAW: NoLaw = { read: false, reason: "No source read gives a duration of this cut or a record of the events of this cut." };

/** The duration of a cut that follows the stop of the grid, in a case whose grid cut has no law. */
export const NO_FOLLOW_LAW: NoLaw = { read: false, reason: "This cut follows the stop of the grid in this case, and that cut has no law. No source read gives a duration of this cut." };

/** The duration of the grid cut of a long collapse of the grid. The sources read tell of one event that meets the case. */
export const NO_COLLAPSE_LAW: NoLaw = {
  read: false,
  reason:
    "The event summaries of DOE tell of one long collapse: the grid of Puerto Rico after Hurricane Maria in 2017. Their first counts of the customers out are estimates from the load. The OE-417 summaries of 2000 to 2023 do not list that event. They give the time of the last restoration of each event, not the time of most customers. Their events of 14 days or more are storms with a long tail of restoration, for example Hurricane Ike in 2008. One event gives no law. The law of EAGLE-I is from usual outages.",
};

/** The duration of the grid cut of a cyberattack. The sources read tell of two grid outages from a cyberattack. */
export const NO_CYBER_LAW: NoLaw = {
  read: false,
  reason: "The CISA alert IR-ALERT-H-16-056-01 tells of one grid outage from a cyberattack: about 225,000 customers in Ukraine in 2015. It gives no duration. The OE-417 summaries of 2000 to 2023 list 42 cyber events. Only one tells of a loss of load: 29 MW in Georgia in 2021, for 103 hours. Two events give no law.",
};

/** The duration of the grid cut of a solar storm. The sources read tell of three blackouts from space weather. */
export const NO_GEOMAGNETIC_LAW: NoLaw = {
  read: false,
  reason: "The page of NOAA SWPC names three blackouts from space weather, in 1958, 1989 and 2003. Only the blackout of 1989 in Canada has a duration: 9 hours. The OE-417 summaries of 2000 to 2023 list no event from space weather. Three events give no law.",
};

/** The sources that each storm case examined for the law of its grid cut. */
const STORM_EXAMINED = ["eaglei.outages", "noaa.storm-events", "nws.zone-county"];

/** This function gives the law of the grid cut of a storm case. The law is from the outages of EAGLE-I in the storm events of the case. */
const stormLaw = (name: string): DurationLaw | NoLaw => EAGLEI_CAUSE_LAWS[name] ?? NO_STORM_LAW;

/** This function gives a claim of an effect that a source tells as a fact of past events or of physics. */
const told = (source: string, says: string): Claim => ({ source, basis: "told", says });
/** This function gives a claim of a risk or a threat that a source assesses. */
const assessed = (source: string, says: string): Claim => ({ source, basis: "assessed", says });
const defined = (says: string): Claim => ({ definition: true, says });

/**
 * This function gives the cuts that a stop of the grid causes, from the page on power outages. A power outage and a long collapse of the grid share them.
 * The two cases have different reasons for no law.
 */
const outageEffects = (duration: NoLaw): HazardCut[] => [
  { part: "phone.network", title: "No telephone service", claims: [told("ready.power-outages", "The page tells that a power outage can stop communications.")], duration },
  { part: "water.main", title: "No water from the main", claims: [told("ready.power-outages", "The page tells that a power outage can stop the water supply.")], duration },
  { part: "road.local", title: "No transport", claims: [told("ready.power-outages", "The page tells that a power outage can stop transportation.")], duration },
  { part: "food.retail", title: "The food shops are closed", claims: [told("ready.power-outages", "The page tells that a power outage can close the grocery stores.")], duration },
  { part: "fuel.retail", title: "The fuel stations are closed", claims: [told("ready.power-outages", "The page tells that a power outage can close the gas stations.")], duration },
  { part: "cash.retail", title: "No banks and no cash machines", claims: [told("ready.power-outages", "The page tells that a power outage can close the banks and the ATMs.")], duration },
];

/**
 * The cuts of an electromagnetic pulse, from the page of CISA. A case can add the same claims to each cut.
 * The page assesses the threat of an attack, and tells only a potential of the damage. So each claim is assessed.
 */
const pulseCuts = (extra: readonly Claim[] = []): HazardCut[] =>
  [
    { part: "power.grid", title: "No power from the grid", says: "The page tells that an electromagnetic pulse can damage the electrical grid." },
    { part: "phone.network", title: "No telephone service", says: "The page tells that an electromagnetic pulse can damage the communications equipment." },
    { part: "water.main", title: "No water from the main", says: "The page tells that an electromagnetic pulse can damage the water systems." },
    { part: "sewer.main", title: "No public sewer", says: "The page tells that an electromagnetic pulse can damage the wastewater systems." },
    { part: "road.local", title: "No transport", says: "The page tells that an electromagnetic pulse can damage the transportation modes." },
  ].map(({ part, title, says }) => ({ part, title, claims: [assessed("cisa.emp", says), ...extra], duration: NO_EVENT_LAW }));

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
      examined: ["ready.power-outages", "eaglei.outages"],
      cuts: [
        {
          part: "power.grid",
          title: "No power from the grid",
          claims: [defined("The case is a stop of the power from the grid."), told("ready.power-outages", "The page tells that the electrical power goes out.")],
          duration: EAGLEI_GRID_LAW,
        },
        ...outageEffects(NO_LAW),
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
      examined: ["ready.winter-weather", "nws.winter", ...STORM_EXAMINED],
      cuts: [
        { part: "power.grid", title: "No power from the grid", claims: [told("ready.winter-weather", "The page tells that a winter storm can cut off the power.")], duration: stormLaw("met.winter.storm") },
        { part: "phone.network", title: "No telephone service", claims: [told("ready.winter-weather", "The page tells that a winter storm can cut off the communication services.")], duration: NO_LAW },
        { part: "road.local", title: "The roads are closed", claims: [told("nws.winter", "The page tells that a blizzard can make the roads impassable.")], duration: NO_LAW },
      ],
    },
    {
      case: "met.heat.extreme",
      title: "Extreme heat",
      examined: ["ready.heat", "nws.heat", ...STORM_EXAMINED],
      cuts: [{ part: "power.grid", title: "No power from the grid", claims: [told("ready.heat", "The page tells that a heat wave can cause a loss of power.")], duration: stormLaw("met.heat.extreme") }],
    },
    {
      case: "met.tropical.hurricane",
      title: "Hurricane or tropical storm",
      examined: ["ready.hurricanes", "nws.hurricane", ...STORM_EXAMINED],
      cuts: [
        {
          part: "power.grid",
          title: "No power from the grid",
          claims: [
            told("ready.hurricanes", "The page tells that power lines can be down after a hurricane."),
            told("ready.hurricanes", "The page tells a person to get backup chargers before a hurricane."),
          ],
          duration: stormLaw("met.tropical.hurricane"),
        },
        { part: "phone.network", title: "No telephone service", claims: [told("ready.hurricanes", "The page tells that the phone systems are often down after a disaster.")], duration: NO_LAW },
        { part: "home.dwelling", title: "The home is damaged", claims: [told("nws.hurricane", "The page tells that a hurricane can destroy buildings and manufactured homes.")], duration: NO_LAW },
      ],
    },
    {
      case: "met.flood",
      title: "Flood",
      examined: ["ready.floods", "nws.flood", ...STORM_EXAMINED],
      cuts: [
        { part: "power.grid", title: "No power from the grid", claims: [told("ready.floods", "The page tells that power lines can be down in a flood.")], duration: stormLaw("met.flood") },
        { part: "road.local", title: "The roads are closed", claims: [told("ready.floods", "The page tells that a flood can stop transportation and wash bridges away.")], duration: NO_LAW },
        { part: "home.dwelling", title: "The home is damaged", claims: [told("ready.floods", "The page tells that a flood can damage buildings.")], duration: NO_LAW },
      ],
    },
    {
      case: "met.tornado",
      title: "Tornado",
      examined: ["ready.tornadoes", "nws.tornado", ...STORM_EXAMINED],
      cuts: [
        { part: "power.grid", title: "No power from the grid", claims: [told("ready.tornadoes", "The page tells a person to stay clear of fallen power lines after a tornado.")], duration: stormLaw("met.tornado") },
        {
          part: "home.dwelling",
          title: "The home is damaged",
          claims: [told("ready.tornadoes", "The page tells that a tornado can destroy buildings."), told("nws.tornado", "The page tells that a tornado can destroy strong structures.")],
          duration: NO_LAW,
        },
      ],
    },
    {
      case: "geo.earthquake",
      title: "Earthquake",
      examined: ["ready.earthquakes"],
      cuts: [
        { part: "gas.main", title: "No gas from the main", claims: [told("ready.earthquakes", "The page tells that an earthquake can cause leaks of the gas lines.")], duration: NO_LAW },
        { part: "water.main", title: "No water from the main", claims: [told("ready.earthquakes", "The page tells that an earthquake can cause leaks of the water lines.")], duration: NO_LAW },
        { part: "power.grid", title: "No power from the grid", claims: [told("ready.earthquakes", "The page tells that an earthquake can bring down power lines.")], duration: NO_LAW },
        { part: "home.dwelling", title: "The home is damaged", claims: [told("ready.earthquakes", "The page tells that an earthquake can damage the building.")], duration: NO_LAW },
      ],
    },
    {
      case: "fire.wildfire",
      title: "Wildfire",
      examined: ["ready.wildfires", "nws.wildfire"],
      cuts: [{ part: "home.dwelling", title: "The home is damaged", claims: [told("ready.wildfires", "The page tells a person to record the damage to the property after a wildfire.")], duration: NO_LAW }],
    },
    {
      case: "fire.structure",
      title: "Home fire",
      examined: ["ready.home-fires"],
      cuts: [
        {
          part: "home.dwelling",
          title: "The home is damaged",
          claims: [defined("The case is a fire in the home."), told("ready.home-fires", "The page tells a person to make sure that the home is safe before entry.")],
          duration: NO_LAW,
        },
      ],
    },
    { case: "cbrne.hazardous-materials", title: "Release of hazardous materials", examined: ["ready.hazardous-materials"], cuts: [] },
    { case: "cbrne.radiological", title: "Radiation emergency", examined: ["ready.radiological-dispersion-device"], cuts: [] },
    { case: "health.outbreak", title: "Outbreak or pandemic", examined: ["ready.pandemic"], cuts: [] },
    { case: "health.medical-emergency", title: "Medical emergency", examined: [], cuts: [] },
    // The catastrophic cases. A case with no source that names a cut has no cut: each of its supplies is no read.
    // The list examined of a case tells the kind of the gap: the sources that name no cut, or an empty list when no source is read yet.
    {
      case: "civic.ai-collapse",
      title: "Collapse driven by AI",
      examined: ["dhs.ai-framework", "dhs.ai-guidelines"],
      cuts: [
        { part: "power.grid", title: "No power from the grid", claims: [assessed("dhs.ai-framework", "The framework names a failure of the AI systems of the energy utilities as a risk.")], duration: NO_EVENT_LAW },
        { part: "water.main", title: "No water from the main", claims: [assessed("dhs.ai-framework", "The framework names a failure of the AI systems of the water utilities as a risk.")], duration: NO_EVENT_LAW },
        {
          part: "network.access",
          title: "No access to the internet",
          claims: [assessed("dhs.ai-framework", "The framework tells that cyberattacks with AI can disrupt the information technology sector and stop the access to services.")],
          duration: NO_EVENT_LAW,
        },
        { part: "cash.retail", title: "No banks and no cash machines", claims: [assessed("dhs.ai-framework", "The framework names an interruption of the financial services of the banks as a risk of AI.")], duration: NO_EVENT_LAW },
        { part: "care.local", title: "No hospitals and no pharmacies", claims: [assessed("dhs.ai-framework", "The framework names an interruption of the medical services of the hospitals as a risk of AI.")], duration: NO_EVENT_LAW },
      ],
    },
    {
      case: "security.nuclear-war",
      title: "Nuclear war",
      examined: ["cisa.emp", "ready.radiation"],
      cuts: [
        ...pulseCuts([assessed("cisa.emp", "The page tells that a nuclear attack high in the air in a war can cause wide harm to the infrastructure.")]),
        { part: "home.dwelling", title: "The home is damaged", claims: [told("ready.radiation", "The page tells that a building can collapse after a nuclear detonation.")], duration: NO_EVENT_LAW },
      ],
    },
    {
      case: "cbrne.nuclear-detonation",
      title: "Nuclear detonation",
      examined: ["ready.radiation"],
      cuts: [{ part: "home.dwelling", title: "The home is damaged", claims: [told("ready.radiation", "The page tells that a building can collapse after a nuclear detonation.")], duration: NO_EVENT_LAW }],
    },
    {
      case: "health.outbreak.pandemic",
      title: "Severe pandemic",
      // The guidelines of CDC name the closure of schools, child care, workplaces and mass gatherings. These are not
      // public supplies, so they are not cuts of a reference part. The guidelines name no stop of a supply.
      examined: ["ready.pandemic", "ready.financial-preparedness", "cdc.community-mitigation"],
      cuts: [],
    },
    {
      case: "infra.power.grid-collapse",
      title: "Long collapse of the power grid",
      // The event summaries of DOE on Hurricane Maria tell of the one long collapse in the records read. One event gives no law.
      // The OE-417 summaries give the last restoration of each event, so their long storms do not tell the duration of a collapse.
      examined: ["ready.power-outages", "doe.maria-2017-10-23", "doe.maria-2018-02-21", "doe.oe-417"],
      cuts: [
        {
          part: "power.grid",
          title: "No power from the grid",
          claims: [defined("The case is a stop of the power from the grid over a wide area for weeks or more.")],
          // The law of EAGLE-I is from usual outages, so it does not tell the duration of a collapse.
          duration: NO_COLLAPSE_LAW,
        },
        ...outageEffects(NO_FOLLOW_LAW),
      ],
    },
    {
      case: "cyber.infrastructure-attack",
      title: "Cyberattack on the infrastructure",
      examined: ["ready.cybersecurity", "cisa.ir-alert-h-16-056-01", "doe.oe-417"],
      cuts: [
        {
          part: "power.grid",
          title: "No power from the grid",
          claims: [
            told("ready.cybersecurity", "The page tells that a cyberattack can have an effect on the power grid."),
            told("cisa.ir-alert-h-16-056-01", "The alert tells that cyber intrusions at three power distribution companies caused power outages for about 225,000 customers."),
          ],
          duration: NO_CYBER_LAW,
        },
        { part: "road.local", title: "No transport", claims: [told("ready.cybersecurity", "The page tells that a cyberattack can have an effect on transportation.")], duration: NO_EVENT_LAW },
      ],
    },
    {
      case: "infra.supply-chain.food",
      title: "Failure of the food supply",
      examined: ["ready.food"],
      cuts: [{ part: "food.retail", title: "The food shops are empty", claims: [defined("The case is a stop of the supply of food to the shops.")], duration: NO_EVENT_LAW }],
    },
    {
      case: "civic.economy.collapse",
      title: "Financial collapse",
      examined: ["ready.financial-preparedness"],
      cuts: [
        {
          part: "cash.retail",
          title: "No banks and no cash machines",
          claims: [defined("The case is a stop of the banks and of the payments."), told("ready.financial-preparedness", "The page tells that the ATMs and the credit cards can fail in a disaster.")],
          duration: NO_EVENT_LAW,
        },
      ],
    },
    {
      case: "security.civil-unrest",
      title: "Civil unrest",
      // Ready.gov has no page on civil unrest. Its page on mass gatherings names fights and fires, and no stop of a
      // supply. The page of CISA names public demonstrations, and no stop of a supply. The text of FEMA CPG 201 (2018)
      // does not have the words civil, riot or unrest.
      examined: ["ready.mass-gatherings", "cisa.physical-security", "fema.cpg-201"],
      cuts: [],
    },
    {
      case: "security.armed-conflict",
      title: "War",
      // The advisory assesses that state actors are in the IT networks of four sectors, to disrupt the functions of
      // their operational technology in a major crisis or conflict with the United States.
      examined: ["cisa.aa24-038a"],
      cuts: [
        { part: "power.grid", title: "No power from the grid", claims: [assessed("cisa.aa24-038a", "The advisory tells that state actors are in the networks of the energy sector, to disrupt its operations in a conflict with the United States.")], duration: NO_EVENT_LAW },
        { part: "phone.network", title: "No telephone service", claims: [assessed("cisa.aa24-038a", "The advisory tells that state actors are in the networks of the communications sector, to disrupt its operations in a conflict with the United States.")], duration: NO_EVENT_LAW },
        { part: "road.local", title: "No transport", claims: [assessed("cisa.aa24-038a", "The advisory tells that state actors are in the networks of the transportation sector, to disrupt its operations in a conflict with the United States.")], duration: NO_EVENT_LAW },
        { part: "water.main", title: "No water from the main", claims: [assessed("cisa.aa24-038a", "The advisory tells that state actors are in the networks of the water sector, to disrupt its operations in a conflict with the United States.")], duration: NO_EVENT_LAW },
        { part: "sewer.main", title: "No public sewer", claims: [assessed("cisa.aa24-038a", "The advisory tells that state actors are in the networks of the wastewater sector, to disrupt its operations in a conflict with the United States.")], duration: NO_EVENT_LAW },
      ],
    },
    { case: "cbrne.emp", title: "Electromagnetic pulse", examined: ["cisa.emp"], cuts: pulseCuts() },
    {
      case: "geo.space-weather.geomagnetic-storm",
      title: "Solar storm",
      examined: ["ready.space-weather", "swpc.electric-power", "doe.oe-417"],
      cuts: [
        {
          part: "power.grid",
          title: "No power from the grid",
          claims: [
            told("ready.space-weather", "The page tells that space weather can cause wide power outages."),
            told("swpc.electric-power", "The page tells that space weather caused a blackout of nine hours in Canada in March 1989."),
          ],
          duration: NO_GEOMAGNETIC_LAW,
        },
        { part: "water.main", title: "No water from the main", claims: [told("ready.space-weather", "The page tells that the power outages of space weather can stop the water distribution.")], duration: NO_FOLLOW_LAW },
        { part: "sewer.main", title: "No public sewer", claims: [told("ready.space-weather", "The page tells that the power outages of space weather can stop the wastewater systems.")], duration: NO_FOLLOW_LAW },
        {
          part: "phone.network",
          title: "No telephone service",
          claims: [
            told("ready.space-weather", "The page tells that the power outages of space weather can stop the telephone and communications systems."),
            told("ready.space-weather", "The page tells that space weather can damage the satellites of communications."),
          ],
          duration: NO_EVENT_LAW,
        },
        { part: "road.local", title: "No transport", claims: [told("ready.space-weather", "The page tells that the power outages of space weather can stop the public transportation.")], duration: NO_FOLLOW_LAW },
        {
          part: "fuel.retail",
          title: "The fuel stations are closed",
          claims: [
            told("ready.space-weather", "The page tells that the power outages of space weather can stop the fuel distribution."),
            told("ready.space-weather", "The page tells that the pumps of the gas stations need electricity."),
          ],
          duration: NO_FOLLOW_LAW,
        },
      ],
    },
  ],
};
