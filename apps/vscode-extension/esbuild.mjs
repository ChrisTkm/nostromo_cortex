import esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  sourcemap: true,
  format: "esm",
  platform: "node",
  target: "node20"
};

const contexts = await Promise.all([
  esbuild.context({
    ...shared,
    entryPoints: ["src/extension.ts"],
    format: "cjs",
    outfile: "dist/extension.cjs",
    external: ["vscode"]
  }),
  esbuild.context({
    bundle: true,
    sourcemap: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    // The webview now mounts a React TSX entry but still ships as a single browser bundle.
    jsx: "automatic",
    loader: { ".tsx": "tsx" },
    entryPoints: ["src/webview/index.tsx"],
    outfile: "media/webview.js"
  })
]);

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("Watching Cortex VS Code extension...");
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}
