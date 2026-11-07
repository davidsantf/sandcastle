export interface CoworkInstructionEntry {
  readonly file: string;
  readonly version: number;
  readonly scope: string;
  readonly content: string;
  readonly operation: "edit" | "regenerate";
  readonly generationEvidence?: string;
}

export interface CoworkInstructionPolicy {
  readonly maxBytesPerFile: number;
  readonly maxTotalBytes: number;
  readonly maxEntries: number;
  /** Host inventory, not worker-selected scope. Repository-relative POSIX IDs. */
  readonly files: readonly string[];
  readonly generatedFiles: readonly string[];
  readonly previousVersions: Readonly<Record<string, number>>;
}

export interface CoworkGovernanceCheck {
  readonly name: string;
  readonly state: "passed" | "failed";
  readonly evidence: readonly string[];
}

export interface CoworkGovernanceResult {
  readonly state: "passed" | "failed";
  readonly evaluatedScope: number;
  readonly checks: readonly CoworkGovernanceCheck[];
}

export interface CoworkInstructionProposal {
  readonly entries: readonly CoworkInstructionEntry[];
  /** Must really fail the same checks; a boolean declaration is insufficient. */
  readonly negativeControl: readonly CoworkInstructionEntry[];
}
