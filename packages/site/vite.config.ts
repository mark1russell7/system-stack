import { defineConfig } from "vite";

// The Pages workflow sets SITE_BASE to "/system-stack". A local build uses the root.
const site = process.env["SITE_BASE"];

export default defineConfig({
  base: site ? `${site.replace(/\/$/, "")}/` : "/",
  build: { target: "es2022" },
});
