import { z } from "zod";
import { digest } from "./MultiProjectProtocol.js";
import {
  orchestrationDiscoveryScopeFactsSchema,
  type OrchestrationDiscoveredItem,
} from "./OrchestrationDiscovery.js";
import type { WorkspaceStore } from "./OrchestrationWorkspaceContract.js";

/** Structurally compatible with the canonical, service-fenced WorkspaceStore. */
export type OrchestrationIntakeStore = Pick<
  WorkspaceStore,
  "read" | "compareAndSwap"
>;
const artifact = z.string().trim().min(20).max(64_000);
export const orchestrationProposalArtifactsSchema = z.strictObject({
  investigation: artifact,
  specification: artifact,
  plan: artifact,
  acceptance: z
    .array(
      z.strictObject({
        criterion: z.string().trim().min(10).max(2_000),
        verification: z.string().trim().min(10).max(2_000),
      }),
    )
    .min(1)
    .max(50),
});
export type OrchestrationProposalArtifacts = z.infer<
  typeof orchestrationProposalArtifactsSchema
>;
export class OrchestrationProposalBlockedError extends Error {}
const itemSchema = z.object({
  sourceId: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  projectId: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/),
  id: z.string().min(1).max(200),
  url: z
    .string()
    .url()
    .max(2_000)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    }),
  kind: z.enum(["issue", "pull-request", "work-item"]),
  title: z.string().min(1).max(2_000),
  body: z.string().max(64_000),
  updatedAt: z.iso.datetime({ offset: true }),
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  feedback: z.array(z.unknown()),
  dependencies: z.array(z.unknown()),
  labels: z.array(z.string().max(200)).max(1_000).optional(),
  scope: orchestrationDiscoveryScopeFactsSchema.optional(),
});
const proposalSchema = z.strictObject({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  sourceRevision: z.string(),
  configurationRevision: z.number().int().min(1),
  source: itemSchema,
  status: z.enum([
    "observed",
    "planning",
    "ready",
    "approved",
    "rejected",
    "superseded",
    "dispatching",
    "dispatched",
    "unknown",
    "blocked",
  ]),
  digest: z.string().optional(),
  artifacts: orchestrationProposalArtifactsSchema.optional(),
  approval: z
    .strictObject({
      proposalDigest: z.string(),
      sourceRevision: z.string(),
      configurationRevision: z.number().int().min(1),
      at: z.number(),
    })
    .optional(),
  diagnostic: z.string().optional(),
  dispatchReceipt: z.string().max(8_000).optional(),
});
export type OrchestrationProposal = z.infer<typeof proposalSchema>;
export const parseOrchestrationProposal = (value: unknown) =>
  proposalSchema.parse(value);
const entrySchema = z.strictObject({
  key: z.string(),
  item: itemSchema,
  proposals: z.array(proposalSchema).min(1).max(20),
});
const queueSchema = z.strictObject({
  schemaVersion: z.literal(1),
  entries: z.array(entrySchema).max(200),
});
type Queue = z.infer<typeof queueSchema>;
const keyFor = (
  item: Pick<OrchestrationDiscoveredItem, "sourceId" | "projectId" | "id">,
) => digest(JSON.stringify([item.sourceId, item.projectId, item.id]));
const current = (entry: Queue["entries"][number]) =>
  entry.proposals[entry.proposals.length - 1]!;

