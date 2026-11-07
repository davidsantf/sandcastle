import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runMultiProjectCoworkDemo } from "./MultiProjectCoworkDemo.js";

const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0))
    fs.rmSync(folder, { recursive: true, force: true });
});
it("runs policy, factory, executed negative controls, comparison and read-only release in one reopened SQLite host", async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "cowork-demo-"));
  folders.push(folder);
  const first = await runMultiProjectCoworkDemo(folder);
  expect(first.mode).toBe("fixture-only");
  expect(first.status, JSON.stringify(first, null, 2)).toBe("completed");
  expect(first.tasks).toHaveLength(3);
  expect(first.counters.items).toBe(1);
  expect(first.counters.pullRequests).toBe(1);
  expect(first.counters.stageCritics).toBeGreaterThan(0);
  expect(first.counters.reviewPasses).toBe(18);
  expect(first.counters.measurements).toBe(12);
  expect(first.counters.comparisons).toBe(6);
  expect(first.counters.releaseReads).toBe(12);
  expect(first.hostEventCount).toBeGreaterThan(0);
  const reopened = await runMultiProjectCoworkDemo(folder);
  expect(reopened.status).toBe("completed");
  expect(reopened.dispatched).toBe(0);
  expect(reopened.counters.items).toBe(0);
  expect(reopened.counters.pullRequests).toBe(0);
  expect(reopened.counters.measurements).toBe(0);
  expect(reopened.counters.stageCritics).toBe(0);
});
