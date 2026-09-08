import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const ledgerSources = [
  "DevSquadAdoWorkflowLedger.ts",
  "DevSquadAdoWorkflowLedgerSchema.ts",
  "DevSquadAdoWorkflowLedgerStorage.ts",
  "DevSquadAdoWorkflowLedgerPlatform.ts",
] as const;

describe("DevSquadAdoWorkflowLedger dependency boundary", () => {
  it("[CC-016] has no control-plane, execution, network, CLI, agent, sandbox, shell, or git imports", async () => {
    const forbidden =
      /(?:Ado(?:ControlPlane|FeedbackLoop|Team|PullRequest)|DevSquadSandcastleExecutionAdapter|AgentProvider|Sandbox|WorktreeManager|node:(?:http|https|net|tls|child_process)|@azure|@octokit|mcp|simple-git)/i;
    for (const filename of ledgerSources) {
      const source = await readFile(new URL(filename, import.meta.url), "utf8");
      const specifiers = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (match) => match[1],
      );
      expect(specifiers.join("\n"), filename).not.toMatch(forbidden);
    }
  });

  it("keeps Effect out of the public contract module", async () => {
    const source = await readFile(
      new URL("DevSquadAdoWorkflowLedger.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/from\s+["'](?:effect|@effect\/)/);
  });
});
