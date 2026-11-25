import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { benchStamp, enginesOf, importSpecifiers, packageOf, stampChanges, stampRecord, TIMED_ENTRY } from "./stamp.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("packageOf", () => {
  it("gives the package of a bare specifier, with its scope, and no package for a path or a node module", () => {
    expect(packageOf("@a/b")).toBe("@a/b");
    expect(packageOf("@a/b/graph")).toBe("@a/b");
    expect(packageOf("zod")).toBe("zod");
    expect(packageOf("zod/mini")).toBe("zod");
    expect(packageOf("./x.ts")).toBeUndefined();
    expect(packageOf("../src/x.ts")).toBeUndefined();
    expect(packageOf("node:fs")).toBeUndefined();
  });
});

describe("importSpecifiers", () => {
  it("finds imports, type imports, re-exports and imports for side effects, each one time", () => {
    const text = [
      'import { a } from "@a/b";',
      'import type { T } from "@a/c/types";',
      "import {",
      "  x,",
      "  y,",
      '} from "./local.ts";',
      'export { z } from "zod";',
      'export * from "./more.ts";',
      'import "@a/side";',
      'import { a as again } from "@a/b";',
    ].join("\n");
    expect(importSpecifiers(text)).toEqual(["./local.ts", "./more.ts", "@a/b", "@a/c/types", "@a/side", "zod"]);
  });
});

describe("enginesOf", () => {
  const manifest = { dependencies: { "@a/b": "^1.0.0", "@a/core": "workspace:*", unused: "^2.0.0" }, devDependencies: { "@a/bench": "^0.3.0" } };

  it("keeps each package of the manifest that a source imports, and leaves out a workspace package", () => {
    const sources = ['import { a } from "@a/b/graph";', 'import { c } from "@a/core";\nimport { t } from "@a/bench";', 'import { n } from "not-in-the-manifest";'];
    expect(enginesOf(manifest, sources)).toEqual(["@a/b", "@a/bench"]);
  });

  it("gives no engine when no source imports a package", () => {
    expect(enginesOf(manifest, ['import { x } from "./x.ts";'])).toEqual([]);
  });
});

describe("stampChanges", () => {
  const record = (code: string, engines = "e") => ({ schema: "bench-stamp/1", hash: `${code}${engines}`, parts: { code, engines, data: "d", bundler: "esbuild@1", node: "26" }, inputs: [], engines: [] });

  it("gives no part for the same stamp, and each part that differs", () => {
    expect(stampChanges(record("c"), record("c"))).toEqual([]);
    expect(stampChanges(record("c"), record("c2"))).toEqual(["code"]);
    expect(stampChanges(record("c"), record("c2", "e2"))).toEqual(["code", "engines"]);
  });

  it("gives record for a missing or unknown record, so the bench runs", () => {
    expect(stampChanges(undefined, record("c"))).toEqual(["record"]);
    expect(stampChanges(record("c"), { schema: "other" })).toEqual(["record"]);
  });

  it("does not count the version of the bundler, which is not in the hash", () => {
    const other = { ...record("c"), parts: { ...record("c").parts, bundler: "esbuild@2" } };
    expect(stampChanges(record("c"), other)).toEqual([]);
  });
});

describe("benchStamp", () => {
  it("stamps the timed code of this checkout: the child, the code it calls and the packages it imports", { timeout: 60_000 }, async () => {
    const stamp = await benchStamp(root);
    expect(stamp.inputs).toContain(TIMED_ENTRY);
    expect(stamp.inputs).toContain("src/shortfall.ts");
    // independentStop calls no function of system-stack. The imports of shortfall.ts from it serve other functions, so the tree shake drops them.
    expect(stamp.inputs.filter((input) => input.includes("system-stack/src/"))).toEqual([]);
    const engines = stampRecord(stamp).engines.map((engine) => engine.replace(/@[^@]*$/, ""));
    expect(engines).toEqual(expect.arrayContaining(["@mark1russell7/collections", "@mark1russell7/rigor-bench", "@mark1russell7/rigor-generators"]));
    expect(engines).not.toContain("@mark1russell7/system-stack");
    expect(stampChanges(stampRecord(stamp), stampRecord(await benchStamp(root)))).toEqual([]);
  });
});
