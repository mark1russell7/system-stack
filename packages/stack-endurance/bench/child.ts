/**
 * The child of one arm of the bench: `node bench/child.ts --case m12`.
 * It times the function of the case on its input with `timeArm`, and it prints one JSON line.
 * The cases `m4` to `m14` time `independentStop` on a seeded input. The case `best` times `bestEndurance` on `bestInput`.
 * The hash of the line is the hash of the result, so two children of one case give the same result.
 */
import { timeArm } from "@mark1russell7/rigor-bench";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import { bestEndurance } from "../src/best.ts";
import { independentStop } from "../src/shortfall.ts";
import { BEST_CASE, bestInput, cutsOf, independentInput } from "./inputs.ts";

/** The counted samples of each child. */
export const CHILD_SAMPLES = 7;

/** The measure of one case: the call to time, its result, and the counts of the input for the line. */
interface Measure {
  readonly call: () => unknown;
  readonly result: unknown;
  readonly counts: Readonly<Record<string, number>>;
}

/** This function gives the measure of a case id, or `undefined` for an id that is not a case of the bench. */
function measureOf(id: string | undefined): Measure | undefined {
  if (id === BEST_CASE) {
    const input = bestInput();
    const call = (): unknown => bestEndurance(input.layer, input.caseCuts, input.options);
    return { call, result: call(), counts: { draws: input.layer.draws.length, converters: input.layer.converters?.length ?? 0 } };
  }
  const cuts = id === undefined ? undefined : cutsOf(id);
  if (cuts === undefined) return undefined;
  const input = independentInput(cuts);
  const curve = independentStop(input.curves, input.sets);
  if (curve === undefined) throw new Error(`independentStop gave no curve for ${String(id)}.`);
  return { call: () => independentStop(input.curves, input.sets), result: curve, counts: { points: curve.length, sets: input.sets.length } };
}

const at = process.argv.indexOf("--case");
const id = at < 0 ? undefined : process.argv[at + 1];
const measure = measureOf(id);
if (measure === undefined) {
  process.stderr.write(`The child needs --case with a case of the bench, not ${String(id)}.\n`);
  process.exit(2);
}
const time = timeArm(measure.call, { samples: CHILD_SAMPLES });
process.stdout.write(
  `${JSON.stringify({ ms: time.ms, hash: canonicalHash(measure.result), warm: time.warm, calls: time.calls, ...measure.counts, samples: time.samples })}\n`,
);
