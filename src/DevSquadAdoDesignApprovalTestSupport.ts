import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTestDevSquadAdoWorkflowLedgerWithClock } from "./DevSquadAdoWorkflowLedgerTestSupport.js";

// W048: portable isolated fixture, not production Windows durability evidence.
export const gateOccurrence = Buffer.alloc(32, 15).toString("base64url");
export async function makeDesignGateFixture() {
  const root = await mkdtemp(join(tmpdir(), "design-gate-"));
  const now = () => new Date("2026-09-11T12:00:00.000Z");
  const opened = await openTestDevSquadAdoWorkflowLedgerWithClock(
    { repositoryRoot: root },
    now,
  );
  if (!opened.ok) throw new Error("fixture-open-failed");
  const ledger = opened.value;
  const seeded = await ledger.initializeRecord({
    workItemId: 137,
    operationId: "seed",
    phase: "host-review",
    status: "waiting",
  });
  if (!seeded.ok) throw new Error("fixture-seed-failed");
  return {
    root,
    ledger,
    record: seeded.value.record,
    now,
    request: { workItemId: 137, occurrence: gateOccurrence },
    dispose: () => rm(root, { recursive: true, force: true }),
  };
}

import { vi } from "vitest";
import type {
  DevSquadAdoDesignEnvelope,
  DevSquadAdoDesignPublicationWitness,
  DevSquadAdoDesignStartRequest,
  DevSquadAdoDesignStartDependencies,
} from "./DevSquadAdoDesignApprovalPublication.js";
export async function makeDecisionFixture() {
  const f = await makeDesignGateFixture();
  const claim = await f.ledger.acquireClaim({
    workItemId: 137,
    operationId: "host-claim",
    ownerId: "host",
    claimToken: Buffer.alloc(32, 7).toString("base64url"),
    leaseDurationMs: 60000,
  });
  if (!claim.ok) throw new Error("fixture-claim");
  const a = claim.value.outcome.authority;
  const request: DevSquadAdoDesignStartRequest = {
    ...f.request,
    scope: ["test", "tenant", "project"],
    design: { content: "reviewed", artifacts: [], target: ["none"] },
    authority: {
      ownerId: a.ownerId,
      claimToken: a.claimToken,
      fencingValue: a.fencingValue,
    },
  };
  let envelope: DevSquadAdoDesignEnvelope | undefined;
  const publishOnce = vi.fn<DevSquadAdoDesignStartDependencies["publishOnce"]>(
    async (value) => {
      envelope = value;
      return "untrusted-hint";
    },
  );
  const dependencies: DevSquadAdoDesignStartDependencies = {
    ledger: f.ledger,
    publishOnce,
    utcNow: () => f.now().getTime(),
    authorizeMutation: async (request) => ({ kind: "granted", request }),
    verifyDesign: async ({ envelope }) => ({
      kind: "verified",
      workItemId: envelope.workItemId,
      occurrence: envelope.occurrence,
      design: envelope.design,
      target: envelope.target,
      verifierId: "design-verifier",
      immutableEvidenceId: "design-proof",
    }),
  };
  const receipt = (): DevSquadAdoDesignPublicationWitness => {
    if (!envelope) throw new Error("missing-publication");
    return [
      "publication-verifier",
      request.scope,
      "137",
      envelope.occurrence,
      envelope.design,
      envelope.target,
      envelope.envelope,
      "proposal-object",
      "immutable-version",
      "stream",
      "proposal-event",
      5,
      "event-version",
      "immutable-receipt",
    ];
  };
  return { ...f, request, dependencies, publishOnce, receipt };
}
// W052: authoritative single-page host evidence, not a live tracker adapter.
export function decisionAdapters(
  f: Awaited<ReturnType<typeof makeDecisionFixture>>,
  bodies?: string[],
) {
  const events = (envelope: DevSquadAdoDesignEnvelope): any[] =>
    (
      bodies ?? [
        `/devsquad approve-design ${envelope.occurrence} ${envelope.design}`,
      ]
    ).map((body, i) => [
      "stream",
      6 + i,
      "event-" + i,
      "ev-" + i,
      "create",
      "comment-" + i,
      "v1",
      null,
      f.request.scope,
      "human",
      "2026-09-11T12:00:00.000Z",
      [
        f.request.scope,
        "137",
        "proposal-object",
        "immutable-version",
        envelope.occurrence,
        envelope.design,
        "answers",
      ],
      body,
      "event-proof-" + i,
    ]);
  return {
    ...f.dependencies,
    verifyPublication: async () => ({
      kind: "verified" as const,
      witness: f.receipt(),
    }),
    readDecisionPage: vi.fn(async (q: any) => {
      const es = events(q.envelope);
      return {
        kind: "verified",
        page: [
          "page-verifier",
          f.request.scope,
          "137",
          "stream",
          q.anchor,
          "snapshot",
          5 + es.length,
          q.cursor,
          6,
          5 + es.length,
          es,
          null,
          true,
          "page-proof",
        ],
      };
    }),
    authorizeHumanDecision: vi.fn(async (q: any) => ({
      kind: "verified",
      witness: [
        "auth-verifier",
        f.request.scope,
        "137",
        q.envelope.occurrence,
        q.envelope.design,
        q.envelope.target,
        q.publication,
        "stream",
        q.event[1],
        q.event[2],
        q.event[5],
        q.event[6],
        q.event[8],
        q.event[9],
        q.action,
        "granted",
        "human-identity",
        "policy",
        "policy-v1",
        "grant-proof",
      ],
    })),
  };
}
