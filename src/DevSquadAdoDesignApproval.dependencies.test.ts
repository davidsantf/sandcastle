import { readFile, readdir } from "node:fs/promises";
import { expect, it } from "vitest";
import * as entry from "./index.js";
import {
  startDevSquadAdoDesignApproval as start,
  reconcileDevSquadAdoDesignApproval as reconcile,
} from "./DevSquadAdoDesignApproval.js";
import {
  makeDecisionFixture,
  decisionAdapters,
} from "./DevSquadAdoDesignApprovalTestSupport.js";
const source = (name: string) =>
  readFile(new URL(name, import.meta.url), "utf8");
// W062: runtime and type specifiers; side effects, reexports, import types, require and dynamic forms.
const specifiers = (text: string) =>
  [
    ...text.matchAll(
      /(?:\bfrom\s*|\bimport\s*|\b(?:import|require)\s*\(\s*)["']([^"']+)["']/g,
    ),
  ].map((m) => m[1]!);
const forbidden = (s: string) =>
  /TestSupport|\.test\./.test(s) ||
  (!s.startsWith("./DevSquadAdoDesignApproval") &&
    s !== "./DevSquadAdoWorkflowLedger.js" &&
    s !== "node:crypto");
it("W062 root exports the three gate operations without private permission or fixtures", () => {
  for (const key of [
    "startDevSquadAdoDesignApproval",
    "reconcileDevSquadAdoDesignApproval",
    "recoverDevSquadAdoDesignApproval",
  ])
    expect(typeof (entry as any)[key]).toBe("function");
  for (const key of [
    "GateLifecycle",
    "freshGateAcknowledgement",
    "makeDecisionFixture",
    "publishTicket",
    "startGatePublication",
  ])
    expect(entry).not.toHaveProperty(key);
});
it("W062 reconcile requires no publisher or initial design verifier", async () => {
  const f = await makeDecisionFixture();
  try {
    await start(f.request, f.dependencies);
    const d = decisionAdapters(f);
    const { publishOnce, verifyDesign, ...reconciliation } = d;
    expect(
      (await reconcile(f.request, reconciliation as any)).durableState,
    ).toBe("approved");
    expect(publishOnce).toHaveBeenCalledTimes(1);
  } finally {
    await f.dispose();
  }
});
it.each([
  `import "node:fs";`,
  `import "./DevSquadAdoDesignApprovalTestSupport.js";`,
  `import type { Effect } from "effect";`,
  `const p=import("node:http");`,
  `const p=require("node:child_process");`,
  `export * from "./DevSquadSandcastleExecutionAdapter.js";`,
])("W062 guardian rejects forbidden import control %s", (text) => {
  expect(specifiers(text).some(forbidden)).toBe(true);
});
it("W062 every new production module stays within the offline runtime/type graph", async () => {
  const files = (await readdir(new URL(".", import.meta.url))).filter(
    (n) =>
      /^DevSquadAdoDesignApproval.*\.ts$/.test(n) &&
      !n.includes(".test.") &&
      !n.includes("TestSupport"),
  );
  expect(files.length).toBeGreaterThanOrEqual(8);
  for (const file of files) {
    const text = await source(file);
    for (const specifier of specifiers(text)) {
      expect(forbidden(specifier), file + ": " + specifier).toBe(false);
      if (specifier === "./DevSquadAdoWorkflowLedger.js")
        expect(text).not.toMatch(
          /import\s+(?!type\b)[^;]*from\s*["']\.\/DevSquadAdoWorkflowLedger\.js/,
        );
    }
    expect(text).not.toMatch(
      /\b(?:fetch|eval|Function|WebSocket|XMLHttpRequest)\s*\(/,
    );
    expect(text).not.toMatch(/\b(?:require|import)\s*\(\s*[^"'\s]/);
  }
});

// Public consumer signatures are checked by tsgo, independent of runtime casts.
const recoverConsumer: (
  request: import("./index.js").DevSquadAdoDesignRecoveryRequest,
  deps: import("./index.js").DevSquadAdoDesignRecoveryDependencies,
) => Promise<import("./index.js").DevSquadAdoDesignApprovalResult> =
  entry.recoverDevSquadAdoDesignApproval;
it("W062 public typed consumer is the exported recovery operation", () =>
  expect(recoverConsumer).toBe(entry.recoverDevSquadAdoDesignApproval));
