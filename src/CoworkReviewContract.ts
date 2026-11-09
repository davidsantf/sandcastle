export type CoworkCriticStage =
  | "research"
  | "design"
  | "build"
  | "verification"
  | "review"
  | "change-request-proposal";

export interface CoworkModelIdentity {
  readonly id: string;
  /** Canonical family from the host registry, never a model alias. */
  readonly family: string;
}

export interface CoworkCriticModel extends CoworkModelIdentity {
  readonly stages: readonly CoworkCriticStage[];
  readonly executor: {
    readonly framework: "devsquad" | "spec-kit" | "custom";
    readonly capabilityId: string;
    readonly available: boolean;
  };
}

export interface CoworkCriticSelection {
  readonly stage: CoworkCriticStage;
  readonly author: CoworkModelIdentity;
  readonly models: readonly CoworkCriticModel[];
  readonly requiredDiversity: boolean;
  readonly unavailable: "block" | "human";
  readonly framework: "devsquad" | "spec-kit" | "custom";
}

export type CoworkCriticRoute =
  | { readonly state: "selected"; readonly model: CoworkCriticModel }
  | { readonly state: "blocked" | "needs-human"; readonly reason: string };

export const coworkReviewPasses = [
  "fast",
  "spec-wiring",
  "meaningful-tests",
  "operations-docs",
  "changed-files",
  "compatibility",
] as const;

export type CoworkReviewPass = (typeof coworkReviewPasses)[number];
export type CoworkFindingCategory =
  | "correctness"
  | "security"
  | "data-loss"
  | "missing-meaningful-tests"
  | "advisory";

export interface CoworkReviewFinding {
  readonly category: CoworkFindingCategory;
  readonly signature: string;
  /** Bounded nonsecret evidence reference; not raw source or worker prose. */
  readonly evidence: string;
}

export interface CoworkReviewContext {
  readonly intent: string;
  readonly revision: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly contracts: Readonly<Record<string, string>>;
  readonly changedFiles: readonly string[];
  readonly author: CoworkModelIdentity;
  /** Host classification. Worker receipts cannot supply or change it. */
  readonly risk: "ordinary" | "critical";
}

export interface CoworkReviewRequest {
  readonly context: CoworkReviewContext;
  readonly pass: CoworkReviewPass;
  readonly critic: CoworkModelIdentity;
  readonly executor: CoworkCriticModel["executor"];
  readonly attempt: number;
  readonly prompt: string;
}

export interface CoworkReviewReceipt {
  readonly intent: string;
  readonly revision: string;
  readonly pass: CoworkReviewPass;
  readonly modelId: string;
  readonly evaluatedFiles: readonly string[];
  readonly findings: readonly CoworkReviewFinding[];
}

export interface CoworkReviewHistoryEntry {
  readonly intent: string;
  readonly revision: string;
  readonly attempt: number;
  readonly blockingSignature: string | null;
}

export interface CoworkReviewAudit {
  readonly context: CoworkReviewContext;
  readonly attempt: number;
  readonly state: CoworkReviewResult["state"];
  readonly reason: string;
  readonly receipts: readonly CoworkReviewReceipt[];
  readonly blockingSignature: string | null;
}

export interface CoworkReviewResult {
  readonly state:
    | "ready"
    | "blocked"
    | "needs-human"
    | "stopped"
    | "stale"
    | "unknown";
  readonly reason: string;
  readonly revision: string;
  readonly attempt: number;
  readonly findings: readonly CoworkReviewFinding[];
  readonly blockingSignature: string | null;
}

export interface CoworkReviewPolicy {
  readonly routing: Omit<CoworkCriticSelection, "stage" | "author">;
  readonly maxAttempts: number;
  readonly repeatedSignatureLimit: number;
}

/** Trusted host capabilities. No worker grant, credential or policy fields. */
export interface CoworkReviewHost {
  readonly authorizeReview: (
    request: CoworkReviewRequest,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly executeReview: (
    request: CoworkReviewRequest,
    signal: AbortSignal,
  ) => Promise<CoworkReviewReceipt>;
  /** Verify actual executed identity via provider provenance, not receipt prose. */
  readonly attestReview: (
    request: CoworkReviewRequest,
    receipt: CoworkReviewReceipt,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly resolveRevision: (
    context: CoworkReviewContext,
    signal: AbortSignal,
  ) => Promise<string>;
  /** Rehydrate independent human approval for exact context and executed reviewers. */
  readonly verifyHumanApproval: (
    context: CoworkReviewContext,
    reviewers: readonly CoworkModelIdentity[],
    signal: AbortSignal,
  ) => Promise<boolean>;
  /** Commit to the core's existing journal before returning known evidence. */
  readonly audit: (
    record: CoworkReviewAudit,
    signal: AbortSignal,
  ) => Promise<void>;
}

export interface CoworkStageCriticRequest {
  readonly stage: CoworkCriticStage;
  readonly intent: string;
  readonly revision: string;
  readonly artifact: string;
  readonly author: CoworkModelIdentity;
  readonly contracts: Readonly<Record<string, string>>;
}

export interface CoworkStageCriticReceipt {
  readonly stage: CoworkCriticStage;
  readonly intent: string;
  readonly revision: string;
  readonly artifact: string;
  readonly critic: CoworkModelIdentity;
  readonly state: "passed" | "blocked" | "unknown";
  readonly findings: readonly string[];
}

export type CoworkStageCritic = (
  request: CoworkStageCriticRequest,
  signal: AbortSignal,
) => Promise<CoworkStageCriticReceipt>;

export interface CoworkStageCriticInvocation {
  readonly request: CoworkStageCriticRequest;
  readonly critic: CoworkModelIdentity;
  readonly executor: CoworkCriticModel["executor"];
}

export interface CoworkStageCriticResult {
  readonly state: "passed" | "blocked" | "needs-human" | "stale" | "unknown";
  readonly reason: string;
  readonly receipt?: CoworkStageCriticReceipt;
}

export interface CoworkStageCriticHost {
  readonly authorize: (
    invocation: CoworkStageCriticInvocation,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly execute: (
    invocation: CoworkStageCriticInvocation,
    signal: AbortSignal,
  ) => Promise<CoworkStageCriticReceipt>;
  readonly attest: (
    invocation: CoworkStageCriticInvocation,
    receipt: CoworkStageCriticReceipt,
    signal: AbortSignal,
  ) => Promise<boolean>;
  readonly resolveRevision: (
    request: CoworkStageCriticRequest,
    signal: AbortSignal,
  ) => Promise<string>;
  readonly audit: (
    request: CoworkStageCriticRequest,
    result: CoworkStageCriticResult,
    signal: AbortSignal,
  ) => Promise<void>;
}
