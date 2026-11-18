import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Fault } from "./check.ts";
import { holdKnown, KNOWN_SCHEMA, type KnownFault } from "./known.ts";
import { parseKnown } from "./schema.ts";

const today = "2026-11-18";
const error = (code: string, at: string, other?: string): Fault =>
  other === undefined ? { level: "error", code, at, message: `${code} at ${at}.` } : { level: "error", code, at, other, message: `${code} at ${at}.` };
const known = (code: string, at: string, until = "2026-12-01", other?: string): KnownFault =>
  other === undefined ? { code, at, reason: "The owner waits for a plan.", until } : { code, at, other, reason: "The owner waits for a plan.", until };
const codes = (faults: readonly Fault[]): string[] => faults.map((fault) => `${fault.level} ${fault.code} ${fault.at}`);

describe("holdKnown", () => {
  it("makes a known error a warning, with the reason and the last date", () => {
    const held = holdKnown([error("limit-none", "meter:a")], [known("limit-none", "meter:a")], { today });
    expect(held).toEqual([
      {
        level: "warning",
        code: "limit-none",
        at: "meter:a",
        message: "limit-none at meter:a. The owner knows this fault until 2026-12-01: The owner waits for a plan.",
      },
    ]);
  });

  it("keeps a new error an error, so that a new fault stops the gate", () => {
    const held = holdKnown([error("limit-none", "meter:a"), error("limit-none", "meter:b")], [known("limit-none", "meter:a")], { today });
    expect(codes(held)).toEqual(["warning limit-none meter:a", "error limit-none meter:b"]);
  });

  it("matches the code, the record and the second record", () => {
    const faults = [error("need-part", "a", "b"), error("need-part", "a", "c"), error("proof-none", "a")];
    const held = holdKnown(faults, [known("need-part", "a", "2026-12-01", "b")], { today });
    expect(codes(held)).toEqual(["warning need-part a", "error need-part a", "error proof-none a"]);
    // A known fault with no second record does not match a fault with one.
    expect(codes(holdKnown([error("need-part", "a", "b")], [known("need-part", "a")], { today }))).toEqual(["error need-part a", "error known-unused a"]);
  });

  it("keeps a warning a warning", () => {
    const warning: Fault = { level: "warning", code: "end-soon", at: "account:a", message: "The plan ends." };
    expect(holdKnown([warning], [known("end-soon", "account:a")], { today })).toEqual([warning]);
  });

  it("holds the known fault on its last date, and makes it an error on the day after", () => {
    expect(codes(holdKnown([error("x", "a")], [known("x", "a", today)], { today }))).toEqual(["warning x a"]);
    const late = holdKnown([error("x", "a")], [known("x", "a", "2026-11-17")], { today });
    expect(codes(late)).toEqual(["error x a", "error known-old a"]);
    expect(late[1]?.message).toBe('The known fault x of "a" ended on 2026-11-17. Correct the fault, or give a new reason and a new date.');
  });

  it("finds a known fault that matches no fault, also an old one", () => {
    expect(codes(holdKnown([], [known("x", "a"), known("y", "b", "2026-01-01")], { today }))).toEqual(["error known-unused a", "error known-unused b"]);
  });

  it("finds a last date that is not a date, and that known fault has no effect", () => {
    const held = holdKnown([error("x", "a")], [known("x", "a", "2026-02-30")], { today });
    expect(codes(held)).toEqual(["error x a", "error known-date a"]);
  });

  it("finds a known fault that is in the list two times, and the first one has the effect", () => {
    const list = [known("x", "a", "2026-12-01"), known("x", "a", "2026-11-01")];
    const held = holdKnown([error("x", "a")], list, { today });
    expect(codes(held)).toEqual(["warning x a", "error known-twice a"]);
  });

  it("gives the faults of the list in the sequence of the list, with the second record", () => {
    const list = [known("x", "a", "2026-11-01"), known("y", "b", "bad"), known("z", "c", "2026-12-01", "d")];
    const held = holdKnown([error("x", "a")], list, { today });
    expect(held.slice(1).map((fault) => [fault.code, fault.at, fault.other])).toEqual([
      ["known-old", "a", undefined],
      ["known-date", "b", undefined],
      ["known-unused", "c", "d"],
    ]);
  });

  it("refuses a date of the check that is not a date", () => {
    expect(() => holdKnown([], [], { today: "18 Nov 2026" })).toThrow(RangeError);
  });

  it("does not change its input", () => {
    const faults = [error("x", "a")];
    const list = [known("x", "a")];
    const copy = structuredClone({ faults, list });
    holdKnown(faults, list, { today });
    expect({ faults, list }).toEqual(copy);
  });

  it("holds each law over random faults and known faults", () => {
    const key = fc.record({ code: fc.constantFrom("x", "y"), at: fc.constantFrom("a", "b", "c") });
    const day = fc.constantFrom("2026-11-17", "2026-11-18", "2026-11-19", "bad");
    fc.assert(
      fc.property(
        fc.array(fc.record({ key, level: fc.constantFrom("error" as const, "warning" as const) }), { maxLength: 6 }),
        fc.array(fc.record({ key, until: day }), { maxLength: 6 }),
        (rawFaults, rawKnown) => {
          const faults: Fault[] = rawFaults.map(({ key: k, level }) => ({ level, code: k.code, at: k.at, message: "m" }));
          const list: KnownFault[] = rawKnown.map(({ key: k, until }) => ({ code: k.code, at: k.at, reason: "r", until }));
          const held = holdKnown(faults, list, { today });
          // Each fault of the input keeps its place, its code and its record.
          expect(held.slice(0, faults.length).map((fault) => [fault.code, fault.at])).toEqual(faults.map((fault) => [fault.code, fault.at]));
          // A fault that no known fault names keeps its level.
          for (const [index, fault] of faults.entries()) {
            if (!list.some((record) => record.code === fault.code && record.at === fault.at)) expect(held[index]?.level).toBe(fault.level);
          }
          // No list makes a warning of an error with no valid and current match: so the gate holds.
          const errorsIn = faults.filter((fault) => fault.level === "error").length;
          const errorsOut = held.filter((fault) => fault.level === "error").length;
          const current = new Set(list.filter((record) => record.until === "2026-11-18" || record.until === "2026-11-19").map((record) => `${record.code} ${record.at}`));
          const excused = faults.filter((fault) => fault.level === "error" && current.has(`${fault.code} ${fault.at}`)).length;
          expect(errorsOut).toBeGreaterThanOrEqual(errorsIn - excused);
          // Each fault of the list has a code of the list.
          for (const fault of held.slice(faults.length)) expect(fault.code.startsWith("known-")).toBe(true);
        },
      ),
    );
  });
});

describe("parseKnown", () => {
  it("reads a list of known faults", () => {
    const value = { schema: KNOWN_SCHEMA, known: [known("x", "a"), known("y", "b", "2026-12-01", "c")] };
    expect(parseKnown(value)).toEqual({ ok: true, list: value });
  });

  it("refuses a field that the format does not have, a missing reason and a wrong schema", () => {
    const extra = parseKnown({ schema: KNOWN_SCHEMA, known: [{ ...known("x", "a"), note: "n" }] });
    expect(extra.ok).toBe(false);
    const noReason = parseKnown({ schema: KNOWN_SCHEMA, known: [{ code: "x", at: "a", until: today }] });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.errors[0]).toContain('"known.0.reason"');
    expect(parseKnown({ schema: "known/2", known: [] }).ok).toBe(false);
  });
});
