import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
await build({
  absWorkingDir: root,
  entryPoints: ["scripts/dashboard-startup/main.mjs"],
  outfile: "dist/dashboard-startup/dashboard.mjs",
  bundle: true,
  packages: "bundle",
  platform: "node",
  target: "node22",
  format: "esm",
  treeShaking: true,
  metafile: true,
}).then((result) => {
  const imports = Object.values(result.metafile.outputs).flatMap(
    (output) => output.imports,
  );
  if (imports.some((item) => !item.path.startsWith("node:")))
    throw new Error(
      "Dashboard startup bundle must depend only on Node built-ins",
    );
  console.log(
    "Built standalone read-only dashboard; no node_modules needed at sign-in.",
  );
});
