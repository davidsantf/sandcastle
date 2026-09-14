import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recoverDevSquadAdoPhase,
  runDevSquadAdoPhase,
} from "./DevSquadAdoPhaseRunner.js";
import {
  makePhaseFixture,
  phaseOccurrence,
} from "./DevSquadAdoPhaseTestSupport.js";

const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((dispose) => dispose()));
});
async function fixture(kind: "prepare" | "implement" = "prepare") {
  const value = await makePhaseFixture(kind);
  clean.push(value.dispose);
  return value;
}

describe("DevSquad ADO phase recovery and concurrency", () => {
  it("never redispatches the same completed occurrence", async () => {
    const f = await fixture();
    const first = await runDevSquadAdoPhase(f.request, f.dependencies);
    const second = await runDevSquadAdoPhase(f.request, f.dependencies);
    expect(second).toEqual(first);
    expect(f.prepare).toHaveBeenCalledTimes(1);
    expect(f.verifyTerminalReceipt).toHaveBeenCalledTimes(1);
  });

  it("retains a lost reservation acknowledgement without dispatch", async () => {
    const f = await fixture();
    const checkpoint = f.ledger.checkpoint;
    const result = await runDevSquadAdoPhase(f.request, {
      ...f.dependencies,
      ledger: {
        readRecord: f.ledger.readRecord,
        checkpoint: async (request) => {
          const response = await checkpoint(request);
          throw new Error(JSON.stringify(response));
        },
      },
    });
    expect(result).toMatchObject({
      state: "pending",
      reason: "reservation-unconfirmed",
      knownRevision: 5,
    });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(
      await recoverDevSquadAdoPhase(f.input, {
        ledger: f.ledger,
        utcNow: f.dependencies.utcNow,
      }),
    ).toMatchObject({
      state: "pending",
      reason: "attempt-consumed",
      reservationRevision: 6,
    });
  });

  it("rejects replayed and forged reservation acknowledgements", async () => {
    for (const mode of ["replay", "forged"] as const) {
      const f = await fixture();
      const checkpoint = f.ledger.checkpoint;
      const result = await runDevSquadAdoPhase(f.request, {
        ...f.dependencies,
        ledger: {
          readRecord: f.ledger.readRecord,
          checkpoint: async (request) => {
            const response = await checkpoint(request);
            if (!response.ok) return response;
            return mode === "replay"
              ? {
                  ...response,
                  value: { ...response.value, replayed: true },
                }
              : {
                  ...response,
                  value: {
                    ...response.value,
                    outcome: {
                      kind: "checkpointed",
                      checkpoint: {
                        ...response.value.outcome.checkpoint,
                        operationId: "forged",
                      },
                    },
                  },
                };
          },
        },
      });
      expect(result.reason).toBe("reservation-unconfirmed");
      expect(f.prepare).not.toHaveBeenCalled();
    }
  });

  it("recovers a terminal checkpoint after its direct response is lost", async () => {
    const f = await fixture();
    const checkpoint = f.ledger.checkpoint;
    let calls = 0;
    const result = await runDevSquadAdoPhase(f.request, {
      ...f.dependencies,
      ledger: {
        readRecord: f.ledger.readRecord,
        checkpoint: async (request) => {
          calls++;
          const response = await checkpoint(request);
          if (calls === 2) throw new Error("lost-terminal-response");
          return response;
        },
      },
    });
    expect(result).toMatchObject({
      state: "pending",
      reason: "completion-unconfirmed",
      reservationRevision: 6,
    });
    expect(
      await recoverDevSquadAdoPhase(f.input, {
        ledger: f.ledger,
        utcNow: f.dependencies.utcNow,
        verifyTerminalReceipt: f.verifyTerminalReceipt,
      }),
    ).toMatchObject({
      state: "completed",
      reason: "recorded",
      terminalRevision: 7,
    });
  });

  it.each(["same", "different"] as const)(
    "allows only one concurrent %s occurrence to dispatch",
    async (mode) => {
      const f = await fixture();
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let arrivals = 0;
      f.authorizePhase.mockImplementation(async (request) => {
        if (request.action === "reserve" && ++arrivals === 2) release();
        if (request.action === "reserve") await barrier;
        return {
          kind: "granted",
          request,
          expiresAt: new Date(f.now().getTime() + 4_000).toISOString(),
        };
      });
      const other =
        mode === "same"
          ? f.request
          : {
              ...f.request,
              occurrence: Buffer.alloc(32, 19).toString("base64url"),
            };
      const results = await Promise.all([
        runDevSquadAdoPhase(f.request, f.dependencies),
        runDevSquadAdoPhase(other, f.dependencies),
      ]);
      expect(
        results.filter((result) => result.state === "completed"),
      ).toHaveLength(1);
      expect(f.prepare).toHaveBeenCalledTimes(1);
      expect(
        results.some((result) =>
          ["reservation-unconfirmed", "state-conflict"].includes(result.reason),
        ),
      ).toBe(true);
    },
  );

  it("blocks intent changes for a retained occurrence", async () => {
    const f = await fixture();
    await runDevSquadAdoPhase(f.request, f.dependencies);
    const changed = {
      ...f.request,
      plugin: { ...f.request.plugin, version: "17" },
    };
    expect(await runDevSquadAdoPhase(changed, f.dependencies)).toMatchObject({
      state: "blocked",
      reason: "intent-conflict",
    });
    expect(f.prepare).toHaveBeenCalledOnce();
  });

  it.each(["mismatch", "stale"] as const)(
    "rejects %s terminal audit evidence",
    async (mode) => {
      const f = await fixture();
      await runDevSquadAdoPhase(f.request, f.dependencies);
      f.verifyTerminalReceipt.mockImplementationOnce(async (request) => ({
        kind: "verified",
        request:
          mode === "mismatch"
            ? {
                ...request,
                intent: Buffer.alloc(32, 21).toString("base64url"),
              }
            : request,
        verifierId: "receipt-verifier",
        immutableEvidenceId: "receipt-evidence",
        expiresAt: new Date(
          f.now().getTime() + (mode === "stale" ? -1 : 4_000),
        ).toISOString(),
      }));
      expect(
        await recoverDevSquadAdoPhase(f.input, {
          ledger: f.ledger,
          utcNow: f.dependencies.utcNow,
          verifyTerminalReceipt: f.verifyTerminalReceipt,
        }),
      ).toMatchObject({ state: "blocked", reason: "receipt-unverified" });
    },
  );

  it("fails closed on malformed retained runner history", async () => {
    const f = await fixture();
    const read = await f.ledger.readRecord("137");
    if (!read.ok) throw new Error("read");
    const malformed = structuredClone(read.value) as any;
    malformed.revision++;
    malformed.checkpoints.push({
      revision: malformed.revision,
      operationId: `dp16.r.${phaseOccurrence}.bad`,
      acceptedAt: malformed.updatedAt,
      previous: { phase: malformed.phase, status: malformed.status },
      resulting: { phase: malformed.phase, status: malformed.status },
    });
    expect(
      await recoverDevSquadAdoPhase(f.input, {
        ledger: {
          readRecord: vi.fn(async () => ({
            ok: true as const,
            value: malformed,
          })),
        },
        utcNow: f.dependencies.utcNow,
      }),
    ).toMatchObject({ state: "blocked", reason: "history-conflict" });
  });
});
