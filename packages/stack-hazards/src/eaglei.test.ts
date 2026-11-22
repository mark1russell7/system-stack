import { describe, expect, it } from "vitest";
import { eagleCustomers, eagleLine, eagleRegion } from "./eaglei.ts";
import { outageReader } from "./outages.ts";

// Made-up lines in the forms of the files. The code 99 is not the code of a state.
const utc = (text: string): number => Date.parse(`${text.replace(" ", "T")}Z`) / 1000;

describe("eagleLine", () => {
  it("reads the forms of each year, and gives no count for a header", () => {
    expect(eagleLine("fips_code,county,state,customers_out,run_start_time")).toBeUndefined();
    expect(eagleLine("fips_code,county,state,sum,run_start_time")).toBeUndefined();
    expect(eagleLine("99001,Testcounty,Teststate,12,2020-01-01 00:15:00")).toEqual({ area: "99001", out: 12, time: utc("2020-01-01 00:15:00") });
    expect(eagleLine("99001,Testcounty,Teststate,2,2024-01-01 00:15:00,29666\r")).toEqual({ area: "99001", out: 2, time: utc("2024-01-01 00:15:00") });
  });

  it("reads a county name with a comma in quotes, and gives 5 digits to a code of 4 digits", () => {
    expect(eagleLine('99003,"Test, North",Teststate,7,2021-06-01 12:00:00')?.out).toBe(7);
    expect(eagleLine("9001,Testcounty,Teststate,3,2021-06-01 12:00:00")?.area).toBe("09001");
  });

  it("gives no count for a line that it cannot read", () => {
    expect(eagleLine("99001,Testcounty,Teststate,,2020-01-01 00:00:00")).toBeUndefined();
    expect(eagleLine("county,Testcounty,Teststate,4,2020-01-01 00:00:00")).toBeUndefined();
    expect(eagleLine("99001,Testcounty,Teststate,4")).toBeUndefined();
    expect(eagleLine("")).toBeUndefined();
  });
});

describe("eagleCustomers and eagleRegion", () => {
  it("reads the customers of each county, with the mark of the byte order and the line ends of Windows", () => {
    expect(eagleCustomers("﻿County_FIPS,Customers\r\n9001,24619\r\n99003,100\n")).toEqual(
      new Map([
        ["09001", 24_619],
        ["99003", 100],
      ]),
    );
    expect(eagleRegion("99003")).toBe("99");
  });

  it("gives the events of the lines of a file", () => {
    const lines = ["fips_code,county,state,customers_out,run_start_time"];
    for (let minute = 0; minute <= 120; minute += 15) {
      const time = `2020-01-01 ${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00`;
      lines.push(`99009,Filler,Teststate,1,${time}`);
      if (minute >= 30 && minute <= 75) lines.push(`99001,Testcounty,Teststate,40,${time}`);
    }
    const reader = outageReader({ customers: eagleCustomers("99001,1000\n99009,100000") });
    for (const line of lines) {
      const count = eagleLine(line);
      if (count !== undefined) reader.add(count);
    }
    expect(reader.finish().events).toEqual([{ area: "99001", start: utc("2020-01-01 00:30:00"), seconds: 3600, peak: 40, censored: false }]);
  });
});