export function createOrchestrationProposalQueue(options: {
  store: OrchestrationIntakeStore;
  namespace: string;
  now?: () => number;
}) {
  const key = `intake:queue:${digest(options.namespace)}`;
  const now = options.now ?? Date.now;
  const read = () => {
    const stored = options.store.read(key);
    return {
      version: stored.version,
      queue:
        stored.value === null
          ? { schemaVersion: 1 as const, entries: [] }
          : queueSchema.parse(stored.value),
    };
  };
  function update<T>(kind: string, change: (queue: Queue) => T): T {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { version, queue } = read();
      const result = change(queue);
      queueSchema.parse(queue);
      if (Buffer.byteLength(JSON.stringify(queue), "utf8") > 950_000)
        throw new Error(
          "Proposal queue capacity reached; retain evidence and archive explicitly",
        );
      if (
        options.store.compareAndSwap(key, version, queue, {
          kind,
          at: new Date(now()).toISOString(),
        })
      )
        return result;
    }
    throw new Error("Proposal queue changed concurrently");
  }
  const find = (queue: Queue, proposalId: string) => {
    for (const entry of queue.entries) {
      const proposal = entry.proposals.find((p) => p.id === proposalId);
      if (proposal) return { entry, proposal };
    }
    throw new Error("Proposal not found");
  };
  const snapshot = <T>(value: T): T => structuredClone(value);
  return {
    key,
    list(): {
      item: OrchestrationDiscoveredItem;
      proposal: OrchestrationProposal;
    }[] {
      return read().queue.entries.flatMap((e) =>
        e.proposals.map((p) => ({
          item: snapshot(p.source),
          proposal: snapshot(p),
        })),
      );
    },
    get(proposalId: string) {
      const { proposal } = find(read().queue, proposalId);
      return { item: snapshot(proposal.source), proposal: snapshot(proposal) };
    },
    ingest(item: OrchestrationDiscoveredItem, configurationRevision: number) {
      return update("intake-observed", (queue) => {
        const parsed = itemSchema.parse(item);
        const itemKey = keyFor(parsed);
        let entry = queue.entries.find((e) => e.key === itemKey);
        const id = digest(
          JSON.stringify([itemKey, item.revision, configurationRevision]),
        );
        if (entry?.proposals.some((p) => p.id === id))
          return snapshot(entry.proposals.find((p) => p.id === id)!);
        if (
          entry &&
          current(entry).configurationRevision > configurationRevision
        )
          return snapshot(current(entry));
        if (
          entry &&
          Date.parse(item.updatedAt) < Date.parse(entry.item.updatedAt)
        )
          return snapshot(current(entry));
        if (!entry) {
          entry = { key: itemKey, item: parsed, proposals: [] };
          queue.entries.push(entry);
        } else {
          for (const old of entry.proposals)
            if (
              !["superseded", "rejected", "dispatched"].includes(old.status)
            ) {
              old.status = "superseded";
              old.diagnostic =
                "Source or configuration changed; prior approval is invalid";
            }
          entry.item = parsed;
        }
        const proposal: OrchestrationProposal = {
          id,
          sourceRevision: item.revision,
          configurationRevision,
          source: parsed,
          status: "observed",
        };
        entry.proposals.push(proposal);
        return snapshot(proposal);
      });
    },
    async plan(
      proposalId: string,
      planner: (
        item: OrchestrationDiscoveredItem,
        signal: AbortSignal,
      ) => Promise<OrchestrationProposalArtifacts>,
      signal: AbortSignal,
    ) {
      signal.throwIfAborted();
      const reserved = update("intake-planning", (queue) => {
        const { entry, proposal } = find(queue, proposalId);
        if (current(entry).id !== proposal.id || proposal.status !== "observed")
          return null;
        proposal.status = "planning";
        return snapshot(entry.item);
      });
      if (!reserved) return this.get(proposalId).proposal;
      try {
        const artifacts = orchestrationProposalArtifactsSchema.parse(
          await planner(reserved, signal),
        );
        signal.throwIfAborted();
        return update("intake-proposed", (queue) => {
          const { entry, proposal } = find(queue, proposalId);
          if (
            current(entry).id !== proposalId ||
            proposal.status !== "planning"
          )
            return snapshot(proposal);
          proposal.artifacts = artifacts;
          proposal.digest = digest(
            JSON.stringify({
              id: proposal.id,
              sourceRevision: proposal.sourceRevision,
              configurationRevision: proposal.configurationRevision,
              artifacts,
            }),
          );
          proposal.status = "ready";
          return snapshot(proposal);
        });
      } catch (error) {
        return update(
          error instanceof OrchestrationProposalBlockedError
            ? "intake-planning-blocked"
            : "intake-planning-unknown",
          (queue) => {
            const { proposal } = find(queue, proposalId);
            if (proposal.status === "planning") {
              proposal.status =
                error instanceof OrchestrationProposalBlockedError
                  ? "blocked"
                  : "unknown";
              proposal.diagnostic =
                error instanceof OrchestrationProposalBlockedError
                  ? error.message.slice(0, 8_000)
                  : "Planner outcome uncertain; inspect retained execution evidence before recovery";
            }
            return snapshot(proposal);
          },
        );
      }
    },
    review(request: {
      proposalId: string;
      proposalDigest: string;
      sourceRevision: string;
      configurationRevision: number;
      decision: "approve" | "reject";
    }) {
      z.enum(["approve", "reject"]).parse(request.decision);
      return update("intake-reviewed", (queue) => {
        const { entry, proposal } = find(queue, request.proposalId);
        if (
          current(entry).id !== proposal.id ||
          proposal.status !== "ready" ||
          proposal.digest !== request.proposalDigest ||
          proposal.sourceRevision !== request.sourceRevision ||
          proposal.configurationRevision !== request.configurationRevision
        )
          throw new Error(
            "Stale proposal review; reload the current artifact and configuration",
          );
        proposal.status =
          request.decision === "approve" ? "approved" : "rejected";
        if (request.decision === "approve")
          proposal.approval = {
            proposalDigest: request.proposalDigest,
            sourceRevision: request.sourceRevision,
            configurationRevision: request.configurationRevision,
            at: now(),
          };
        return snapshot(proposal);
      });
    },
    async execute(
      request: { proposalId: string; configurationRevision: number },
      controls: {
        authorize: (
          item: OrchestrationDiscoveredItem,
          proposal: OrchestrationProposal,
        ) => boolean;
        refresh: (
          item: OrchestrationDiscoveredItem,
          signal: AbortSignal,
        ) => Promise<OrchestrationDiscoveredItem>;
        dispatch: (
          item: OrchestrationDiscoveredItem,
          proposal: OrchestrationProposal,
          signal: AbortSignal,
        ) => Promise<{ receipt: string }>;
      },
      signal: AbortSignal,
    ) {
      const candidate = this.get(request.proposalId);
      if (candidate.proposal.status !== "approved") return candidate.proposal;
      signal.throwIfAborted();
      if (
        candidate.proposal.configurationRevision !==
        request.configurationRevision
      )
        throw new Error("Stale approval; re-investigation and review required");
      if (
        !controls.authorize(
          snapshot(candidate.item),
          snapshot(candidate.proposal),
        )
      )
        throw new Error(
          "Implementation denied by current trusted focus policy",
        );
      let refreshed: OrchestrationDiscoveredItem;
      try {
        refreshed = await controls.refresh(snapshot(candidate.item), signal);
        signal.throwIfAborted();
      } catch {
        return update("intake-source-blocked", (queue) => {
          const { proposal } = find(queue, request.proposalId);
          if (proposal.status === "approved") {
            proposal.status = "blocked";
            proposal.diagnostic =
              "Current source eligibility/revision could not be verified; implementation was not started";
          }
          return snapshot(proposal);
        });
      }
      if (
        keyFor(refreshed) !== keyFor(candidate.item) ||
        refreshed.revision !== candidate.proposal.sourceRevision
      ) {
        if (keyFor(refreshed) !== keyFor(candidate.item))
          throw new Error("Source refresh identity mismatch");
        this.ingest(refreshed, request.configurationRevision);
        return this.get(request.proposalId).proposal;
      }
      const reserved = update("intake-dispatching", (queue) => {
        const { entry, proposal } = find(queue, request.proposalId);
        if (proposal.status !== "approved") return null;
        if (
          current(entry).id !== proposal.id ||
          proposal.configurationRevision !== request.configurationRevision ||
          proposal.approval?.proposalDigest !== proposal.digest ||
          proposal.approval?.sourceRevision !== entry.item.revision ||
          proposal.approval?.configurationRevision !==
            request.configurationRevision
        )
          throw new Error(
            "Stale approval; re-investigation and review required",
          );
        if (!controls.authorize(snapshot(entry.item), snapshot(proposal)))
          throw new Error(
            "Implementation denied by current trusted focus policy",
          );
        signal.throwIfAborted();
        proposal.status = "dispatching";
        return { item: snapshot(entry.item), proposal: snapshot(proposal) };
      });
      if (!reserved) return this.get(request.proposalId).proposal;
      try {
        const result = await controls.dispatch(
          reserved.item,
          reserved.proposal,
          signal,
        );
        const receipt = z
          .string()
          .trim()
          .min(1)
          .max(8_000)
          .parse(result.receipt);
        signal.throwIfAborted();
        return update("intake-dispatched", (queue) => {
          const { proposal } = find(queue, request.proposalId);
          if (proposal.status === "dispatching") proposal.status = "dispatched";
          proposal.dispatchReceipt = receipt;
          return snapshot(proposal);
        });
      } catch {
        return update("intake-dispatch-unknown", (queue) => {
          const { proposal } = find(queue, request.proposalId);
          if (proposal.status === "dispatching") proposal.status = "unknown";
          proposal.diagnostic =
            "Dispatch outcome uncertain; automatic retry suppressed";
          return snapshot(proposal);
        });
      }
    },
  };
}
