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

describe("DevSquad ADO phase bounds and retirement", () => {
  it("retires a timed-out execution and ignores its late settlement", async () => {
    const f = await fixture();
    let settle!: (value: {
      branch: string;
      commits: Array<{ sha: string }>;
    }) => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const result = await runDevSquadAdoPhase(
      { ...f.request, timeoutMs: 250 },
      f.dependencies,
    );
    expect(result).toMatchObject({ state: "pending", reason: "deadline" });
    settle({ branch: "users/test-phase", commits: [{ sha: "a".repeat(40) }] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.runValidationCommand).not.toHaveBeenCalled();
    const read = await f.ledger.readRecord("137");
    expect(read.ok && read.value.revision).toBe(6);
  });

  it("retires cancellation without later validation or terminal mutation", async () => {
    const f = await fixture();
    const controller = new AbortController();
    let settle!: (value: {
      branch: string;
      commits: Array<{ sha: string }>;
    }) => void;
    f.execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
          controller.abort();
        }),
    );
    const result = await runDevSquadAdoPhase(
      { ...f.request, signal: controller.signal },
      f.dependencies,
    );
    expect(result).toMatchObject({ state: "pending", reason: "cancelled" });
    settle({ branch: "users/test-phase", commits: [{ sha: "a".repeat(40) }] });
    await Promise.resolve();
    expect(f.runValidationCommand).not.toHaveBeenCalled();
    const read = await f.ledger.readRecord("137");
    expect(read.ok && read.value.revision).toBe(6);
  });

  it("retires when the claim lease expires during authorization", async () => {
    const f = await fixture();
    f.authorizePhase.mockImplementationOnce(async (request) => {
      f.setNow(f.now().getTime() + 60_000);
      return {
        kind: "granted",
        request,
        expiresAt: new Date(f.now().getTime() + 64_000).toISOString(),
      };
    });
    expect(await runDevSquadAdoPhase(f.request, f.dependencies)).toMatchObject({
      state: "blocked",
      reason: "deadline",
    });
    expect(f.execute).not.toHaveBeenCalled();
  });

  it("keeps thrown and malformed execution outcomes unresolved", async () => {
    const f = await fixture();
    f.execute.mockRejectedValueOnce(new Error("private execution failure"));
    const thrown = await runDevSquadAdoPhase(f.request, f.dependencies);
    expect(thrown).toMatchObject({
      state: "pending",
      reason: "dependency-failed",
    });
    expect(JSON.stringify(thrown)).not.toContain("private execution failure");

    const g = await fixture();
    g.execute.mockResolvedValueOnce({
      branch: "users/test-phase",
      commits: [{ sha: "not-a-sha" }],
    });
    expect(await runDevSquadAdoPhase(g.request, g.dependencies)).toMatchObject({
      state: "pending",
      reason: "dependency-failed",
    });
  });

  it("rejects oversized commands and malformed dependency responses", async () => {
    const f = await fixture();
    const commands = Array.from({ length: 33 }, (_, index) => ({
      label: `c-${index}`,
      command: "true",
    }));
    const oversized = {
      ...f.request,
      phase: {
        ...f.request.phase,
        execution:
          f.request.phase.kind === "implement"
            ? { ...f.request.phase.execution, validationCommands: commands }
            : undefined,
      },
    } as typeof f.request;
    expect(await runDevSquadAdoPhase(oversized, f.dependencies)).toMatchObject({
      state: "blocked",
      reason: "input-limit",
    });
    expect(f.authorizePhase).not.toHaveBeenCalled();

    const g = await fixture();
    g.authorizePhase.mockResolvedValueOnce({
      kind: "granted",
      request: {} as never,
      expiresAt: new Date(g.now().getTime() + 4_000).toISOString(),
    });
    expect((await runDevSquadAdoPhase(g.request, g.dependencies)).reason).toBe(
      "policy-denied",
    );
  });
});
