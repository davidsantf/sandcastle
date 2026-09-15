import { cp, rm } from "node:fs/promises";

// T5 / AC5: resolve package paths independently of the invoking shell and cwd.
const source = new URL("../src/templates/", import.meta.url);
const destination = new URL("../dist/templates/", import.meta.url);

await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
