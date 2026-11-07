import path from "node:path";
import { pathToFileURL } from "node:url";
import { MultiProjectJournal } from "./MultiProjectJournal.js";
import { runMultiProjectDemo } from "./MultiProjectDemo.js";
import { runMultiProjectCoworkDemo } from "./MultiProjectCoworkDemo.js";
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
  coworkDemoDirectory?: string;
  signal?: AbortSignal;
}) {
  if (
    [options.config, options.demoDirectory, options.coworkDemoDirectory].filter(
      Boolean,
    ).length !== 1
  )
    throw new Error("choose exactly one of --config, --demo or --cowork-demo");
  if (options.coworkDemoDirectory)
    return runMultiProjectCoworkDemo(options.coworkDemoDirectory);
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
