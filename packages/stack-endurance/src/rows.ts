import { add, fromFloat, type Rational, ZERO } from "@mark1russell7/rational";

// The internal rows of the linear programs of the queries. The root entry does not give them.

/** A sparse row: the coefficient of each variable, by its index. */
export type Row = Map<number, Rational>;

/** This function adds `value` to the coefficient of the variable `index` in `row`. It changes `row`. */
export function addTo(row: Row, index: number, value: Rational): void {
  row.set(index, add(row.get(index) ?? ZERO, value));
}

/** This function gives the dense form of a row: one coefficient for each of `count` variables. */
export function dense(row: Row, count: number): Rational[] {
  const out = new Array<Rational>(count).fill(ZERO);
  for (const [index, value] of row) out[index] = value;
  return out;
}

/** This function gives the exact rational of a finite double, with no rounding. A double is a dyadic rational. */
export function exact(value: number): Rational {
  return fromFloat(value);
}
