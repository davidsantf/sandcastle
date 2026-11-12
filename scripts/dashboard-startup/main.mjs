import {
  readDashboardConfiguration,
  startOrchestrationDashboard,
} from "../../src/OrchestrationDashboard.js";

const filename = process.argv[2];
if (!filename || process.argv.length > 4)
  throw new Error(
    "Usage: dashboard.mjs <absolute-config-file> [port|--check-config]",
  );
const configuration = readDashboardConfiguration(filename);
if (process.argv[3] === "--check-config") {
  console.log(
    JSON.stringify({
      event: "configuration-valid",
      workspaces: configuration.workspaces.length,
    }),
  );
} else {
  const port = Number(process.argv[3] ?? 4318);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid dashboard port");
  const dashboard = await startOrchestrationDashboard({
    ...configuration,
    port,
  });
  console.log(
    JSON.stringify({
      event: "dashboard-ready",
      url: dashboard.url,
      readOnly: true,
    }),
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void dashboard.close().then(() => process.exit(0));
    });
}
