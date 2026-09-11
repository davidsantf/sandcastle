import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import {
  startDevSquadAdoDesignApproval,
  reconcileDevSquadAdoDesignApproval,
  recoverDevSquadAdoDesignApproval,
} from "./index.js";
import type {
  DevSquadAdoDesignStartRequest,
  DevSquadAdoDesignStartDependencies,
  DevSquadAdoDesignApprovalResult,
} from "./index.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
// W063: executable offline equivalent of the documented host call, not a fabricated live verifier.
async function reviewOnce(
  request: DevSquadAdoDesignStartRequest,
  host: DevSquadAdoDesignStartDependencies,
): Promise<DevSquadAdoDesignApprovalResult> {
  return startDevSquadAdoDesignApproval(request, host);
}
it("W063 documentation states exact two-command protocol and permanent publication loss", async () => {
  const readme = await readFile(
    new URL("../README.md", import.meta.url),
    "utf8",
  );
  expect(readme).toContain("## Offline immutable design approval");
  expect(readme).toContain("/devsquad approve-design <G> <D>");
  expect(readme).toContain("/devsquad request-changes <G> <D>");
  expect(readme).toContain("Permanent publication loss");
});
it("W063 typed offline example publishes immutable command bytes and returns durable approval", async () => {
  const f = await makeDecisionFixture();
  try {
    const result = await reviewOnce(
      f.request,
      decisionAdapters(f) as DevSquadAdoDesignStartDependencies,
    );
    expect(result).toMatchObject({
      durableState: "approved",
      verificationStatus: "verified",
      targetHandoff: "not-requested",
    });
    const e = f.publishOnce.mock.calls[0]![0];
    expect(e.rendered).toContain(
      `/devsquad approve-design ${e.occurrence} ${e.design}\n/devsquad request-changes ${e.occurrence} ${e.design}`,
    );
    expect(
      Buffer.byteLength(`/devsquad approve-design ${e.occurrence} ${e.design}`),
    ).toBe(112);
    expect(
      Buffer.byteLength(
        `/devsquad request-changes ${e.occurrence} ${e.design}`,
      ),
    ).toBe(113);
  } finally {
    await f.dispose();
  }
});
it("W063 consumed-attempt runbook uses recovery then original evidence reconciliation without publisher", async () => {
  const f = await makeDecisionFixture();
  try {
    await reviewOnce(f.request, f.dependencies);
    expect(
      (await recoverDevSquadAdoDesignApproval(f.request, { ledger: f.ledger }))
        .durableState,
    ).toBe("attempt-consumed");
    const { publishOnce, verifyDesign, ...host } = decisionAdapters(f);
    expect(
      (await reconcileDevSquadAdoDesignApproval(f.request, host as any))
        .durableState,
    ).toBe("approved");
    expect(publishOnce).toHaveBeenCalledTimes(1);
  } finally {
    await f.dispose();
  }
});
