import { joinRecords, type LayerParse, type LayerPiece } from "@mark1russell7/system-stack";
import { SETUP_SCHEMA, type SetupLayer } from "./layer.ts";

// The join of the setup layers of the fragments of a stack, for example one file of profiles for each owner.

/**
 * This function joins the setup layers of the fragments of a stack into one layer.
 *
 * - The variables and the profiles are in the order of the fragments.
 * - A variable name or a profile name in two or more fragments is a fault, also when the records are equal.
 *
 * A profile of one fragment can read a variable of a different fragment. The joined layer has the field `variables` when a fragment has it.
 * The function is pure, and it changes no layer. The gate `checkSetup` examines the joined layer afterward.
 *
 * @param pieces - The layers, with the name of the fragment of each one, in the order of the fragments.
 * @returns The joined layer, or the faults of the join.
 */
export function joinSetup(pieces: readonly LayerPiece<SetupLayer>[]): LayerParse<SetupLayer> {
  const variables = joinRecords(
    pieces,
    (layer) => layer.variables,
    (variable) => variable.name,
    "variable",
  );
  const profiles = joinRecords(
    pieces,
    (layer) => layer.profiles,
    (profile) => profile.name,
    "profile",
  );
  const errors = [...variables.errors, ...profiles.errors];
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    layer: {
      schema: SETUP_SCHEMA,
      ...(pieces.some((piece) => piece.layer.variables !== undefined) ? { variables: variables.items } : {}),
      profiles: profiles.items,
    },
  };
}
