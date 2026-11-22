/**
 * The child of one arm of the bench: `node bench/child.ts --case m12`.
 * It times `independentStop` on the seeded input of the case with `timeArm`, and it prints one JSON line.
 * The hash of the line is the hash of the curve, so two children of one case give the same result.
 */
import { timeArm } from "@mark1russell7/rigor-bench";
import { canonicalHash } from "@mark1russell7/rigor-generators";
import { independentStop } from "../src/shortfall.ts";
import { cutsOf, independentInput } from "./inputs.ts";

/** The counted samples of each child. */
export const CHILD_SAMPLES = 7;

const at = process.argv.indexOf("--case");
const id = at < 0 ? undefined : process.argv[at + 1];
const cuts = id === undefined ? undefined : cutsOf(id);
if (cuts === undefined) {
  process.stderr.write(`The child needs --case with a case of the bench, not ${String(id)}.\n`);
  process.exit(2);
}
const input = independentInput(cuts);
const curve = independentStop(input.curves, input.sets);
if (curve === undefined) throw new Error(`independentStop gave no curve for ${String(id)}.`);
const time = timeArm(() => independentStop(input.curves, input.sets), { samples: CHILD_SAMPLES });
process.stdout.write(
  `${JSON.stringify({ ms: time.ms, hash: canonicalHash(curve), warm: time.warm, calls: time.calls, points: curve.length, sets: input.sets.length, samples: time.samples })}\n`,
);
