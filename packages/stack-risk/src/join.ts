import { joinRecords, type LayerParse, type LayerPiece } from "@mark1russell7/system-stack";
import { RISK_SCHEMA, type RiskLayer } from "./layer.ts";

// The join of the risk layers of the fragments of a stack, for example one file of goals for each owner.

/**
 * This function joins the risk layers of the fragments of a stack into one layer.
 *
 * - The goals and the chance records are in the order of the fragments. The record of a part is in one fragment.
 * - A part with a goal in two or more fragments is a fault, also when the goals are equal.
 * - A part with a chance record in two or more fragments is a fault, also when the records are equal.
 * - The accepted risks are in the order of the fragments. A fragment can accept a risk of a goal of a different fragment.
 *
 * The joined layer has the field `chances` or `accepted` when a fragment has it. The function is pure, and it
 * changes no layer. The gate `checkRisk` examines the joined layer afterward.
 *
 * @param pieces - The layers, with the name of the fragment of each one, in the order of the fragments.
 * @returns The joined layer, or the faults of the join.
 */
export function joinRisk(pieces: readonly LayerPiece<RiskLayer>[]): LayerParse<RiskLayer> {
  const goals = joinRecords(
    pieces,
    (layer) => layer.goals,
    (goal) => goal.part,
    "goal of the part",
  );
  const chances = joinRecords(
    pieces,
    (layer) => layer.chances,
    (chance) => chance.part,
    "chance record of the part",
  );
  const errors = [...goals.errors, ...chances.errors];
  if (errors.length > 0) return { ok: false, errors };
  const withChances = pieces.some((piece) => piece.layer.chances !== undefined);
  const withAccepted = pieces.some((piece) => piece.layer.accepted !== undefined);
  return {
    ok: true,
    layer: {
      schema: RISK_SCHEMA,
      goals: goals.items,
      ...(withChances ? { chances: chances.items } : {}),
      ...(withAccepted ? { accepted: pieces.flatMap((piece) => piece.layer.accepted ?? []) } : {}),
    },
  };
}
