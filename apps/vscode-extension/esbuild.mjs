import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const minify = !watch;
const require = createRequire(import.meta.url);

const staticAssets = [
  {
    source: require.resolve("web-tree-sitter/web-tree-sitter.wasm"),
    target: path.resolve("media/web-tree-sitter.wasm")
  },
  {
    source: path.join(path.dirname(require.resolve("tree-sitter-python/package.json")), "tree-sitter-python.wasm"),
    target: path.resolve("media/tree-sitter-python.wasm")
  }
];

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
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/script-flow/index.tsx"],
    outfile: "media/script-flow.js"
  })
]);

async function copyStaticAssets() {
  await Promise.all(
    staticAssets.map(async (asset) => {
      await mkdir(path.dirname(asset.target), { recursive: true });
      await copyFile(asset.source, asset.target);
    })
  );
}

if (watch) {
  await copyStaticAssets();
  await Promise.all(contexts.map((context) => context.watch()));
  console.log("Watching Cortex VS Code extension...");
} else {
  await Promise.all(contexts.map((context) => context.rebuild()));
  await copyStaticAssets();
  await Promise.all(contexts.map((context) => context.dispose()));
}
