import { afterEach, expect, it, vi } from "vitest";
import { startDevSquadAdoDesignApproval as start } from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
import type {
  DevSquadAdoWatchIntakeSignal,
  DevSquadAdoDiscoveryAdmissionSignal,
} from "./DevSquadAdoWorkflowWatcher.js";
const comment: DevSquadAdoWatchIntakeSignal = {
  workItemId: "137",
  sourceRevision: 1,
  changedKinds: ["work-item-comment"],
  phase: "old-phase",
  status: "old-status",
  claim: {
    ownerId: "watcher",
    fencingValue: 1,
    expiresAt: "2026-09-11T11:59:00.000Z",
  },
};
const discovery: DevSquadAdoDiscoveryAdmissionSignal = {
  kind: "discovery-admission",
  workItemId: "137",
  acceptedInitializationRevision: 1,
  phase: "old-phase",
  status: "old-status",
  matching: { policyVersion: "v1", decision: "matched", predicates: [] },
  authorization: "host-authorized",
};
const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((f) => f()));
});
async function fixture() {
  const f = await makeDecisionFixture();
  clean.push(f.dispose);
  return f;
}
it.each([comment, discovery])(
  "W059 both historical intake forms use independent current authority",
  async (provenance) => {
    const f = await fixture();
    const acquire = vi.spyOn(f.ledger, "acquireClaim"),
      renew = vi.spyOn(f.ledger, "renewClaim"),
      release = vi.spyOn(f.ledger, "releaseClaim");
    expect(
      (
        await start(
          { ...f.request, provenance } as any,
          decisionAdapters(f) as any,
        )
      ).durableState,
    ).toBe("approved");
    expect(acquire).not.toHaveBeenCalled();
    expect(renew).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  },
);
it.each([comment, discovery])(
  "W059 rejects a signal bound to another item before effects",
  async (provenance) => {
    const f = await fixture();
    const r = await start(
      { ...f.request, provenance: { ...provenance, workItemId: "138" } } as any,
      f.dependencies,
    );
    expect(r.reason).toBe("invalid-input");
    expect(f.publishOnce).not.toHaveBeenCalled();
  },
);
it.each([comment, discovery])(
  "W059 intake and development approval do not supply capability",
  async (provenance) => {
    const f = await fixture();
    expect(
      await start(
        {
          ...f.request,
          authority: undefined,
          provenance,
          developmentApproved: true,
          cleanup: { status: "indeterminate" },
        } as any,
        f.dependencies,
      ),
    ).toMatchObject({ reason: "authority-required" });
    expect(f.publishOnce).not.toHaveBeenCalled();
  },
);
it.each(["stale-fence", "wrong-token", "expired"])(
  "W059 rejects %s independent authority",
  async (mode) => {
    const f = await fixture();
    const authority = { ...f.request.authority! };
    if (mode === "stale-fence") authority.fencingValue++;
    if (mode === "wrong-token")
      authority.claimToken = Buffer.alloc(32, 26).toString("base64url");
    const r = await start(
      { ...f.request, authority, provenance: comment } as any,
      {
        ...f.dependencies,
        ...(mode === "expired"
          ? { utcNow: () => f.now().getTime() + 60000 }
          : {}),
      },
    );
    expect(r.reason).toBe(
      mode === "expired" ? "authority-expired" : "authority-rejected",
    );
    expect(f.publishOnce).not.toHaveBeenCalled();
  },
);
