import type { Source } from "@mark1russell7/guidebook";

// The record of a source of a table: a source of `@mark1russell7/guidebook`, and the hash of the file of the read.
// The field `sha256` moves to the `Source` of guidebook later. Until then, only its form is examined here.

/**
 * A source of a table: a source of `@mark1russell7/guidebook`, with the SHA-256 hash of the file of the read.
 * The hash has 64 lowercase hexadecimal digits. A page with no fixed file has no hash.
 */
export type HashedSource = Source & { readonly sha256?: string };
