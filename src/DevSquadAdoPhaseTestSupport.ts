import { vi } from "vitest";
import {
  startDevSquadAdoDesignApproval,
  type DevSquadAdoDesignApprovalResult,
} from "./DevSquadAdoDesignApproval.js";
import {
  decisionAdapters,
  makeDecisionFixture,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
import type { DevSquadAdoDesignTarget } from "./DevSquadAdoDesignApprovalTarget.js";
import type {
  DevSquadAdoPhaseDependencies,
  DevSquadAdoPhaseInput,
  RunDevSquadAdoPhaseRequest,
} from "./DevSquadAdoPhaseTypes.js";

export const phaseOccurrence = Buffer.alloc(32, 16).toString("base64url");
export const immutableSource = Buffer.alloc(32, 17).toString("base64url");

export async function makePhaseFixture(
  kind: "prepare" | "implement" = "implement",
) {
  const base = await makeDecisionFixture();
  const target: DevSquadAdoDesignTarget = [
    "bound",
    ["test", "tenant", "project"],
    "repo",
    "immutable-source",
    immutableSource,
    "users/test-phase",
    "C:\\repo\\worktree",
    "worktree-id",
    "agent-id",
    "session-id",
  ];
  const designRequest = {
    ...base.request,
    design: { ...base.request.design, target },
  };
  const approval = await startDevSquadAdoDesignApproval(
    designRequest,
    decisionAdapters(base) as never,
  );
  if (
    approval.durableState !== "approved" ||
    !approval.binding?.design ||
    !approval.binding.target
  )
    throw new Error("phase-fixture-approval");
  const read = await base.ledger.readRecord(137);
  if (!read.ok) throw new Error("phase-fixture-read");

  let nowMs = base.now().getTime();
  const execution = {
    repo: {
      hostRepoPath: "C:\\repo",
      worktreePath: "C:\\repo\\worktree",
      workingDirectory: "C:\\repo\\worktree",
    },
    branch: {
      sourceBranch: "users/test-phase",
      targetBranch: "main",
    },
    workItem: { id: "137", title: "Implement phase runner" },
    specContent: "exact spec",
    planContent: "exact plan",
    agentRole: "implementer" as const,
    validationCommands: [
      { label: "test", command: "npm test" },
      { label: "typecheck", command: "npm run typecheck" },
    ],
    bounds: { maxIterations: 2, timeoutMs: 30_000 },
  };
  const input: DevSquadAdoPhaseInput = {
    workItemId: "137",
    occurrence: phaseOccurrence,
    plugin: { id: "devsquad", version: "16" },
    expected: {
      revision: read.value.revision,
      phase: read.value.phase,
      status: read.value.status,
    },
    success: { phase: "host-selected-next", status: "ready" },
    failure: { phase: "host-selected-recovery", status: "failed" },
    phase:
      kind === "prepare"
        ? { kind, content: "prepare exact immutable engineering artifacts" }
        : {
            kind,
            execution,
            approval: {
              occurrence: base.request.occurrence,
              design: approval.binding.design,
              target,
            },
          },
  };
  const authority = { ...designRequest.authority };
  const authorizePhase = vi.fn<DevSquadAdoPhaseDependencies["authorizePhase"]>(
    async (request) => ({
      kind: "granted",
      request,
      expiresAt: new Date(nowMs + 4_000).toISOString(),
    }),
  );
  const verifyDesignAuthorization = vi.fn<
    NonNullable<DevSquadAdoPhaseDependencies["verifyDesignAuthorization"]>
  >(async (request) => ({
    kind: "verified",
    request,
    verifierId: "runtime-design-verifier",
    immutableEvidenceId: "runtime-design-evidence",
    expiresAt: new Date(nowMs + 4_000).toISOString(),
  }));
  const verifyCurrentTarget = vi.fn<
    NonNullable<DevSquadAdoPhaseDependencies["verifyCurrentTarget"]>
  >(async (request) => ({
    kind: "verified",
    workItemId: request.workItemId,
    occurrence: request.occurrence,
    design: request.design,
    target: request.target,
    challenge: request.challenge,
    descriptor: target,
    observedAt: new Date(nowMs).toISOString(),
    verifierId: "target-verifier",
    immutableEvidenceId: "target-evidence",
  }));
  const verifyTerminalReceipt = vi.fn<
    NonNullable<DevSquadAdoPhaseDependencies["verifyTerminalReceipt"]>
  >(async (request) => ({
    kind: "verified",
    request,
    verifierId: "receipt-verifier",
    immutableEvidenceId: "receipt-evidence",
    expiresAt: new Date(nowMs + 4_000).toISOString(),
  }));
  const prepare = vi.fn<NonNullable<DevSquadAdoPhaseDependencies["prepare"]>>(
    async () => ({
      kind: "completed",
      artifactDigest: Buffer.alloc(32, 18).toString("base64url"),
    }),
  );
  const execute = vi.fn<
    NonNullable<
      NonNullable<DevSquadAdoPhaseDependencies["execution"]>["execute"]
    >
  >(async () => ({
    branch: "users/test-phase",
    commits: [{ sha: "a".repeat(40) }],
  }));
  const runValidationCommand = vi.fn<
    NonNullable<
      NonNullable<
        DevSquadAdoPhaseDependencies["execution"]
      >["runValidationCommand"]
    >
  >(async () => ({
    status: "passed",
    exitCode: 0,
  }));
  const dependencies: DevSquadAdoPhaseDependencies = {
    ledger: base.ledger,
    authorizePhase,
    verifyDesignAuthorization,
    verifyCurrentTarget,
    verifyTerminalReceipt,
    prepare,
    execution: { execute, runValidationCommand },
    utcNow: () => nowMs,
  };
  return {
    ...base,
    approval: approval as DevSquadAdoDesignApprovalResult & {
      binding: NonNullable<DevSquadAdoDesignApprovalResult["binding"]>;
    },
    target,
    input,
    request: { ...input, authority } as RunDevSquadAdoPhaseRequest,
    dependencies,
    authorizePhase,
    verifyDesignAuthorization,
    verifyCurrentTarget,
    verifyTerminalReceipt,
    prepare,
    execute,
    runValidationCommand,
    setNow(value: number) {
      nowMs = value;
    },
  };
}
