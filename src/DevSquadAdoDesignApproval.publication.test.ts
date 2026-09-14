import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startDevSquadAdoDesignApproval as start,
  recoverDevSquadAdoDesignApproval as recover,
} from "./DevSquadAdoDesignApproval.js";
import { makeDesignGateFixture } from "./DevSquadAdoDesignApprovalTestSupport.js";
import type {
  DevSquadAdoDesignStartRequest,
  DevSquadAdoDesignStartDependencies,
} from "./DevSquadAdoDesignApprovalPublication.js";
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(disposals.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDesignGateFixture();
  disposals.push(f.dispose);
  const claim = await f.ledger.acquireClaim({
    workItemId: 137,
    operationId: "host-authority",
    ownerId: "host",
    claimToken: Buffer.alloc(32, 32).toString("base64url"),
    leaseDurationMs: 60000,
  });
  if (!claim.ok) throw new Error("fixture-authority");
  const a = claim.value.outcome.authority;
  const request: DevSquadAdoDesignStartRequest = {
    ...f.request,
    scope: ["test", "tenant", "project"],
    design: {
      content: "Exact reviewed proposal\n",
      artifacts: [],
      target: ["none"],
    },
    authority: {
      ownerId: a.ownerId,
      claimToken: a.claimToken,
      fencingValue: a.fencingValue,
    },
  };
  const publishOnce = vi.fn(async () => undefined);
  const dependencies: DevSquadAdoDesignStartDependencies = {
    ledger: f.ledger,
    publishOnce,
    utcNow: () => f.now().getTime(),
    authorizeMutation: vi.fn<
      DevSquadAdoDesignStartDependencies["authorizeMutation"]
    >(async (request) => ({ kind: "granted", request })),
    verifyDesign: vi.fn<DevSquadAdoDesignStartDependencies["verifyDesign"]>(
      async ({ envelope }) => ({
        kind: "verified",
        workItemId: envelope.workItemId,
        occurrence: envelope.occurrence,
        design: envelope.design,
        target: envelope.target,
        verifierId: "trusted-design-verifier",
        immutableEvidenceId: "immutable-proof",
      }),
    ),
  };
  return { ...f, request, dependencies, publishOnce };
}
describe("W050 fresh-only publication / CC-02,03,10,11,13", () => {
  it("reserves durably before exactly one publisher call and preserves workflow/cursors", async () => {
    const f = await fixture();
    let observedRevision = 0;
    f.publishOnce.mockImplementation(async () => {
      const read = await f.ledger.readRecord(137);
      if (read.ok) observedRevision = read.value.revision;
    });
    const result = await start(f.request, f.dependencies);
    expect(result.durableState).toBe("attempt-consumed");
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
    expect(observedRevision).toBe(3);
    const output = f.publishOnce.mock.calls[0] as unknown as [
      { rendered: string; occurrence: string; design: string },
    ];
    expect(output[0].rendered).toContain(
      `/devsquad approve-design ${output[0].occurrence} ${output[0].design}\n/devsquad request-changes ${output[0].occurrence} ${output[0].design}`,
    );
    expect(output[0].rendered).toMatch(
      /^DevSquad immutable design review\nWork item: \[\["test","tenant","project"\],"137"\]/,
    );
    expect(output[0].rendered.endsWith("Exact reviewed proposal\n\n")).toBe(
      true,
    );
    const read = await f.ledger.readRecord(137);
    expect(read).toMatchObject({
      ok: true,
      value: {
        phase: "host-review",
        status: "waiting",
        observations: f.record.observations,
        checkpoints: [
          {
            previous: { phase: "host-review", status: "waiting" },
            resulting: { phase: "host-review", status: "waiting" },
          },
        ],
      },
    });
    expect(await start(f.request, f.dependencies)).toMatchObject({
      durableState: "attempt-consumed",
    });
    await recover(f.request, f.dependencies);
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
  });
  it.each([
    "missing-authority",
    "wrong-token",
    "expired",
    "unverified-design",
    "denied-mutation",
    "wrong-grant",
    "wrong-design-proof",
    "oversized-content",
    "duplicate-artifact",
  ])("never publishes for %s", async (mode) => {
    const f = await fixture();
    const request = structuredClone(f.request) as any;
    const dependencies = { ...f.dependencies };
    if (mode === "missing-authority") delete request.authority;
    if (mode === "wrong-token")
      request.authority.claimToken = Buffer.alloc(32, 33).toString("base64url");
    if (mode === "expired")
      dependencies.utcNow = () => f.now().getTime() + 60000;
    if (mode === "unverified-design")
      dependencies.verifyDesign = async () => ({ kind: "unavailable" });
    if (mode === "denied-mutation")
      dependencies.authorizeMutation = async () => ({ kind: "denied" });
    if (mode === "wrong-grant")
      dependencies.authorizeMutation = async (request) => ({
        kind: "granted",
        request: { ...request, workItemId: "138" },
      });
    if (mode === "wrong-design-proof")
      dependencies.verifyDesign = async () => ({
        kind: "verified",
        workItemId: "138",
        occurrence: request.occurrence,
        design: request.occurrence,
        target: request.occurrence,
        verifierId: "verifier",
        immutableEvidenceId: "proof",
      });
    if (mode === "oversized-content")
      request.design.content = "x".repeat(32769);
    if (mode === "duplicate-artifact") {
      const artifact = [
        ["test", "tenant", "project"],
        "spec",
        "v1",
        Buffer.alloc(32).toString("base64url"),
      ];
      request.design.artifacts = [artifact, artifact];
    }
    const result = await start(request, dependencies);
    expect(result.durableState).not.toBe("approved");
    expect(f.publishOnce).not.toHaveBeenCalled();
  });
  it.each([
    "replayed",
    "method",
    "revision",
    "timestamp",
    "operation",
    "history",
    "unpatched",
    "mutated-request",
  ])("rejects %s reservation acknowledgement", async (mode) => {
    const f = await fixture();
    const checkpoint = vi.fn(async (request: any) => {
      if (mode === "mutated-request") request.expected.phase = "different";
      const result = await f.ledger.checkpoint(request);
      if (!result.ok) return result;
      const copy = structuredClone(result) as any;
      if (mode === "replayed") copy.value.replayed = true;
      if (mode === "method") copy.value.outcome.kind = "initialized";
      if (mode === "revision") copy.value.acceptedRevision++;
      if (mode === "timestamp")
        copy.value.acceptedAt = "2026-09-11T12:00:01.000Z";
      if (mode === "operation")
        copy.value.outcome.checkpoint.operationId = "other";
      if (mode === "history") copy.value.record.checkpoints = [];
      if (mode === "unpatched") copy.value.record.branch = "other-branch";
      return copy;
    });
    await start(f.request, {
      ...f.dependencies,
      ledger: { readRecord: f.ledger.readRecord, checkpoint },
    });
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(f.publishOnce).not.toHaveBeenCalled();
  });
  it("keeps the attempt consumed after a throwing publisher without leaking its error", async () => {
    const f = await fixture();
    f.publishOnce.mockImplementation(async () => {
      throw new Error("SECRET-PROPOSAL-TOKEN");
    });
    const first = await start(f.request, f.dependencies);
    await start(f.request, f.dependencies);
    expect(first.durableState).toBe("attempt-consumed");
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(first)).not.toContain("SECRET-PROPOSAL-TOKEN");
  });
  it("retires permission when cancellation occurs during acknowledgement", async () => {
    const f = await fixture();
    const controller = new AbortController();
    const checkpoint = async (request: any) => {
      const result = await f.ledger.checkpoint(request);
      controller.abort();
      return result;
    };
    const result = await start(
      { ...f.request, signal: controller.signal },
      {
        ...f.dependencies,
        ledger: { readRecord: f.ledger.readRecord, checkpoint },
      },
    );
    expect(result.reason).toBe("cancelled");
    expect(f.publishOnce).not.toHaveBeenCalled();
  });
});

