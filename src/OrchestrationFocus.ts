import type {
  WorkspaceAction,
  WorkspaceFocus,
} from "./OrchestrationWorkspaceContract.js";

export type OrchestrationAction = WorkspaceAction;

const orchestrationActions: readonly string[] = [
  "discover",
  "investigate",
  "implement",
  "publish-item",
  "publish-pr",
  "downstream",
];

export type OrchestrationFocus = WorkspaceFocus;

export interface OrchestrationFocusTarget {
  projectId: string;
  action: OrchestrationAction;
  team?: string;
  iteration?: string;
  query?: string;
}

export function evaluateOrchestrationFocus(
  focus: OrchestrationFocus,
  target: OrchestrationFocusTarget,
): { allowed: boolean; reason: string } {
  if (
    !["observe", "propose", "execute"].includes(focus.mode) ||
    !orchestrationActions.includes(target.action)
  )
    return { allowed: false, reason: "invalid-mode-or-action" };
  if (!focus.projectIds.includes(target.projectId))
    return { allowed: false, reason: "outside-focus: host handoff required" };
  for (const selector of ["team", "iteration", "query"] as const) {
    if (focus[selector] !== undefined && focus[selector] !== target[selector])
      return {
        allowed: false,
        reason: `outside-${selector}: host handoff required`,
      };
  }
  if (
    (focus.mode === "observe" && target.action !== "discover") ||
    (focus.mode === "propose" &&
      !["discover", "investigate"].includes(target.action))
  )
    return { allowed: false, reason: "mode-does-not-authorize-action" };
  if (
    !focus.permissions.some(
      (grant) =>
        grant.projectId === target.projectId && grant.action === target.action,
    )
  )
    return { allowed: false, reason: "exact-host-action-grant-required" };
  return { allowed: true, reason: "host-authorized" };
}

export function snapshotOrchestrationFocus(
  focus: OrchestrationFocus,
): OrchestrationFocus {
  const copy = structuredClone(focus);
  if (
    !["observe", "propose", "execute"].includes(copy.mode) ||
    !Array.isArray(copy.projectIds) ||
    copy.projectIds.some((id) => typeof id !== "string" || !id) ||
    new Set(copy.projectIds).size !== copy.projectIds.length ||
    !Array.isArray(copy.permissions) ||
    copy.permissions.some(
      (grant) =>
        !grant ||
        typeof grant.projectId !== "string" ||
        !grant.projectId ||
        !orchestrationActions.includes(grant.action),
    ) ||
    (["team", "iteration", "query"] as const).some(
      (key) =>
        copy[key] !== undefined &&
        (typeof copy[key] !== "string" || !copy[key]),
    ) ||
    !Number.isSafeInteger(copy.maxConcurrency) ||
    copy.maxConcurrency < 1 ||
    Object.values(copy.budgets).length !== 3 ||
    [
      copy.budgets.maxItems,
      copy.budgets.maxAttempts,
      copy.budgets.maxRuntimeMs,
    ].some((limit) => !Number.isSafeInteger(limit) || limit < 1) ||
    Object.values(copy.priorities).some(
      (priority) => !Number.isFinite(priority),
    )
  )
    throw new Error("invalid-orchestration-focus");
  return freezeOrchestrationValue(copy);
}

export function freezeOrchestrationValue<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeOrchestrationValue(child);
    Object.freeze(value);
  }
  return value;
}

export function prioritizeOrchestrationProjects(
  focus: OrchestrationFocus,
  projectIds: string[],
): string[] {
  return [...new Set(projectIds)]
    .filter((id) => focus.projectIds.includes(id))
    .sort(
      (a, b) =>
        (focus.priorities[b] ?? 0) - (focus.priorities[a] ?? 0) ||
        a.localeCompare(b),
    );
}
