import { readFile } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import {
  startDevSquadAdoDesignApproval as start,
  recoverDevSquadAdoDesignApproval as recover,
} from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";

// W065 SKEP01 / FR-024 / SEC-006: structural retention guards, NOT GC/heap tests.
// Paired below with attached public behavior while the decision stage is suspended.
const source = () =>
  readFile(
    new URL("./DevSquadAdoDesignApprovalPublication.ts", import.meta.url),
    "utf8",
  );
it("SKEP01 structurally excludes unknown payloads from the long-lived continuation", async () => {
  const text = await source();
  const continuation = text.match(
    /export interface PublicationContinuation \{([\s\S]*?)\n\}/,
  )![1]!;
  expect(continuation).toMatch(/readonly hint\?: string;/);
});
it("SKEP01 structurally normalizes publisher fulfillment before any gate async frame receives it", async () => {
  const text = await source();
  // This intentionally pins the retention boundary, not merely verifier forwarding.
  expect(text).toMatch(
    /const hint = await lifecycle\.call\("publisher", \(signal\) =>\s*publish!\(structuredClone\(envelope\), signal\)\.then\(boundedPublicationHint\),?\s*\);/,
  );
  const normalizer = text.match(
    /function boundedPublicationHint\(value: unknown\): string \| undefined \{([\s\S]*?)\n\}/,
  );
  expect(normalizer).not.toBeNull();
  expect(text).not.toMatch(/async function boundedPublicationHint/);
  expect(normalizer![1]).not.toMatch(/\bawait\b/);
});

const clean: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(clean.splice(0).map((f) => f()));
});
it.each([
  ["oversized-string", undefined],
  ["oversized-object", undefined],
  ["bounded-ascii", "h".repeat(1024)],
  ["bounded-multibyte", "é".repeat(512)],
  ["oversized-multibyte", undefined],
  ["invalid-unicode", undefined],
] as const)(
  "SKEP01 %s preserves consumed publication through delayed decisions without retry",
  async (kind, expectedHint) => {
    const f = await makeDecisionFixture();
    clean.push(f.dispose);
    const d = decisionAdapters(f);
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const delay = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hints: Array<string | undefined> = [];
    const pending = start(f.request, {
      ...d,
      publishOnce: async (q, signal) => {
        await f.publishOnce(q, signal); // Attached supported publisher records the envelope for the real witness.
        if (kind === "oversized-string") return "x".repeat(2 * 1024 * 1024);
        if (kind === "oversized-object")
          return { payload: "x".repeat(2 * 1024 * 1024) };
        if (kind === "oversized-multibyte") return "é".repeat(512) + "x";
        if (kind === "invalid-unicode") return "\ud800";
        return expectedHint;
      },
      verifyPublication: async (q) => {
        hints.push(q.hint);
        return d.verifyPublication();
      },
      readDecisionPage: async (q) => {
        entered();
        await delay;
        return d.readDecisionPage(q);
      },
    } as Parameters<typeof start>[1]);
    try {
      await ready;
      expect(hints).toEqual([expectedHint]);
      expect(f.publishOnce).toHaveBeenCalledTimes(1);
      expect(await recover(f.request, f.dependencies)).toMatchObject({
        durableState: "publication-confirmed",
        knownRevision: 4,
        checkpointRevisions: {
          reservation: 3,
          publication: 4,
          resolution: null,
        },
      });
    } finally {
      release();
    }
    const result = await pending;
    expect(result).toMatchObject({
      durableState: "approved",
      knownRevision: 5,
    });
    const beforeReplay = await f.ledger.readRecord(137);
    expect(
      (await start(f.request, d as Parameters<typeof start>[1])).durableState,
    ).toBe("approved");
    expect((await recover(f.request, f.dependencies)).durableState).toBe(
      "approved",
    );
    expect(await f.ledger.readRecord(137)).toEqual(beforeReplay);
    expect(f.publishOnce).toHaveBeenCalledTimes(1);
  },
);