it("W050 consumes the invocation-local permission before reentrant start", async () => {
  const f = await fixture();
  let nested: unknown;
  f.publishOnce.mockImplementation(async () => {
    nested = await start(f.request, f.dependencies);
  });
  await start(f.request, f.dependencies);
  expect(nested).toMatchObject({ durableState: "attempt-consumed" });
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
});
it("W050 concurrent original submissions invoke the publisher at most once", async () => {
  const f = await fixture();
  await Promise.all([
    start(f.request, f.dependencies),
    start(f.request, f.dependencies),
  ]);
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
  expect((await recover(f.request, f.dependencies)).durableState).toBe(
    "attempt-consumed",
  );
});
it("W050 never turns late reservation acceptance into publication permission", async () => {
  const f = await fixture();
  let ready!: () => void;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let settle!: (value: any) => void;
  let saved: unknown;
  const checkpoint = async (request: any) => {
    saved = await f.ledger.checkpoint(request);
    ready();
    return new Promise<any>((resolve) => {
      settle = resolve;
    });
  };
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const pending = start(f.request, {
    ...f.dependencies,
    ledger: { readRecord: f.ledger.readRecord, checkpoint },
  });
  await entered;
  await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toMatchObject({
    durableState: "reservation-unconfirmed",
    reason: "dependency-timeout",
  });
  settle(saved);
  await Promise.resolve();
  await Promise.resolve();
  vi.useRealTimers();
  expect(f.publishOnce).not.toHaveBeenCalled();
  expect((await recover(f.request, f.dependencies)).durableState).toBe(
    "attempt-consumed",
  );
});
it("W050 retains independently captured proposal and record against adapter mutation", async () => {
  const f = await fixture();
  const read = await f.ledger.readRecord(137);
  if (!read.ok) throw new Error("fixture-read");
  const raw = structuredClone(read.value) as any;
  const verifyDesign: DevSquadAdoDesignStartDependencies["verifyDesign"] =
    async (request) => {
      (request.material as any).content = "ADAPTER-MUTATED-CONTENT";
      raw.phase = "ADAPTER-MUTATED-PHASE";
      return {
        kind: "verified",
        workItemId: request.envelope.workItemId,
        occurrence: request.envelope.occurrence,
        design: request.envelope.design,
        target: request.envelope.target,
        verifierId: "verifier",
        immutableEvidenceId: "proof",
      };
    };
  await start(f.request, {
    ...f.dependencies,
    verifyDesign,
    ledger: {
      readRecord: async () => ({ ok: true, value: raw }),
      checkpoint: f.ledger.checkpoint,
    },
  });
  expect(f.publishOnce).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.publishOnce.mock.calls)).not.toContain(
    "ADAPTER-MUTATED",
  );
});
it.each([32768, 32769])(
  "W050 enforces reviewed UTF-8 bytes at %i",
  async (bytes) => {
    const f = await fixture();
    const content = "é".repeat(16384) + (bytes === 32769 ? "x" : "");
    await start(
      { ...f.request, design: { ...f.request.design, content } },
      f.dependencies,
    );
    expect(f.publishOnce).toHaveBeenCalledTimes(bytes === 32768 ? 1 : 0);
  },
);
