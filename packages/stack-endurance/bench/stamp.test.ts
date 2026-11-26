import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configStamp, stampChanges, stampConfig, stampRecord } from "@mark1russell7/rigor-bench/stamp-gate";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const config = stampConfig(JSON.parse(readFileSync(join(here, "stamp.json"), "utf8")));

describe("the stamp config of the bench", () => {
  it("stamps the timed code of this checkout: the child, the code it calls and the packages it imports", { timeout: 60_000 }, async () => {
    const stamp = await configStamp(root, config);
    expect(stamp.inputs).toContain("bench/child.ts");
    expect(stamp.inputs).toContain("src/shortfall.ts");
    expect(stamp.inputs).toContain("src/best.ts");
    // independentStop calls survivalAt of the core (since system-stack 0.1.13). bestEndurance of the case best also reads
    // the dates, the stack and the working parts of the core. The other imports from the core serve other functions, so the tree shake drops them.
    expect(stamp.inputs.filter((input) => input.includes("system-stack/src/"))).toEqual(["../system-stack/src/cuts.ts", "../system-stack/src/dates.ts", "../system-stack/src/stack.ts", "../system-stack/src/working.ts"]);
    const engines = stampRecord(stamp).engines.map((engine) => engine.replace(/@[^@]*$/, ""));
    expect(engines).toEqual(expect.arrayContaining(["@mark1russell7/collections", "@mark1russell7/rigor-bench", "@mark1russell7/rigor-generators"]));
    expect(engines).not.toContain("@mark1russell7/system-stack");
    expect(stampChanges(stampRecord(stamp), stampRecord(await configStamp(root, config)))).toEqual([]);
  });
});
