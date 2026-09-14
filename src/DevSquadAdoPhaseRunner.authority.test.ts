import { afterEach, describe, expect, it, vi } from "vitest";
import { runDevSquadAdoPhase } from "./DevSquadAdoPhaseRunner.js";
import { makePhaseFixture } from "./DevSquadAdoPhaseTestSupport.js";

const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((dispose) => dispose()));
});
async function fixture() {
  const value = await makePhaseFixture();
  clean.push(value.dispose);
  return value;
}

describe("DevSquad ADO phase runner authority", () => {
  it.each(["reserve", "dispatch", "complete"] as const)(
    "denies the exact %s policy action",
    async (action) => {
      const f = await fixture();
      f.authorizePhase.mockImplementation(async (request) =>
        request.action === action
          ? { kind: "denied" }
          : {
              kind: "granted",
              request,
              expiresAt: new Date(f.now().getTime() + 4_000).toISOString(),
            },
      );
      const result = await runDevSquadAdoPhase(f.request, f.dependencies);
      expect(result.reason).toBe("policy-denied");
      expect(f.execute).toHaveBeenCalledTimes(action === "complete" ? 1 : 0);
      expect(result.state).toBe(action === "reserve" ? "blocked" : "pending");
    },
  );

  it("requires exact terminal policy for the failure transition", async () => {
    const f = await fixture();
    f.runValidationCommand.mockResolvedValueOnce({
      status: "failed",
      exitCode: 1,
    });
    f.authorizePhase.mockImplementation(async (request) =>
      request.action === "fail"
        ? { kind: "denied" }
        : {
            kind: "granted",
            request,
            expiresAt: new Date(f.now().getTime() + 4_000).toISOString(),
          },
    );
    expect(await runDevSquadAdoPhase(f.request, f.dependencies)).toMatchObject({
      state: "pending",
      reason: "policy-denied",
      reservationRevision: 6,
    });
  });

  it("blocks absent, mismatched, and stale runtime human evidence", async () => {
    const f = await fixture();
    f.verifyDesignAuthorization.mockResolvedValueOnce({ kind: "unavailable" });
    expect(await runDevSquadAdoPhase(f.request, f.dependencies)).toMatchObject({
      state: "pending",
      reason: "design-unverified",
    });
    expect(f.execute).not.toHaveBeenCalled();

    const g = await fixture();
    g.verifyDesignAuthorization.mockImplementationOnce(async (request) => ({
      kind: "verified",
      request: {
        ...request,
        intent: Buffer.alloc(32, 1).toString("base64url"),
      },
      verifierId: "verifier",
      immutableEvidenceId: "evidence",
      expiresAt: new Date(g.now().getTime() + 4_000).toISOString(),
    }));
    expect((await runDevSquadAdoPhase(g.request, g.dependencies)).reason).toBe(
      "design-unverified",
    );

    const h = await fixture();
    h.verifyDesignAuthorization.mockImplementationOnce(async (request) => ({
      kind: "verified",
      request,
      verifierId: "verifier",
      immutableEvidenceId: "evidence",
      expiresAt: new Date(h.now().getTime() - 1).toISOString(),
    }));
    expect((await runDevSquadAdoPhase(h.request, h.dependencies)).reason).toBe(
      "design-unverified",
    );
  });

  it("blocks missing, mismatched, and stale current-target proof", async () => {
    for (const mode of ["missing", "mismatch", "stale"] as const) {
      const f = await fixture();
      if (mode === "missing")
        f.verifyCurrentTarget.mockResolvedValueOnce({ kind: "unavailable" });
      if (mode === "mismatch")
        f.verifyCurrentTarget.mockImplementationOnce(async (request) => ({
          kind: "verified",
          ...request,
          descriptor: [
            "bound",
            f.target[1],
            f.target[2],
            f.target[3],
            f.target[4],
            "other-branch",
            f.target[6],
            f.target[7],
            f.target[8],
            f.target[9],
          ],
          observedAt: new Date(f.now().getTime()).toISOString(),
          verifierId: "target-verifier",
          immutableEvidenceId: "target-evidence",
        }));
      if (mode === "stale")
        f.verifyCurrentTarget.mockImplementationOnce(async (request) => ({
          kind: "verified",
          ...request,
          descriptor: f.target,
          observedAt: new Date(f.now().getTime() - 5_001).toISOString(),
          verifierId: "target-verifier",
          immutableEvidenceId: "target-evidence",
        }));
      expect(
        (await runDevSquadAdoPhase(f.request, f.dependencies)).reason,
      ).toBe("target-unverified");
      expect(f.execute).not.toHaveBeenCalled();
    }
  });

  it("rejects stale fence and exact-state conflicts before reservation", async () => {
    const f = await fixture();
    expect(
      (
        await runDevSquadAdoPhase(
          {
            ...f.request,
            authority: { ...f.request.authority, fencingValue: 99 },
          },
          f.dependencies,
        )
      ).reason,
    ).toBe("authority-rejected");
    expect(
      (
        await runDevSquadAdoPhase(
          {
            ...f.request,
            expected: { ...f.request.expected, status: "other" },
          },
          f.dependencies,
        )
      ).reason,
    ).toBe("state-conflict");
    expect(f.authorizePhase).not.toHaveBeenCalled();
  });

  it("does not dispatch when reservation is accepted after policy expiry", async () => {
    const f = await fixture();
    const checkpoint = f.ledger.checkpoint;
    const result = await runDevSquadAdoPhase(f.request, {
      ...f.dependencies,
      ledger: {
        readRecord: f.ledger.readRecord,
        checkpoint: async (request) => {
          f.setNow(f.now().getTime() + 5_000);
          return checkpoint(request);
        },
      },
    });
    expect(result).toMatchObject({
      state: "pending",
      reason: "policy-denied",
      reservationRevision: 6,
    });
    expect(f.execute).not.toHaveBeenCalled();
    const read = await f.ledger.readRecord("137");
    expect(read.ok && read.value.revision).toBe(6);
  });

  it("rejects work-item, branch, and worktree mismatches against the target", async () => {
    for (const field of ["workItem", "branch", "worktree"] as const) {
      const f = await fixture();
      if (f.request.phase.kind !== "implement") throw new Error("fixture");
      const original = f.request.phase.execution;
      const execution = {
        ...original,
        workItem: {
          ...original.workItem,
          ...(field === "workItem" ? { id: "138" } : {}),
        },
        branch: {
          ...original.branch,
          ...(field === "branch" ? { sourceBranch: "other" } : {}),
        },
        repo: {
          ...original.repo,
          ...(field === "worktree" ? { worktreePath: "C:\\repo\\other" } : {}),
        },
      };
      expect(
        (
          await runDevSquadAdoPhase(
            {
              ...f.request,
              phase: { ...f.request.phase, execution },
            },
            f.dependencies,
          )
        ).reason,
      ).toBe("invalid-input");
      expect(f.authorizePhase).not.toHaveBeenCalled();
    }
  });

  it("captures supplied seams before asynchronous authorization", async () => {
    const f = await fixture();
    const original = f.execute;
    const replacement = vi.fn(async () => ({
      branch: "users/test-phase",
      commits: [{ sha: "b".repeat(40) }],
    }));
    f.authorizePhase.mockImplementation(async (request) => {
      (f.dependencies.execution as { execute: typeof replacement }).execute =
        replacement;
      return {
        kind: "granted",
        request,
        expiresAt: new Date(f.now().getTime() + 4_000).toISOString(),
      };
    });
    expect((await runDevSquadAdoPhase(f.request, f.dependencies)).state).toBe(
      "completed",
    );
    expect(original).toHaveBeenCalledOnce();
    expect(replacement).not.toHaveBeenCalled();
  });

  it("captures Sandcastle provider identity and configuration before awaits", async () => {
    const f = await fixture();
    const agent = {
      name: "captured-agent",
      env: { CHANNEL: "approved" },
      captureSessions: false,
      buildPrintCommand: () => ({ command: "agent" }),
      parseStreamLine: () => [],
    };
    const sandbox = {
      tag: "none" as const,
      name: "captured-sandbox",
      env: { RING: "approved" },
      create: vi.fn(),
    };
    const sandcastle = { agent, sandbox };
    f.authorizePhase.mockImplementation(async (request) => {
      agent.name = "mutated-agent";
      agent.env.CHANNEL = "mutated";
      sandbox.name = "mutated-sandbox";
      sandbox.env.RING = "mutated";
      return {
        kind: "granted",
        request,
        expiresAt: new Date(f.now().getTime() + 4_000).toISOString(),
      };
    });
    expect(
      (
        await runDevSquadAdoPhase(f.request, {
          ...f.dependencies,
          sandcastle,
        })
      ).state,
    ).toBe("completed");
    expect(f.verifyDesignAuthorization.mock.calls[0]![0].execution).toEqual({
      mode: "sandcastle",
      agent: "captured-agent",
      sandbox: "captured-sandbox",
      sandboxKind: "none",
    });
    const captured = f.execute.mock.calls[0]![0].request.sandcastle!;
    expect(captured.agent.name).toBe("captured-agent");
    expect(captured.agent.env).toEqual({ CHANNEL: "approved" });
    expect(captured.sandbox.name).toBe("captured-sandbox");
    expect(captured.sandbox.env).toEqual({ RING: "approved" });
  });

  it("stops later validation dispatch after malformed evidence", async () => {
    const f = await fixture();
    f.runValidationCommand.mockResolvedValueOnce({
      status: "passed",
      exitCode: 1,
    });
    const result = await runDevSquadAdoPhase(f.request, f.dependencies);
    expect(result).toMatchObject({
      state: "pending",
      reason: "dependency-failed",
    });
    expect(f.runValidationCommand).toHaveBeenCalledTimes(1);
  });
});
