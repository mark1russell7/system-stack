import { describe, expect, it } from "vitest";
import { OE417_ATTACK_EVENTS, OE417_YEARS } from "./oe417-events.ts";
import { oe417Compare, oe417KeptEvents, oe417PdfRows, oe417SheetRows, oe417YearCounts, type Oe417Cell, type Oe417Grid } from "./oe417-read.ts";

const cell = (value: string | number | null, text?: string): Oe417Cell => ({ value, text: text ?? String(value ?? "") });
const grid = (...rows: (readonly (string | number | null | Oe417Cell)[])[]): Oe417Grid =>
  rows.map((row) => row.map((entry) => (entry !== null && typeof entry === "object" ? entry : cell(entry))));

// 2023-05-13 is the serial number 45059 of a sheet. 2011-05-21 is 40684.
const DAY_2023 = 45059;
const LAYOUT_C = ["Month", "Date Event Began", "Time Event Began", "Date of Restoration", "Time of Restoration", "Area Affected", "NERC Region", "Alert Criteria", "Event Type", "Demand Loss (MW)", "Number of Customers Affected"];

describe("the sheet of 2015 to 2023", () => {
  const sheet = grid(
    ["OE-417 Electric Emergency and Disturbance (OE-417) Events, 2023"],
    LAYOUT_C,
    ["May", DAY_2023, 0.3090277777777778, DAY_2023, 0.5069444444444444, "North Dakota: Williams County;", "MRO", "Damage", "Vandalism", cell(8, "8"), cell(327, "1,327")],
    ["May", "05/14/2023", 0.5, "Unknown", "Unknown", " Ohio: ", "RF", "Damage", "Sabotage", "Unknown", "Unknown"],
    LAYOUT_C,
    ["August", null, 0.5, "Unknown", "Unknown", "Ohio:", "RF", "Damage", "Sabotage", "Unknown", "Unknown"],
    ["August", null, 0.7, "Unknown", "Unknown", "Ohio:", "RF", "Damage", "Sabotage", "Unknown", "Unknown"],
  );

  it("reads the times to the minute, the text of the counts as the sheet shows it and a date in a text", () => {
    const { events } = oe417SheetRows(2023, sheet);
    expect(events[0]).toEqual({ year: 2023, began: "2023-05-13T07:25", restored: "2023-05-13T12:10", area: "North Dakota: Williams County;", type: "Vandalism", customers: "1,327", megawatts: "8" });
    expect(events[1]).toMatchObject({ began: "2023-05-14T12:00", restored: null, area: "Ohio:" });
  });

  it("leaves out a header row that comes again, and counts a row with no start date that equals an earlier row as a copy", () => {
    const rows = oe417SheetRows(2023, sheet);
    expect(rows.events).toHaveLength(3);
    expect(rows.copies).toBe(1);
    const again = oe417SheetRows(2023, grid(LAYOUT_C, ["May", DAY_2023, 0.5, "Unknown", "Unknown", "Ohio:", "RF", "Damage", "Sabotage", "0", "0"], ["June", null, 0.5, "Unknown", "Unknown", "Ohio:", "RF", "Damage", "Sabotage", "0", "0"], ["June", null, 0.6, "Unknown", "Unknown", "Ohio:", "RF", "Damage", "Sabotage", "0", "0"]));
    expect(again.copies).toBe(1);
    expect(again.events.map((event) => event.began)).toEqual(["2023-05-13T12:00", null]);
  });

  it("throws for a sheet with no header row", () => {
    expect(() => oe417SheetRows(2023, grid(["Nothing"], [1, 2]))).toThrow(RangeError);
  });
});

