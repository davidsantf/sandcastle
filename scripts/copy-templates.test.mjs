import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// T5 / AC5: packaged templates must be fresh and independent of the caller's cwd.
test("copies nested templates and removes stale files from a different cwd", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sandcastle-template-copy-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "scripts"));
  await cp(
    new URL("./copy-templates.mjs", import.meta.url),
    join(root, "scripts/copy-templates.mjs"),
  );
  await mkdir(join(root, "src/templates/nested"), { recursive: true });
  await writeFile(
    join(root, "src/templates/nested/prompt.md"),
    "fresh template",
  );
  await mkdir(join(root, "dist/templates/nested"), { recursive: true });
  await writeFile(
    join(root, "dist/templates/nested/prompt.md"),
    "old template",
  );
  await writeFile(join(root, "dist/templates/stale.md"), "stale template");
  await writeFile(join(root, "dist/main.js"), "compiled entry");

  await execFileAsync(
    process.execPath,
    [join(root, "scripts/copy-templates.mjs")],
    { cwd: tmpdir() },
  );

  assert.deepEqual(await readdir(join(root, "dist/templates")), ["nested"]);
  assert.equal(
    await readFile(join(root, "dist/templates/nested/prompt.md"), "utf8"),
    "fresh template",
  );
  assert.equal(
    await readFile(join(root, "dist/main.js"), "utf8"),
    "compiled entry",
  );

  await rm(join(root, "dist/templates"), { recursive: true });
  await execFileAsync(
    process.execPath,
    [join(root, "scripts/copy-templates.mjs")],
    { cwd: tmpdir() },
  );
  assert.equal(
    await readFile(join(root, "dist/templates/nested/prompt.md"), "utf8"),
    "fresh template",
  );
});
