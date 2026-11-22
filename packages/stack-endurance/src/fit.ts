/** The relative tolerance of a take and of a fit. */
export const TOLERANCE = 1e-13;

/** One try of a fit: the amount that the stores could not give, out of the amount wanted, and the value of the try. */
export interface Try<T> {
  readonly short: number;
  readonly need: number;
  readonly value: T;
}

/** The result of a fit: the largest amount with no shortfall, and the value of its try. The value is `undefined` when only 0 fits. */
export interface Fit<T> {
  readonly x: number;
  readonly value: T | undefined;
}

/**
 * The count of the tries of `largestFit`, for the tests of the cost. It is not in the public API, and it does not change a result.
 */
export const fitTries = { count: 0 };

/**
 * This function gives the largest `x` in `[0, most]` at which `attempt` has no shortfall, to the relative tolerance `TOLERANCE`.
 *
 * - A try fits when its shortfall is not more than `TOLERANCE` times its need.
 * - The shortfall must not decrease when `x` increases. A take of a chain of converters gives a shortfall that is linear in parts.
 * - The first try is `most`. After it, each step tries the zero of the line through the last two tries that do not fit.
 *   With one try that does not fit, the step tries `x` times the part of the need that the stores gave.
 * - When a step does not halve the interval, the next step is a bisection. Thus a fit takes at most approximately twice the steps of a bisection.
 * - A step on the lower end tries a point just above it, so a correct estimate ends the fit in one more try.
 *
 * @param most - The upper limit of `x`
 * @param attempt - The try at an amount. It must not change its input
 * @returns The largest amount that fits, and the value of its try
 */
export function largestFit<T>(most: number, attempt: (x: number) => Try<T>): Fit<T> {
  const fits = (tried: Try<T>): boolean => tried.short <= TOLERANCE * tried.need;
  fitTries.count += 1;
  const first = attempt(most);
  if (fits(first)) return { x: most, value: first.value };
  let low = 0;
  let best: T | undefined;
  let high = most;
  let highShort = first.short;
  let highNeed = first.need;
  let before: { readonly x: number; readonly short: number } | undefined;
  let bisect = false;
  for (let step = 0; step < 400 && high - low > 4 * TOLERANCE * high; step += 1) {
    const width = high - low;
    let x: number;
    if (bisect) x = (low + high) / 2;
    else if (before !== undefined && before.short > highShort) x = high - (highShort * (before.x - high)) / (before.short - highShort);
    else x = high * (1 - highShort / highNeed);
    if (!(x < high)) x = (low + high) / 2;
    const floor = low + 2 * TOLERANCE * high;
    if (!(x > floor)) x = floor;
    fitTries.count += 1;
    const tried = attempt(x);
    if (fits(tried)) {
      low = x;
      best = tried.value;
      // A try that fits with a shortfall is in the band of the tolerance above the zero, so the fit ends.
      if (tried.short > 0) break;
    } else {
      before = { x: high, short: highShort };
      high = x;
      highShort = tried.short;
      highNeed = tried.need;
    }
    bisect = !bisect && high - low > width / 2;
  }
  return { x: low, value: best };
}
