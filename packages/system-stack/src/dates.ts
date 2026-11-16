// The dates of the records. A record gives a date as a text `YYYY-MM-DD`. A check has no clock: its caller gives the date of the check.

const DAY = 86_400_000;

/**
 * This function gives the number of the day of a date `YYYY-MM-DD`: the count of days from 1970-01-01.
 * A text that is not a date of the calendar gives `undefined`. Thus `2026-02-30` is not a date.
 */
export function dayNumber(date: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return undefined;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time = new Date(Date.UTC(year, month - 1, day));
  if (time.getUTCFullYear() !== year || time.getUTCMonth() !== month - 1 || time.getUTCDate() !== day) return undefined;
  return time.getTime() / DAY;
}