describe("the sheet of 2011 to 2014", () => {
  it("reads a date and a time that start and end the event, and skips a row of a month", () => {
    const rows = oe417SheetRows(
      2011,
      grid(
        ["OE-417 Events, 20111"],
        ["Date Event Began", "Time Event Began", "Date of Restoration", "Time of Restoration", "Area Affected", "NERC Region", "Event Type", "Demand Loss (MW)", "Number of Customers Affected"],
        ["May  "],
        [40684, 0.7083333333333334, 40685, 0.7736111111111111, "Dixie Valley Area, Nevada", "WECC", "Physical Attack", 56, "UNK"],
      ),
    );
    expect(rows.events).toEqual([{ year: 2011, began: "2011-05-21T17:00", restored: "2011-05-22T18:34", area: "Dixie Valley Area, Nevada", type: "Physical Attack", customers: "UNK", megawatts: "56" }]);
  });
});

describe("the sheet of 2002 to 2010", () => {
  const sheet = grid(
    ["Table B.2.", "Major Disturbances and Unusual Occurrences, 2006"],
    ["Date", "NERC Region", "Time", "Area Affected", "Type of Disturbance", "Loss (megawatts)", "Number of Customers Affected 1", "Restoration"],
    [null, null, null, null, null, null, null, "Date/Time"],
    ["January  "],
    [38731, "RFC", "3:45 p.m.", "Chester, Montgomery", "High Winds", "--", 142315, "5:30 p.m. January 16"],
    [38732, "SPP", "Evening", "Kansas City", "Vandalism", 500, 270000, "NA"],
    [37286, "SPP", 0.25, "Oklahoma", "Ice Storm", 500, 1881134, 38736.5],
  );

  it("reads a time and a restoration in text, and a restoration as a number", () => {
    const { events } = oe417SheetRows(2006, sheet);
    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({ began: "2006-01-14T15:45", restored: "2006-01-16T17:30", type: "High Winds", customers: "142315" });
    expect(events[1]).toMatchObject({ began: null, restored: null, type: "Vandalism" });
    expect(events[2]?.restored).toBe("2006-01-19T12:00");
  });

  it("gives the restoration of a text in the next year when its month is before the month of the start", () => {
    const { events } = oe417SheetRows(2006, grid(["Date", "Time", "Area", "Type of Disturbance", "Number of Customers", "Restoration"], [38717, "11:00 p.m.", "Texas", "Ice Storm", 5, "2:00 a.m. January 2"]));
    expect(events[0]).toMatchObject({ began: "2005-12-31T23:00", restored: "2006-01-02T02:00" });
  });
});

const place = (parts: readonly (readonly [number, string])[]): string => {
  let line = "";
  for (const [at, text] of parts) line = `${line.padEnd(at)}${text}`;
  return line;
};

describe("the text of a PDF file", () => {
  const text = [
    "Table B1. Major Disturbances and Unusual Occurrences, 2000",
    "",
    place([[0, "Date"], [10, "Utility"], [32, "Time"], [42, "Area"], [60, "Type of"], [80, "Loss"], [90, "Number of"]]),
    place([[0, "(NERC Council)"], [60, "Disturbance"], [80, "(mega-"], [90, "Customers"]]),
    "",
    place([[0, "3/14/00"], [10, "Alliant Energy (MAIN)"], [32, "9:06 p.m."], [44, "Maine"], [60, "Vandalism"], [80, "NA"], [90, "NA"]]),
    "",
    place([[0, "4/20/00"], [10, "Independence"], [32, "NA"], [42, "NA"], [60, "Suspected"], [80, "None"], [90, "None"]]),
    place([[60, "Sabotage"]]),
    "",
    place([[0, "5/9/00"], [10, "Consolidated Edison"], [32, "11:39 a.m."], [44, "New York"], [60, "Ice"], [80, "450"], [90, "133,000"], [110, "12:00 p.m. Jan 28"]]),
    place([[60, "Storm"]]),
    "",
    "Source: Emergency Operations Center.",
  ].join("\n");

  it("reads a row at each line with a date, and a type that goes over two lines", () => {
    const { events, copies } = oe417PdfRows(2000, text);
    expect(copies).toBe(0);
    expect(events.map((event) => event.type)).toEqual(["Vandalism", "Suspected Sabotage", "Ice Storm"]);
    expect(events[0]).toMatchObject({ began: "2000-03-14T21:06", area: "Maine", megawatts: "NA", customers: "NA" });
    expect(events[1]?.began).toBeNull();
    expect(events[2]).toMatchObject({ began: "2000-05-09T11:39", area: "New York", megawatts: "450", customers: "133,000" });
  });

  it("gives the counts of the rows: the vandalism is an attack and the suspicion is not", () => {
    expect(oe417YearCounts(oe417PdfRows(2000, text))).toEqual({ rows: 3, copies: 0, attacks: 1, kept: 0, cyber: 0, cyberLoss: 0, spaceWeather: 0 });
  });

  it("gives no event for a text with no row", () => {
    expect(oe417PdfRows(2000, "Table B1.\n\nNothing").events).toEqual([]);
  });
});

