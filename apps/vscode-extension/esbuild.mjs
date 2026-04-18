import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const minify = !watch;

const shared = {
  bundle: true,
  sourcemap: minify ? "linked" : true,
  minify,
  format: "esm",
  platform: "node",
  target: "node20"
};

const browserBundle = {
  bundle: true,
  sourcemap: minify ? "linked" : true,
  minify,
  format: "iife",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  loader: { ".tsx": "tsx" }
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
    ...browserBundle,
    // The graph webview ships as a single browser bundle.
    entryPoints: ["src/webview/index.tsx"],
    outfile: "media/webview.js"
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/notes/index.tsx"],
    outfile: "media/notes.js"
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/logs/index.tsx"],
    outfile: "media/logs.js"
  })
]);

if (watch) {
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("Watching Cortex VS Code extension...");
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await Promise.all(contexts.map((context) => context.dispose()));
}
