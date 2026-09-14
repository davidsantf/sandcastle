import { afterEach, describe, expect, it, vi } from "vitest";
import { startDevSquadAdoDesignApproval as start } from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(disposals.splice(0).map((dispose) => dispose()));
});

// V-001 / FR-024 / CC-14: exercise the real gate and ledger at every grant boundary.
describe.each([
  { stage: "reservation", tag: "r", length: 5, checkpoints: 0 },
  { stage: "publication confirmation", tag: "p", length: 4, checkpoints: 1 },
  { stage: "approval resolution", tag: "a", length: 5, checkpoints: 2 },
  { stage: "changes resolution", tag: "c", length: 5, checkpoints: 2 },
])(
  "V-001 exact-event mutation grant: $stage",
  ({ tag, length, checkpoints }) => {
    const cases = [
      { name: "all sparse holes", kind: "sparse", index: 0 },
      ...Array.from({ length }, (_, index) => [
        { name: `hole at index ${index}`, kind: "hole", index },
        {
          name: `mismatch at index ${index} with overridden every`,
          kind: "mismatch",
          index,
        },
      ]).flat(),
      {
        name: "matching values with hostile methods",
        kind: "matching",
        index: 0,
      },
    ];
    it.each(cases)("$name", async ({ kind, index }) => {
      const f = await makeDecisionFixture();
      disposals.push(f.dispose);
      const d = decisionAdapters(f);
      if (tag === "c") {
        const page = d.readDecisionPage.getMockImplementation()!;
        d.readDecisionPage.mockImplementation(async (q) => {
          const result = await page(q);
          result.page[10][0][12] = result.page[10][0][12].replace(
            "approve-design",
            "request-changes",
          );
          return result;
        });
      }
      const ownedMethod = vi.fn(() => {
        if (kind === "matching") throw new Error("dependency method invoked");
        return true;
      });
      const checkpoint = vi.fn(f.ledger.checkpoint);
      const authorizeMutation = vi.fn<typeof d.authorizeMutation>(
        async (request) => {
          if (request.event[0] !== tag) return { kind: "granted", request };
          const event = [...request.event];
          if (kind === "sparse")
            return {
              kind: "granted",
              request: { ...request, event: new Array(request.event.length) },
            };
          if (kind === "hole") delete event[index];
          if (kind === "mismatch") event[index] = "wrong-event-binding";
          if (kind === "mismatch" || kind === "matching") {
            Object.defineProperty(event, "every", { value: ownedMethod });
            Object.defineProperty(event, Symbol.iterator, {
              value: ownedMethod,
            });
          }
          return { kind: "granted", request: { ...request, event } };
        },
      );
      const result = await start(f.request, {
        ...d,
        authorizeMutation,
        ledger: { readRecord: f.ledger.readRecord, checkpoint },
      } as any);
      expect(
        authorizeMutation.mock.calls.some(([q]) => q.event[0] === tag),
      ).toBe(true);
      if (kind === "matching") {
        expect(result.durableState).toBe(
          tag === "c" ? "changes-requested" : "approved",
        );
        expect(checkpoint).toHaveBeenCalledTimes(3);
        expect(f.publishOnce).toHaveBeenCalledTimes(1);
      } else {
        // Earlier authorized stages may persist; the malformed grant permits no next effect.
        expect(result.reason).toBe("host-authorization-unavailable");
        expect(checkpoint).toHaveBeenCalledTimes(checkpoints);
        expect(
          checkpoint.mock.calls.some(([q]) =>
            q.operationId.startsWith(`dg15.${tag}.`),
          ),
        ).toBe(false);
        expect(f.publishOnce).toHaveBeenCalledTimes(tag === "r" ? 0 : 1);
        const record = await f.ledger.readRecord(137);
        expect(record).toMatchObject({
          ok: true,
          value: { revision: 2 + checkpoints },
        });
        if (!record.ok) throw new Error("fixture-read");
        expect(record.value.checkpoints).toHaveLength(checkpoints);
        expect(d.readDecisionPage).toHaveBeenCalledTimes(
          checkpoints < 2 ? 0 : 1,
        );
        expect(d.authorizeHumanDecision).toHaveBeenCalledTimes(
          checkpoints < 2 ? 0 : 1,
        );
      }
      expect(ownedMethod).not.toHaveBeenCalled();
    });
  },
);