describe("the counts of a summary", () => {
  const rows = {
    copies: 2,
    events: [
      { year: 2020, began: null, restored: null, area: "A", type: "Vandalism", customers: "5", megawatts: "Unknown" },
      { year: 2020, began: null, restored: null, area: "B", type: "Vandalism", customers: "0", megawatts: "0" },
      { year: 2020, began: null, restored: null, area: "C", type: "Suspected Physical Attack", customers: "9", megawatts: "9" },
      { year: 2020, began: null, restored: null, area: "D", type: "Cyber Event", customers: "0", megawatts: "3" },
      { year: 2020, began: null, restored: null, area: "E", type: "Cyber Event", customers: "0", megawatts: "0" },
      { year: 2020, began: null, restored: null, area: "F", type: "Geomagnetic storm", customers: "0", megawatts: "0" },
    ],
  };

  it("counts the rows, the attacks with and without a loss, the cyber events and the space weather", () => {
    expect(oe417YearCounts(rows)).toEqual({ rows: 6, copies: 2, attacks: 2, kept: 1, cyber: 2, cyberLoss: 1, spaceWeather: 1 });
    expect(oe417KeptEvents(rows).map((event) => event.area)).toEqual(["A"]);
  });
});

describe("the comparison with the dataset", () => {
  const same = { years: OE417_YEARS, events: OE417_ATTACK_EVENTS };

  it("lists nothing for a read that equals the dataset", () => {
    expect(oe417Compare(same, OE417_YEARS, OE417_ATTACK_EVENTS)).toEqual([]);
  });

  it("lists each count and each field that differs, a missing year and a missing event", () => {
    const first = OE417_ATTACK_EVENTS[0];
    if (first === undefined) throw new Error("The dataset has no event.");
    const { "2002": dropped, ...years } = OE417_YEARS;
    expect(dropped).toBeDefined();
    const changed = { ...years, "2003": { ...OE417_YEARS["2003"]!, rows: 64 } };
    const lines = oe417Compare({ years: changed, events: [{ ...first, area: "Elsewhere" }, ...OE417_ATTACK_EVENTS.slice(1, 100)] }, OE417_YEARS, OE417_ATTACK_EVENTS);
    expect(lines).toContain("2002: the read has no counts for this year.");
    expect(lines).toContain("2003: rows is 64, the dataset has 63.");
    expect(lines.some((line) => line.startsWith("event 0 (2011 Dixie Valley Area, Nevada): area is \"Elsewhere\""))).toBe(true);
    expect(lines.filter((line) => line.includes("the read has no event"))).toHaveLength(12);
  });

  it("names a year that the dataset lacks as new, not as a difference", () => {
    const fresh: string[] = [];
    const lines = oe417Compare({ years: { ...OE417_YEARS, "2024": OE417_YEARS["2023"]! }, events: OE417_ATTACK_EVENTS }, OE417_YEARS, OE417_ATTACK_EVENTS, fresh);
    expect(lines).toEqual([]);
    expect(fresh).toEqual(["2024"]);
  });
});
