import path from "node:path";
import { pathToFileURL } from "node:url";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import { runMultiProjectDemo } from "./MultiProjectDemo.js";
import {
  runMultiProjectOrchestrationPass,
  type MultiProjectHost,
} from "./MultiProjectOrchestrator.js";

export interface MultiProjectHostConfiguration {
  catalog: unknown;
  journalPath: string;
  host: MultiProjectHost;
}

/** A config module is trusted executable host code, not a worker proposal. */
export async function runMultiProjectEntrypoint(options: {
  config?: string;
  demoDirectory?: string;
  signal?: AbortSignal;
}) {
  if (Boolean(options.config) === Boolean(options.demoDirectory))
    throw new Error("choose exactly one of --config or --demo");
  if (options.demoDirectory) return runMultiProjectDemo(options.demoDirectory);
  const configModule = await import(
    pathToFileURL(path.resolve(options.config!)).href
  );
  const config: MultiProjectHostConfiguration = configModule.default;
  if (
    !config ||
    typeof config.journalPath !== "string" ||
    !["authorize", "execute", "resolveRevision", "validate", "observe"].every(
      (key) =>
        typeof config.host?.[key as keyof MultiProjectHost] === "function",
    )
  )
    throw new Error(
      "config must export {catalog,journalPath,host} with all host capabilities",
    );
  const journal = new MultiProjectJournal(config.journalPath);
  try {
    return await runMultiProjectOrchestrationPass({
      catalog: config.catalog,
      journal,
      host: config.host,
      signal: options.signal,
    });
  } finally {
    journal.close();
  }
}
