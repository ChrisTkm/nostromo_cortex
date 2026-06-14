import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    external: [
      "@modelcontextprotocol/sdk",
      "mongodb",
      "zod",
      "better-sqlite3",
    ],
    clean: true,
  },
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    outDir: "dist",
    external: [
      "@modelcontextprotocol/sdk",
      "mongodb",
      "zod",
      "better-sqlite3",
    ],
    banner: {
      js: "#!/usr/bin/env node",
    },
    clean: false,
  },
]);
