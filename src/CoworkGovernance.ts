import { createHash } from "node:crypto";
import type {
  CoworkGovernanceCheck,
  CoworkGovernanceResult,
  CoworkInstructionEntry,
  CoworkInstructionPolicy,
  CoworkInstructionProposal,
} from "./CoworkGovernanceContract.js";
export type {
  CoworkGovernanceCheck,
  CoworkGovernanceResult,
  CoworkInstructionEntry,
  CoworkInstructionPolicy,
  CoworkInstructionProposal,
} from "./CoworkGovernanceContract.js";

const digest = /^[a-f0-9]{64}$/;
const safePath = (file: string): boolean =>
  file.length > 0 &&
  file.length <= 500 &&
  !file.startsWith("/") &&
  !file.includes("\\") &&
  !file.includes(":") &&
  !file.split("/").some((part) => part === "" || part === "." || part === "..");

function checkEntries(
  entries: readonly CoworkInstructionEntry[],
  policy: CoworkInstructionPolicy,
): { failures: string[]; scope: Set<string> } {
  const failures: string[] = [];
  const scope = new Set<string>();
  if (entries.length < 1 || entries.length > policy.maxEntries) {
    failures.push("entry-limit");
  }
  if (new Set(entries.map((entry) => entry.file)).size !== entries.length) {
    failures.push("duplicate-file-entry");
  }
  let bytes = 0;
  for (const entry of entries) {
    const size = Buffer.byteLength(entry.content, "utf8");
    bytes += size;
    if (size < 1 || size > policy.maxBytesPerFile)
      failures.push("instruction-size");
    if (
      !safePath(entry.file) ||
      (entry.scope !== "" && !safePath(entry.scope)) ||
      (entry.file !== `${entry.scope ? `${entry.scope}/` : ""}AGENTS.md` &&
        entry.file !== `${entry.scope ? `${entry.scope}/` : ""}CLAUDE.md`)
    ) {
      failures.push("instruction-file-scope");
      continue;
    }
    const previous = policy.previousVersions[entry.file] ?? 0;
    if (!Number.isInteger(entry.version) || entry.version !== previous + 1) {
      failures.push("version-conflict");
    }
    const evaluated = policy.files.filter(
      (file) => entry.scope === "" || file.startsWith(`${entry.scope}/`),
    );
    if (evaluated.length === 0) failures.push("empty-scope");
    for (const file of evaluated) scope.add(file);
    if (policy.generatedFiles.includes(entry.file)) {
      if (
        entry.operation !== "regenerate" ||
        !entry.generationEvidence ||
        !digest.test(entry.generationEvidence)
      ) {
        failures.push("generated-file-requires-regeneration");
      }
    } else if (entry.operation !== "edit") {
      failures.push("unexpected-regeneration");
    }
  }
  if (bytes > policy.maxTotalBytes) failures.push("total-size");
  return { failures, scope };
}

/** Evaluates a proposal only. Passing never authorizes writing instructions. */
export function evaluateCoworkInstructions(
  proposal: CoworkInstructionProposal,
  policy: CoworkInstructionPolicy,
): CoworkGovernanceResult {
  if (
    ![policy.maxBytesPerFile, policy.maxTotalBytes, policy.maxEntries].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    policy.maxEntries > 1000 ||
    policy.maxBytesPerFile > 65536 ||
    policy.maxTotalBytes > 1048576 ||
    policy.files.length === 0 ||
    policy.files.length > 10000 ||
    policy.files.some((file) => !safePath(file)) ||
    new Set(policy.files).size !== policy.files.length ||
    policy.generatedFiles.some((file) => !safePath(file)) ||
    Object.entries(policy.previousVersions).some(
      ([file, version]) =>
        !safePath(file) || !Number.isInteger(version) || version < 1,
    )
  ) {
    return {
      state: "failed",
      evaluatedScope: 0,
      checks: [
        { name: "policy", state: "failed", evidence: ["invalid-policy"] },
      ],
    };
  }
  const evaluated = checkEntries(proposal.entries, policy);
  const negative = checkEntries(proposal.negativeControl, policy);
  // Empty controls fail to evaluate anything and do not prove sensitivity.
  const negativePassed =
    proposal.negativeControl.length > 0 && negative.failures.length > 0;
  const checks: CoworkGovernanceCheck[] = [
    {
      name: "instruction-proposal",
      state: evaluated.failures.length === 0 ? "passed" : "failed",
      evidence: [...new Set(evaluated.failures)].sort(),
    },
    {
      name: "negative-control",
      state: negativePassed ? "passed" : "failed",
      evidence: negativePassed
        ? [...new Set(negative.failures)].sort()
        : ["control-did-not-fail"],
    },
    {
      name: "proposal-binding",
      state: "passed",
      evidence: [
        createHash("sha256")
          .update(JSON.stringify(proposal.entries))
          .digest("hex"),
      ],
    },
  ];
  return {
    state: checks.every((check) => check.state === "passed")
      ? "passed"
      : "failed",
    evaluatedScope: evaluated.scope.size,
    checks,
  };
}
