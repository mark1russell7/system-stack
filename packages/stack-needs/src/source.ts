// The record of a source of reference data. It has the fields of a source of stack-hazards, and the hash of a file.

/** A date as `YYYY-MM-DD`. */
export type IsoDate = string;

/** The license of a source. */
export interface License {
  /** The name of the license, for example "Public domain". */
  readonly name: string;
  /** The page that tells the terms of the reuse. */
  readonly url: string;
}

/** A source: a public page, a public file or a public dataset. */
export interface Source {
  /** A short name of the source. */
  readonly name: string;
  readonly url: string;
  /** The organization that publishes the source. */
  readonly publisher: string;
  readonly license: License;
  /** The date that the source shows as its last change. */
  readonly updated?: IsoDate | undefined;
  /** The date of the read of the source. */
  readonly read: IsoDate;
  /** The SHA-256 hash of the file of the read, as 64 lowercase hexadecimal digits. A page with no fixed file has no hash. */
  readonly sha256?: string | undefined;
}
