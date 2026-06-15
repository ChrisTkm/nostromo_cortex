import { copyFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  // VS Code loads the extension host entry via CommonJS. ESM + code-splitting
  // (DS-04) produced an ESM bundle with chunks that the host cannot load,
  // breaking activation/F5. Keep the extension as a single CJS file.
  format: "cjs",
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
    outfile: "dist/extension.cjs",
    external: ["vscode"],
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
    entryPoints: ["src/webview/archive/index.tsx"],
    outfile: "media/archive.js"
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/brain/index.tsx"],
    outfile: "media/brain.js"
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/script-flow/index.tsx"],
    outfile: "media/script-flow.js"
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/task-editor/index.tsx"],
    outfile: "media/task-editor.js"
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/ledger/index.tsx"],
    outfile: "media/ledger.js"
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/plans/index.tsx"],
    outfile: "media/plans.js"
  }),
  esbuild.context({
    ...browserBundle,
    entryPoints: ["src/webview/plan-editor/index.tsx"],
    outfile: "media/plan-editor.js"
  })
]);

async function copyStaticAssets() {
  await Promise.all(
    staticAssets.map(async (asset) => {
      await mkdir(path.dirname(asset.target), { recursive: true });
      await copyFile(asset.source, asset.target);
    })
  );

  const missing = staticAssets.filter((asset) => !existsSync(asset.target));
  if (missing.length > 0) {
    const list = missing.map((asset) => path.relative(process.cwd(), asset.target)).join(", ");
    throw new Error(`esbuild copyStaticAssets: missing after copy: ${list}. Build aborted — .vsix would ship broken Python analyzer.`);
  }
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
