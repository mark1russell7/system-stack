import { joinRecords, joinSetting, type LayerParse, type LayerPiece } from "@mark1russell7/system-stack";
import { providerAddress, resourceAddress, TOFU_SCHEMA, type TofuLayer } from "./layer.ts";

// The join of the OpenTofu layers of the fragments of a stack, for example one file of resources for each owner.

/**
 * This function joins the OpenTofu layers of the fragments of a stack into one layer.
 *
 * - The resources, the provider configurations and the variables are in the order of the fragments.
 * - A resource address in two or more fragments is a fault, also when the resources are equal.
 * - The same rule holds for the address of a provider configuration and for the name of a variable.
 * - The layer has one version of OpenTofu. A fragment with a different value is a fault.
 * - The state has one place. Thus a backend in two or more fragments is a fault, also when the backends are equal.
 *
 * A resource of one fragment can use a provider configuration or a variable of a different fragment.
 * The joined layer has the field `providers` or `variables` when a fragment has it. The function is pure, and it
 * changes no layer. The gate `checkTofu` examines the joined layer afterward.
 *
 * @param pieces - The layers, with the name of the fragment of each one, in the order of the fragments.
 * @returns The joined layer, or the faults of the join.
 */
export function joinTofu(pieces: readonly LayerPiece<TofuLayer>[]): LayerParse<TofuLayer> {
  const version = joinSetting(pieces, (layer) => layer.version, "version of OpenTofu");
  const backends = pieces.filter((piece) => piece.layer.backend !== undefined);
  const providers = joinRecords(pieces, (layer) => layer.providers, providerAddress, "provider configuration");
  const variables = joinRecords(
    pieces,
    (layer) => layer.variables,
    (variable) => variable.name,
    "variable",
  );
  const resources = joinRecords(pieces, (layer) => layer.resources, resourceAddress, "resource");
  const errors = [...version.errors];
  if (backends.length > 1) errors.push(`The fragments ${backends.map((piece) => `"${piece.from}"`).join(", ")} each have a backend. The state has one place.`);
  errors.push(...providers.errors, ...variables.errors, ...resources.errors);
  if (errors.length > 0) return { ok: false, errors };
  const backend = backends[0]?.layer.backend;
  return {
    ok: true,
    layer: {
      schema: TOFU_SCHEMA,
      ...(version.value === undefined ? {} : { version: version.value }),
      ...(backend === undefined ? {} : { backend }),
      ...(pieces.some((piece) => piece.layer.providers !== undefined) ? { providers: providers.items } : {}),
      ...(pieces.some((piece) => piece.layer.variables !== undefined) ? { variables: variables.items } : {}),
      resources: resources.items,
    },
  };
}
