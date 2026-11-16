import { describe, expect, it } from "vitest";
import { dayNumber } from "./dates.ts";

describe("dayNumber", () => {
  it("gives the count of days from 1970-01-01", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("2026-11-16")).toBe(20773);
    expect((dayNumber("2028-03-01") ?? 0) - (dayNumber("2028-02-28") ?? 0)).toBe(2);
  });

  it("gives undefined for a text that is not a date of the calendar", () => {
    expect(dayNumber("2026-02-30")).toBeUndefined();
    expect(dayNumber("2026-13-01")).toBeUndefined();
    expect(dayNumber("2026-1-1")).toBeUndefined();
    expect(dayNumber("2026-11-16T00:00:00Z")).toBeUndefined();
    expect(dayNumber("")).toBeUndefined();
  });
});
