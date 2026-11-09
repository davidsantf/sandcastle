import type { LocalOrchestrationConfiguration } from "./LocalOrchestrationService.js";
import { OrchestrationWorkspaceStore } from "./OrchestrationWorkspace.js";

export const localServiceConfiguration =
  (): LocalOrchestrationConfiguration => ({
    id: "local-service-fixture",
    revision: 1,
    pollIntervalMs: 20,
    focus: {
      mode: "observe",
      projectIds: ["app"],
      priorities: {},
      maxConcurrency: 2,
      budgets: { maxItems: 5, maxAttempts: 5, maxRuntimeMs: 500 },
      permissions: [{ projectId: "app", action: "discover" }],
    },
  });

const memoryStores: OrchestrationWorkspaceStore[] = [];
export function memoryServiceStore(): OrchestrationWorkspaceStore {
  const store = new OrchestrationWorkspaceStore(":memory:");
  memoryStores.push(store);
  return store;
}

export function closeMemoryServiceStores(): void {
  for (const store of memoryStores.splice(0)) store.close();
}

export async function waitForServiceCondition(
  condition: () => boolean | Promise<boolean>,
  timeout = 5_000,
): Promise<void> {
  const end = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() >= end) throw new Error("service-fixture-condition-timeout");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
