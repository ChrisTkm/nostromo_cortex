import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["cjs"],
  platform: "node",
  target: "node20",
  bundle: true,
  clean: true,
  noExternal: [/./],
  splitting: false,
  sourcemap: false,
  dts: false,
});
