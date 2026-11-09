import { expect, it } from "vitest";
import { runCoworkFactoryLocalExample } from "./CoworkFactoryExample.js";
import { CoworkMemoryStore } from "./CoworkFactoryTestSupport.js";

it("demonstrates mixed fake hubs -> narrow fixture workers -> measured evidence -> release observation", async () => {
  const store = new CoworkMemoryStore();
  const result = await runCoworkFactoryLocalExample(store);
  expect(result.mode).toBe("fixture-only");
  expect(result.writes.map((write) => write.provider).sort()).toEqual([
    "azure-devops",
    "github",
  ]);
  expect(result.tasks).toHaveLength(2);
  expect(
    result.tasks.every(
      (task) => task.registration === "awaiting-change-request",
    ),
  ).toBe(true);
  expect(
    result.workerOutputs.every(
      (output) =>
        !output.baselinePassed &&
        output.candidatePassed &&
        output.protectedPassed,
    ),
  ).toBe(true);
  expect(result.acceptance.state).toBe("keep");
  expect(result.speed.state).toBe("keep");
  expect(result.quality.state).toBe("keep");
  expect(result.release.state).toBe("verified");
  expect(
    [...store.rows.values()].filter((row) => row.value.kind === "measurement"),
  ).toHaveLength(3);
});
