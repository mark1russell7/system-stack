/**
 * The stamp of the timed code of the bench. It holds the code that the child of an arm runs, and the lock closure of each package that this code imports.
 * Two commits with the same stamp time the same code. So the bench of the second commit gives no new value, only noise.
 *
 * The stamp comes from `codeStamp` of rigor-bench: a bundle of `bench/child.ts` after a tree shake. Each package of the importer that the bundle imports is an engine.
 * The workflow starts the bench for each change of a file of the bench or of `bench.yml`, also when the change keeps the stamp.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { codeStamp, type CodeStamp } from "@mark1russell7/rigor-bench/code-stamp";

/** The entry that each child of an arm runs. */
export const TIMED_ENTRY = "bench/child.ts";
/** The key of the package in `importers` of the lock file. */
export const LOCK_IMPORTER = "packages/stack-endurance";
/** The package folder, from the root of the repository. */
const PACKAGE_DIR = "packages/stack-endurance";

/**
 * The words of `CODE_STAMP_READ_WORDS` in the bundle of the timed code. None of them opens a file or a host.
 * A new word in the bundle refuses the stamp, so a new read of a file shows before it can hide a change.
 */
export const STAMP_READS: readonly string[] = [];

/** The name of the package of an import specifier, or undefined for a relative path or a `node:` module. */
export function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("node:")) return undefined;
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** The specifiers of the static imports and re-exports of a source text. A match in a comment also counts, so the list can only say too much. */
export function importSpecifiers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g)) found.add((match[1] ?? match[2])!);
  return [...found].sort();
}

/**
 * The engines of the stamp: each package of the importer that a source file of the bundle imports.
 * A package that the importer has and the timed code does not import stays out, so a change of its lock lines moves no stamp.
 * A workspace package (`workspace:`) enters the bundle, and its code is in the stamp.
 */
export function enginesOf(manifest: { readonly dependencies?: Record<string, string>; readonly devDependencies?: Record<string, string> }, sources: readonly string[]): string[] {
  const own = new Map(Object.entries({ ...manifest.devDependencies, ...manifest.dependencies }));
  const imported = new Set(sources.flatMap((text) => importSpecifiers(text).map(packageOf)).filter((name): name is string => name !== undefined));
  return [...imported].filter((name) => own.has(name) && !own.get(name)!.startsWith("workspace:")).sort();
}

/**
 * This function gives the stamp of the timed code in the checkout at `root`. The lock file and the installed packages of that checkout decide it.
 * The first pass keeps each package of the importer outside the bundle, and it gives the source files of the bundle.
 * The second pass keeps only the packages that these files import, with their lock closure.
 */
export async function benchStamp(root: string): Promise<CodeStamp> {
  const cwd = resolve(root, PACKAGE_DIR);
  const manifest = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")) as Parameters<typeof enginesOf>[0];
  const all = Object.entries({ ...manifest.devDependencies, ...manifest.dependencies })
    .filter(([, range]) => !range.startsWith("workspace:"))
    .map(([name]) => name)
    .sort();
  const lock = { lockFile: "../../pnpm-lock.yaml", importer: LOCK_IMPORTER };
  const first = await codeStamp({ cwd, entries: [TIMED_ENTRY], engines: { ...lock, names: all }, reads: STAMP_READS });
  const sources = first.inputs.map((input) => readFileSync(resolve(cwd, input), "utf8"));
  return codeStamp({ cwd, entries: [TIMED_ENTRY], engines: { ...lock, names: enginesOf(manifest, sources) }, reads: STAMP_READS });
}

/** The record of a stamp that `main.ts stamp` writes. Only `hash` and `parts` are the stamp. The other fields tell what went in. */
export interface StampRecord {
  readonly schema: "bench-stamp/1";
  readonly hash: string;
  readonly parts: CodeStamp["parts"];
  readonly inputs: readonly string[];
  readonly engines: readonly string[];
}

/** This function gives the record of a stamp, with each engine as `name@version`. */
export function stampRecord(stamp: CodeStamp): StampRecord {
  return { schema: "bench-stamp/1", hash: stamp.hash, parts: stamp.parts, inputs: stamp.inputs, engines: stamp.engines.map((engine) => `${engine.name}@${engine.version}`) };
}

/**
 * This function gives the parts of the stamp that differ between two records: `code`, `engines`, `data` or `node`.
 * An empty list means the same timed code. A record that is not a stamp record gives `record`, so the caller times again.
 */
export function stampChanges(base: unknown, head: unknown): string[] {
  const valid = (record: unknown): record is StampRecord =>
    typeof record === "object" && record !== null && (record as StampRecord).schema === "bench-stamp/1" && typeof (record as StampRecord).hash === "string" && typeof (record as StampRecord).parts === "object";
  if (!valid(base) || !valid(head)) return ["record"];
  const parts = (["code", "engines", "data", "node"] as const).filter((part) => base.parts[part] !== head.parts[part]);
  return parts.length === 0 && base.hash !== head.hash ? ["hash"] : parts;
}
