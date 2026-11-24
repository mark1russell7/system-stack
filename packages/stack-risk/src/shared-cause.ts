// The fit of one shared part to the measured chances of a group of parts.

/**
 * The measured chances of a group of parts in one window of time.
 *
 * - `works`: the chance that each part works, from 0 to 1. The group has 2 or more parts.
 * - `anyWorks`: the chance that one or more parts of the group work in the same window.
 */
export interface GroupChances {
  readonly works: readonly number[];
  readonly anyWorks: number;
}

/**
 * The result of `sharedCauseFit`.
 *
 * - `shared`: the chance that the shared part works.
 * - `own`: the chance that the own part of each part works, in the sequence of `works`.
 *
 * A part of the group works when the shared part and its own part work. Each part works or fails alone. Thus put the
 * shared part in the stack as a need of each part of the group, with the chance `shared`. Give each part its `own` chance.
 */
export interface SharedCauseFit {
  readonly shared: number;
  readonly own: readonly number[];
}

/** The count of the halvings of the interval of `shared` for a group of 3 or more parts. */
const STEPS = 200;

/** This function tells if a value is a chance: a number from 0 to 1. */
function isChance(value: number): boolean {
  return value >= 0 && value <= 1;
}

// The chance that one or more parts work, when the shared part works with the chance `shared`.
function anyWorksAt(works: readonly number[], shared: number): number {
  return shared * (1 - works.reduce((none, value) => none * (1 - value / shared), 1));
}

/**
 * This function gives the shared part that explains the measured chances of a group of parts.
 *
 * - The model: a part works when one shared part and its own part work. Each of these parts works or fails alone.
 * - The chance that one or more parts work rises with `shared`. Its slope is the chance that two or more own parts work.
 *   Thus one value of `shared` fits, from the largest chance of `works` to 1.
 * - For two parts, the value is exact: `shared = r1 * r2 / (r1 + r2 - anyWorks)`. For 3 or more parts, halvings of the
 *   interval find the value.
 * - When the parts fail less often together than independent parts, no shared part fits. Then `shared` is 1, and each
 *   `own` chance is the measured chance. A part that does not work at any time gives no information about the shared part.
 *
 * The function is pure.
 *
 * @throws RangeError when the group has fewer than 2 parts or a value is not a chance. Also when `anyWorks` is less
 * than the largest chance of `works`.
 */
export function sharedCauseFit(group: GroupChances): SharedCauseFit {
  const { works, anyWorks } = group;
  if (works.length < 2) throw new RangeError(`The group has ${String(works.length)} parts. A fit needs 2 or more parts.`);
  for (const value of [...works, anyWorks]) if (!isChance(value)) throw new RangeError(`The chance ${String(value)} is not from 0 to 1.`);
  const largest = Math.max(...works);
  if (anyWorks < largest) throw new RangeError(`The chance ${String(anyWorks)} that one or more parts work is less than the chance ${String(largest)} of one part.`);
  const fit = (shared: number): SharedCauseFit => ({ shared, own: works.map((value) => (shared === 0 ? 0 : Math.min(1, value / shared))) });
  // Independent parts: the largest value that `anyWorks` can have with a shared part.
  if (anyWorks >= anyWorksAt(works, 1)) return fit(1);
  if (works.length === 2) {
    const [first = 0, second = 0] = works;
    return fit(Math.min(1, Math.max(largest, (first * second) / (first + second - anyWorks))));
  }
  let low = largest;
  let high = 1;
  for (let step = 0; step < STEPS && low < high; step += 1) {
    const middle = (low + high) / 2;
    if (middle === low || middle === high) break;
    if (anyWorksAt(works, middle) < anyWorks) low = middle;
    else high = middle;
  }
  return fit((low + high) / 2);
}
