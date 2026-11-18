// The import boundaries of the workspace (@mark1russell7/boundaries): another package is imported only
// through an entry of its package.json. Start the check with `pnpm check:boundaries`.
import { boundaries, type Config } from "@mark1russell7/boundaries";

// The source files of the library packages: the core and each add-on.
const library = "^packages/(system-stack|stack-[^/]+)/src/";

const config: Config = boundaries(import.meta.dirname, {
  // The default options keep each package of npm out of the graph. The rule of zod must see them, so this exclude
  // has no `node_modules`. The option `doNotFollow` of the defaults still stops the analysis at a package of npm.
  options: { exclude: { path: "\\.(test|spec|e2e)\\.[cm]?[jt]sx?$|\\.d\\.[cm]?ts$|/(test|tests|e2e|__tests__|fixtures)/" } },
  forbidden: [
    {
      name: "schema-library-out-of-the-entry-schema",
      severity: "error",
      comment: "Only the entry /schema of a library package imports zod. Thus the root entry has no schema library.",
      from: { path: library, pathNot: `${library}schema\\.ts$` },
      to: { path: "node_modules/zod/" },
    },
    {
      name: "root-entry-gets-to-an-entry-schema",
      severity: "error",
      comment: "The root entry of a library package does not import an entry /schema, directly or through other files.",
      from: { path: `${library}index\\.ts$` },
      to: { path: `${library}schema\\.ts$`, reachable: true },
    },
    {
      name: "add-on-imports-an-add-on",
      severity: "error",
      comment: "An add-on does not import a different add-on. A host, a site or a test joins them. The tests are not in the graph.",
      from: { path: "^packages/stack-([^/]+)/src/" },
      to: {
        path: "^packages/stack-[^/]+/|node_modules/@mark1russell7/stack-[^/]+/",
        pathNot: "^packages/stack-$1/|node_modules/@mark1russell7/stack-$1/",
      },
    },
  ],
});
export default config;
