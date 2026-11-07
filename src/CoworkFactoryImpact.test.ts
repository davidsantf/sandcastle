import { describe, expect, it } from "vitest";
import {
  coworkCompatibilityTask,
  evaluateCoworkImpact,
  persistCoworkImpact,
} from "./CoworkFactoryImpact.js";
import { proposeCoworkItem, publishCoworkItem } from "./CoworkFactory.js";
import type { CoworkItemHost } from "./CoworkFactory.js";
import {
  CoworkMemoryStore,
  NEXT,
  NOW,
  OTHER,
  change,
  itemHost,
  mapping,
} from "./CoworkFactoryTestSupport.js";

const host = {
  async verifyChange() {
    return true;
  },
  async verifyMapping() {
    return true;
  },
};
const options = { now: NOW, maxAgeMs: 60000, maxDepth: 4, host };
describe("verified producer-consumer compatibility propagation", () => {
  it("generates an A -> B compatibility task linked to exact source and contract", async () => {
    const upstream = change();
    upstream.contracts[0]!.name = "api:one:api";
    const result = await evaluateCoworkImpact(
      upstream,
      [{ ...mapping(), contract: "api:one:api" }],
      options,
    );
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate.impact).toMatchObject({
      upstreamTask: "A-7",
      upstreamRevision: change().revision,
      requiredDigest: OTHER,
      downstreamProject: "B",
      lineage: ["A", "B"],
      depth: 1,
      budget: 4,
    });
    const store = new CoworkMemoryStore(),
      transport = itemHost();
    await persistCoworkImpact(result, store, NOW);
    const published = await publishCoworkItem(proposeCoworkItem(candidate), {
      mode: "publish",
      store,
      host: transport,
      now: NOW,
    });
    if (published.state !== "completed")
      throw new Error("fixture publication failed");
    const task = coworkCompatibilityTask(candidate, published);
    expect(task.registration).toBe("awaiting-change-request");
    expect(task.contracts["api:one:api"]).toBe(OTHER);
    expect(task.sourceItem.target).toEqual(mapping().target);
    expect(task.origin.upstreamChange).toBe(change().change);
    expect(transport.writes).toBe(1);
  });
  it("does nothing for unchanged or already-matching contracts", async () => {
    const unchanged = change();
    unchanged.contracts[0]!.after = unchanged.contracts[0]!.before;
    expect(
      (await evaluateCoworkImpact(unchanged, [mapping()], options)).candidates,
    ).toHaveLength(0);
    expect(
      (
        await evaluateCoworkImpact(
          change(),
          [{ ...mapping(), consumedDigest: OTHER }],
          options,
        )
      ).unaffected,
    ).toEqual(["B"]);
  });
  it("fans out independently to mixed hubs without multiplying the budget", async () => {
    const ado = {
      ...mapping("C"),
      target: {
        provider: "azure-devops" as const,
        organization: "example",
        project: "C",
        workItemType: "Task",
      },
    };
    const result = await evaluateCoworkImpact(
      change(),
      [ado, mapping()],
      options,
    );
    expect(result.candidates.map((c) => c.project)).toEqual(["B", "C"]);
    expect(result.candidates.map((c) => c.target.provider)).toEqual([
      "github",
      "azure-devops",
    ]);
    expect(
      result.candidates.reduce((sum, c) => sum + c.impact!.budget + 1, 0),
    ).toBe(change().budget);
  });
  it("deduplicates replay and restart with no duplicate task write", async () => {
    const result = await evaluateCoworkImpact(change(), [mapping()], options);
    const store = new CoworkMemoryStore(),
      transport = itemHost();
    await persistCoworkImpact(result, store, NOW);
    await persistCoworkImpact(result, store, NOW);
    const p = proposeCoworkItem(result.candidates[0]!);
    const publicationOptions = {
      mode: "publish" as const,
      store,
      host: transport,
      now: NOW,
    };
    await publishCoworkItem(p, publicationOptions);
    await publishCoworkItem(p, publicationOptions);
    expect(transport.writes).toBe(1);
  });
  it("never redispatches an uncertain downstream issue on impact replay", async () => {
    const result = await evaluateCoworkImpact(change(), [mapping()], options);
    const store = new CoworkMemoryStore();
    let writes = 0;
    const transport: CoworkItemHost = {
      ...itemHost(),
      async create() {
        writes++;
        return { state: "unknown" };
      },
    };
    await persistCoworkImpact(result, store, NOW);
    const publication = {
      mode: "publish" as const,
      store,
      host: transport,
      now: NOW,
    };
    expect(
      (
        await publishCoworkItem(
          proposeCoworkItem(result.candidates[0]!),
          publication,
        )
      ).state,
    ).toBe("unknown");
    await persistCoworkImpact(result, store, NOW);
    expect(
      (
        await publishCoworkItem(
          proposeCoworkItem(result.candidates[0]!),
          publication,
        )
      ).state,
    ).toBe("unknown");
    expect(writes).toBe(1);
  });
  it("requires explicit follow-up for a new source revision and preserves old frozen intent", async () => {
    const store = new CoworkMemoryStore();
    const original = await evaluateCoworkImpact(change(), [mapping()], options);
    await persistCoworkImpact(original, store, NOW);
    const changed = { ...change(), revision: NEXT };
    const newResult = await evaluateCoworkImpact(changed, [mapping()], options);
    await expect(persistCoworkImpact(newResult, store, NOW)).rejects.toThrow(
      "explicit",
    );
    const followup = await evaluateCoworkImpact(
      changed,
      [
        {
          ...mapping(),
          supersedes: original.candidates[0]!.key,
        },
      ],
      options,
    );
    await persistCoworkImpact(followup, store, NOW);
    expect(followup.candidates[0]!.key).not.toBe(original.candidates[0]!.key);
    expect(followup.candidates[0]!.impact!.supersedes).toBe(
      original.candidates[0]!.key,
    );
    expect(original.candidates[0]!.impact!.upstreamRevision).toBe(
      change().revision,
    );
  });
  it("blocks cycles, depth, budget, ambiguous mappings and unverifiable impact", async () => {
    expect(
      (await evaluateCoworkImpact(change(), [mapping("A")], options)).blocked[0]
        ?.reason,
    ).toBe("propagation-cycle");
    expect(
      (
        await evaluateCoworkImpact(
          { ...change(), lineage: ["X", "A"], depth: 1 },
          [mapping()],
          { ...options, maxDepth: 1 },
        )
      ).blocked[0]?.reason,
    ).toBe("propagation-depth");
    const bounded = await evaluateCoworkImpact(
      { ...change(), budget: 1 },
      [mapping(), mapping("C")],
      options,
    );
    expect(bounded.candidates).toHaveLength(1);
    expect(bounded.blocked[0]?.reason).toBe("propagation-budget");
    expect(
      (await evaluateCoworkImpact(change(), [mapping(), mapping()], options))
        .candidates,
    ).toHaveLength(0);
    expect(
      (
        await evaluateCoworkImpact(change(), [mapping()], {
          ...options,
          host: {
            ...host,
            async verifyChange() {
              return false;
            },
          },
        })
      ).blocked[0]?.reason,
    ).toBe("unverified-impact");
  });
  it("blocks unknown consumed version and missing contract instead of mass filing", async () => {
    expect(
      (
        await evaluateCoworkImpact(
          change(),
          [{ ...mapping(), consumedDigest: "f".repeat(64) }],
          options,
        )
      ).blocked[0]?.reason,
    ).toBe("unknown-consumed-version");
    expect(
      (
        await evaluateCoworkImpact(
          change(),
          [{ ...mapping(), contract: "absent" }],
          options,
        )
      ).blocked[0]?.reason,
    ).toBe("missing-contract-evidence");
  });
});
