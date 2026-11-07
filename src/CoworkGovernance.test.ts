import { describe, expect, it } from "vitest";
import {
  evaluateCoworkInstructions,
  type CoworkInstructionEntry,
  type CoworkInstructionPolicy,
} from "./CoworkGovernance.js";

const policy: CoworkInstructionPolicy = {
  maxBytesPerFile: 100,
  maxTotalBytes: 200,
  maxEntries: 3,
  files: ["src/a.ts", "src/b.ts", "docs/readme.md"],
  generatedFiles: [],
  previousVersions: { "src/AGENTS.md": 1 },
};
const entry: CoworkInstructionEntry = {
  file: "src/AGENTS.md",
  scope: "src",
  version: 2,
  content: "Check call paths and meaningful tests.",
  operation: "edit",
};
const negativeControl = [{ ...entry, content: "x".repeat(101) }];
const evaluate = (entries: readonly CoworkInstructionEntry[]) =>
  evaluateCoworkInstructions({ entries, negativeControl }, policy);

describe("governed instruction proposals", () => {
  it("counts actual evaluated files and runs a deliberately failing size fixture", () => {
    const result = evaluate([entry]);
    expect(result.state).toBe("passed");
    expect(result.evaluatedScope).toBe(2);
    expect(
      result.checks.find((check) => check.name === "negative-control")
        ?.evidence,
    ).toContain("instruction-size");
    // The same invalid fixture really fails, not merely a stated negative flag.
    expect(evaluate(negativeControl).state).toBe("failed");
  });
  it("fails when negative control is valid or empty", () => {
    for (const control of [[entry], []]) {
      expect(
        evaluateCoworkInstructions(
          { entries: [entry], negativeControl: control },
          policy,
        ).state,
      ).toBe("failed");
    }
  });
  it("supports versioned root instructions and counts union scope without duplication", () => {
    const root = { ...entry, file: "AGENTS.md", scope: "", version: 1 };
    expect(evaluate([root, entry])).toMatchObject({
      state: "passed",
      evaluatedScope: 3,
    });
  });
  it.each([
    { ...entry, version: 1 },
    { ...entry, file: "src/other/AGENTS.md", scope: "src" },
    { ...entry, file: "../AGENTS.md", scope: ".." },
    { ...entry, file: "empty/AGENTS.md", scope: "empty", version: 1 },
    { ...entry, content: "" },
  ])("rejects invalid version, scope or size: %j", (invalid) => {
    expect(evaluate([invalid]).state).toBe("failed");
  });
  it("requires one entry per file and enforces aggregate limits", () => {
    expect(evaluate([entry, entry]).state).toBe("failed");
    expect(
      evaluateCoworkInstructions(
        {
          entries: [entry],
          negativeControl,
        },
        { ...policy, maxTotalBytes: 5 },
      ).state,
    ).toBe("failed");
    expect(
      evaluateCoworkInstructions(
        { entries: [entry], negativeControl },
        {
          ...policy,
          files: [],
        },
      ).state,
    ).toBe("failed");
  });
  it("rejects manual generated-file merges and requires regeneration provenance", () => {
    const generated = { ...policy, generatedFiles: [entry.file] };
    expect(
      evaluateCoworkInstructions(
        { entries: [entry], negativeControl },
        generated,
      ).state,
    ).toBe("failed");
    const regenerate = {
      ...entry,
      operation: "regenerate" as const,
      generationEvidence: "a".repeat(64),
    };
    expect(
      evaluateCoworkInstructions(
        { entries: [regenerate], negativeControl },
        generated,
      ).state,
    ).toBe("passed");
    expect(
      evaluateCoworkInstructions(
        {
          entries: [{ ...regenerate, generationEvidence: "" }],
          negativeControl,
        },
        generated,
      ).state,
    ).toBe("failed");
  });
});
