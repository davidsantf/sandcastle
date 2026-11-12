import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isBuiltin } from "node:module";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const result = await build({
  absWorkingDir: root,
  entryPoints: ["scripts/worker-startup/main.mjs"],
  outfile: "dist/worker-startup/worker.mjs",
  bundle: true,
  packages: "bundle",
  platform: "node",
  target: "node22",
  format: "esm",
  banner: {
    js: "import { createRequire as startupCreateRequire } from 'node:module'; const require = startupCreateRequire(import.meta.url);",
  },
  metafile: true,
});
const imports = Object.values(result.metafile.outputs).flatMap(
  (output) => output.imports,
);
if (imports.some((item) => !isBuiltin(item.path)))
  throw new Error("Worker startup bundle must use only Node built-ins");
console.log("Built standalone native worker service and control commands.");
