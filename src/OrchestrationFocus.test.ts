import { describe, expect, it } from "vitest";
import {
  evaluateOrchestrationFocus,
  prioritizeOrchestrationProjects,
  snapshotOrchestrationFocus,
  type OrchestrationFocus,
} from "./OrchestrationFocus.js";

export const focusFixture = (): OrchestrationFocus => ({
  mode: "observe",
  projectIds: ["app", "api"],
  priorities: { api: 2, app: 1 },
  maxConcurrency: 2,
  budgets: { maxItems: 3, maxAttempts: 4, maxRuntimeMs: 1_000 },
  permissions: [{ projectId: "app", action: "discover" }],
});

describe("host focus policy", () => {
  it("requires exact grants even for read-only access and keeps modes separate", () => {
    const focus = focusFixture();
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "app",
        action: "discover",
      }).allowed,
    ).toBe(true);
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "api",
        action: "discover",
      }).allowed,
    ).toBe(false);
    focus.permissions.push({ projectId: "app", action: "implement" });
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "app",
        action: "implement",
      }).reason,
    ).toBe("mode-does-not-authorize-action");
    focus.mode = "propose";
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "app",
        action: "implement",
      }).allowed,
    ).toBe(false);
    focus.mode = "execute";
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "app",
        action: "implement",
      }).allowed,
    ).toBe(true);
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "api",
        action: "publish-pr",
      }).allowed,
    ).toBe(false);
  });

  it("requires explicit matching selectors and hands off cross-project effects", () => {
    const focus = {
      ...focusFixture(),
      team: "platform",
      iteration: "sprint-4",
      query: "approved-query",
    };
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "app",
        action: "discover",
      }).reason,
    ).toContain("team");
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "app",
        action: "discover",
        team: "platform",
        iteration: "sprint-4",
        query: "approved-query",
      }).allowed,
    ).toBe(true);
    expect(
      evaluateOrchestrationFocus(focus, {
        projectId: "outside",
        action: "downstream",
      }).reason,
    ).toContain("handoff");
  });

  it("snapshots immutable nested budgets and deterministic priorities", () => {
    const original = focusFixture();
    const snapshot = snapshotOrchestrationFocus(original);
    original.budgets.maxAttempts = 100;
    expect(snapshot.budgets.maxAttempts).toBe(4);
    expect(Object.isFrozen(snapshot.permissions[0])).toBe(true);
    expect(
      prioritizeOrchestrationProjects(snapshot, [
        "app",
        "api",
        "outside",
        "api",
      ]),
    ).toEqual(["api", "app"]);
    expect(() =>
      snapshotOrchestrationFocus({ ...snapshot, maxConcurrency: 0 }),
    ).toThrow("invalid-orchestration-focus");
  });
});
