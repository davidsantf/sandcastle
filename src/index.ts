export { run } from "./run.js";
export type {
  RunOptions,
  RunResult,
  LoggingOption,
  IterationResult,
  IterationUsage,
  Timeouts,
} from "./run.js";
export { interactive } from "./interactive.js";
export type { InteractiveOptions, InteractiveResult } from "./interactive.js";
export { createSandbox } from "./createSandbox.js";
export type {
  CreateSandboxOptions,
  Sandbox,
  SandboxRunOptions,
  SandboxRunResult,
  ResumeSandboxRunResultOptions,
  SandboxInteractiveOptions,
  SandboxInteractiveResult,
  SandboxExecOptions,
  CloseResult,
} from "./createSandbox.js";
export { createWorktree } from "./createWorktree.js";
export type {
  CreateWorktreeOptions,
  Worktree,
  WorktreeBranchStrategy,
  WorktreeInteractiveOptions,
  WorktreeRunOptions,
  WorktreeRunResult,
  WorktreeCreateSandboxOptions,
} from "./createWorktree.js";
export type { PromptArgs } from "./PromptArgumentSubstitution.js";
export type { AgentStreamEvent } from "./AgentStreamEmitter.js";
export {
  transferClaudeSession,
  transferCodexSession,
  encodeProjectPath,
  claudeHostSessionPath,
  claudeSandboxSessionPath,
  findClaudeSessionOnHost,
  findCodexSessionOnHost,
} from "./SessionStore.js";
export type { HostSessionLookup } from "./SessionStore.js";
export type { SandboxHooks } from "./SandboxLifecycle.js";
export type { MountConfig } from "./MountConfig.js";
export { Output, StructuredOutputError } from "./Output.js";
export type {
  OutputDefinition,
  OutputObjectDefinition,
  OutputStringDefinition,
} from "./Output.js";
export { CwdError } from "./CwdError.js";
export {
  claudeCode,
  codex,
  copilot,
  cursor,
  opencode,
  pi,
} from "./AgentProvider.js";
export type {
  AgentProvider,
  AgentCommandOptions,
  PrintCommand,
  ClaudeCodeOptions,
  CodexOptions,
  CopilotOptions,
  CursorOptions,
  OpenCodeOptions,
  PiOptions,
} from "./AgentProvider.js";
export {
  createBindMountSandboxProvider,
  createIsolatedSandboxProvider,
} from "./SandboxProvider.js";
export type {
  SandboxProvider,
  AnySandboxProvider,
  BindMountSandboxProvider,
  IsolatedSandboxProvider,
  NoSandboxProvider,
  BindMountSandboxHandle,
  IsolatedSandboxHandle,
  NoSandboxHandle,
  InteractiveExecOptions,
  ExecResult,
  BindMountCreateOptions,
  BindMountSandboxProviderConfig,
  IsolatedCreateOptions,
  IsolatedSandboxProviderConfig,
  BranchStrategy,
  BindMountBranchStrategy,
  IsolatedBranchStrategy,
  NoSandboxBranchStrategy,
  HeadBranchStrategy,
  MergeToHeadBranchStrategy,
  NamedBranchStrategy,
} from "./SandboxProvider.js";
export {
  createAdoWorkItemBranchName,
  FakeAdoControlPlane,
  validateAdoTeamConfig,
} from "./AdoTeam.js";
export type {
  AdoCiCheck,
  AdoCiCheckState,
  AdoCiStatus,
  AdoControlPlane,
  AdoReviewFeedback,
  AdoReviewFeedbackComment,
  AdoPullRequestContext,
  AdoPullRequestRequest,
  AdoTeamAgentAssignment,
  AdoTeamConfig,
  AdoTeamRole,
  AdoTeamValidationError,
  AdoTeamValidationErrorCode,
  AdoTeamValidationResult,
  AdoWorkItemComment,
  AdoWorkItemContext,
  AdoWorkItemId,
  AdoWorkItemUpdate,
} from "./AdoTeam.js";

export {
  prepareAdoWorkItemRun,
  startAdoWorkItemRun,
} from "./AdoOneWorkItemFlow.js";
export type {
  AdoWorkItemRunPreparationResult,
  PrepareAdoWorkItemRunOptions,
} from "./AdoOneWorkItemFlow.js";

export {
  createAdoControlPlane,
  validateAdoControlPlaneFactoryConfig,
} from "./AdoControlPlaneFactory.js";
export type {
  AdoControlPlaneAccess,
  AdoControlPlaneFactoryConfig,
  AdoControlPlaneFactoryValidationError,
  AdoControlPlaneFactoryValidationErrorCode,
  AdoControlPlaneFactoryValidationResult,
  AdoFakeControlPlaneFactoryConfig,
  AdoInjectedControlPlaneClient,
  AdoInjectedControlPlaneFactoryConfig,
  AdoReadOnlyControlPlane,
} from "./AdoControlPlaneFactory.js";

export { publishAdoPullRequest } from "./AdoPullRequestPublisher.js";
export type {
  AdoPullRequestPublisherControlPlaneLike,
  AdoPullRequestWorkItemCommentRequest,
  AdoPullRequestWorkItemUpdateRequest,
  PublishAdoPullRequestOptions,
  PublishAdoPullRequestResult,
} from "./AdoPullRequestPublisher.js";

export { runAdoFeedbackLoop } from "./AdoFeedbackLoop.js";
export type {
  AdoFeedbackLoopAction,
  AdoFeedbackLoopControlPlaneLike,
  AdoFeedbackLoopObservation,
  AdoFeedbackLoopPullRequestContext,
  AdoFeedbackLoopResult,
  AdoFeedbackLoopResultKind,
  RunAdoFeedbackLoopOptions,
} from "./AdoFeedbackLoop.js";

export { runAdoTeam, validateAdoTeamRunnerOptions } from "./AdoTeamRunner.js";
export type {
  AdoTeamFeedbackLoopContext,
  AdoTeamFeedbackLoopOptionsFactory,
  AdoTeamFeedbackLoopRunner,
  AdoTeamLocalExecution,
  AdoTeamLocalExecutionContext,
  AdoTeamLocalExecutionResult,
  AdoTeamPullRequestContext,
  AdoTeamPullRequestOptionsFactory,
  AdoTeamPullRequestPublisher,
  AdoTeamRunnerAssignmentResult,
  AdoTeamRunnerAssignmentStatus,
  AdoTeamRunnerCounts,
  AdoTeamRunnerExecutionBounds,
  AdoTeamRunnerResult,
  AdoTeamRunnerValidationError,
  AdoTeamRunnerValidationErrorCode,
  AdoTeamRunnerValidationResult,
  RunAdoTeamOptions,
} from "./AdoTeamRunner.js";

export {
  buildDevSquadSandcastleImplementationPrompt,
  defaultDevSquadSandcastleExecutionSeam,
  runDevSquadSandcastleExecution,
  validateDevSquadSandcastleExecutionRequest,
} from "./DevSquadSandcastleExecutionAdapter.js";
export type {
  DevSquadBranchContext,
  DevSquadCommitMetadata,
  DevSquadExecutionBounds,
  DevSquadRepoContext,
  DevSquadSandcastleAgentRole,
  DevSquadSandcastleExecutionRequest,
  DevSquadSandcastleExecutionResult,
  DevSquadSandcastleExecutionSeam,
  DevSquadSandcastleExecutionSeamInput,
  DevSquadSandcastleExecutionSeamResult,
  DevSquadSandcastleExecutionStatus,
  DevSquadSandcastleFailureCategory,
  DevSquadSandcastleFailureDetails,
  DevSquadSandcastleLogSessionMetadata,
  DevSquadSandcastleRequestValidationResult,
  DevSquadSandcastleRunConfig,
  DevSquadSandcastleValidationError,
  DevSquadSandcastleValidationErrorCode,
  DevSquadValidationCommand,
  DevSquadValidationCommandRunner,
  DevSquadValidationCommandRunnerInput,
  DevSquadValidationCommandRunnerResult,
  DevSquadValidationCommandStatus,
  DevSquadValidationCommandSummary,
  DevSquadValidationOverallStatus,
  DevSquadValidationSummary,
  DevSquadWorkItemContext,
  RunDevSquadSandcastleExecutionOptions,
} from "./DevSquadSandcastleExecutionAdapter.js";

export { openDevSquadAdoWorkflowLedger } from "./DevSquadAdoWorkflowLedger.js";
export type {
  AcquireDevSquadAdoWorkflowClaimInput,
  CheckpointDevSquadAdoWorkflowInput,
  DevSquadAdoCheckpointEntry,
  DevSquadAdoCheckpointedOutcome,
  DevSquadAdoClaimAcquiredOutcome,
  DevSquadAdoClaimAuthority,
  DevSquadAdoClaimAuthorityInput,
  DevSquadAdoClaimMetadata,
  DevSquadAdoClaimReleasedOutcome,
  DevSquadAdoClaimRenewedOutcome,
  DevSquadAdoInitializedOutcome,
  DevSquadAdoLedgerError,
  DevSquadAdoLedgerResult,
  DevSquadAdoMutationSuccess,
  DevSquadAdoObservationCursors,
  DevSquadAdoPullRequestCursor,
  DevSquadAdoPullRequestReference,
  DevSquadAdoRecoveryError,
  DevSquadAdoReferenceActivation,
  DevSquadAdoReleasedClaimMetadata,
  DevSquadAdoResumableRecordList,
  DevSquadAdoReferenceHistory,
  DevSquadAdoWorkflowLedger,
  DevSquadAdoWorkflowRecord,
  DevSquadAdoWorkflowState,
  DevSquadAdoWorkItemId,
  InitializeDevSquadAdoWorkflowRecordInput,
  OpenDevSquadAdoWorkflowLedgerInput,
  ReleaseDevSquadAdoWorkflowClaimInput,
  RenewDevSquadAdoWorkflowClaimInput,
} from "./DevSquadAdoWorkflowLedger.js";

export {
  deriveDevSquadAdoWatcherOperationId,
  runDevSquadAdoWorkflowWatchPass,
  validateDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";
export type {
  DevSquadAdoWatchBackoffConfig,
  DevSquadAdoWatchBudgets,
  DevSquadAdoWatchCandidateOutcome,
  DevSquadAdoWatchCandidateOutcomeKind,
  DevSquadAdoWatchClaimMetadata,
  DevSquadAdoWatchCleanup,
  DevSquadAdoWatchLedgerErrorKind,
  DevSquadAdoWatchError,
  DevSquadAdoWatchIntakeRules,
  DevSquadAdoWatchIntakeSignal,
  DevSquadAdoWatchLeaseConfig,
  DevSquadAdoWatchObservationKind,
  DevSquadAdoWatchPassCounts,
  DevSquadAdoWatchPassOutcome,
  DevSquadAdoWatchPassResult,
  DevSquadAdoWatchReasonCode,
  DevSquadAdoWatchStopReason,
  DevSquadAdoWatchValidatedPass,
  DevSquadAdoWatchValidationResult,
  DevSquadAdoWatcherClaimStep,
  DevSquadAdoWatcherObservationGeneration,
  DevSquadAdoWatcherObservationSeam,
  DevSquadAdoWatcherOperationIdentity,
  DevSquadAdoWatcherOperationStep,
  DevSquadAdoWatcherPullRequestObservation,
  DevSquadAdoWatcherPullRequestObservationEntry,
  DevSquadAdoWatcherPullRequestObservationInput,
  DevSquadAdoWatcherSeamMethodName,
  DevSquadAdoWatcherWorkItemObservation,
  DevSquadAdoWatcherWorkItemObservationInput,
  RunDevSquadAdoWorkflowWatchPassOptions,
} from "./DevSquadAdoWorkflowWatcher.js";

// W045 / FR-008/061: discovery contracts are additive; supplied overloads and
// signal unions stay unchanged. Internal traversal/admission helpers stay private.
export { DEFAULT_DEVSQUAD_ADO_DISCOVERY_LIMITS } from "./DevSquadAdoWorkflowWatcher.js";
export type {
  DevSquadAdoDiscoveryFilter,
  DevSquadAdoDiscoveryMatchingPolicy,
  DevSquadAdoDiscoveryLimits,
  DevSquadAdoDiscoveryAuthorization,
  DevSquadAdoWatchDiscoveryConfiguration,
  DevSquadAdoDiscoveryBinding,
  DevSquadAdoDiscoveryFact,
  DevSquadAdoDiscoveryFacts,
  DevSquadAdoDiscoveryPageRequest,
  DevSquadAdoDiscoveryPage,
  DevSquadAdoDiscoveryWorkItemObservation,
  DevSquadAdoDiscoveryPullRequestObservation,
  DevSquadAdoWatcherDiscoverySeam,
  RunDevSquadAdoDiscoveryWatchPassOptions,
  DevSquadAdoWorkflowWatchPassRequest,
  DevSquadAdoDiscoveryError,
  DevSquadAdoDiscoveryValidatedPass,
  DevSquadAdoDiscoveryValidationResult,
  DevSquadAdoDiscoveryTraversal,
  DevSquadAdoDiscoveryPassCounts,
  DevSquadAdoDiscoveryPassResult,
  DevSquadAdoDiscoveryPassOutcome,
} from "./DevSquadAdoWorkflowWatcher.js";

export type {
  DevSquadAdoDiscoveryMatchingEvidence,
  DevSquadAdoDiscoveryIntakeSignal,
  DevSquadAdoDiscoveryCandidateOutcome,
} from "./DevSquadAdoWorkflowWatcher.js";

export type {
  DevSquadAdoDiscoveryAdmissionSignal,
  DevSquadAdoDiscoveryAdmissionAcceptance,
  DevSquadAdoDiscoveryAdmissionOutcome,
} from "./DevSquadAdoWorkflowWatcher.js";

// W062 / FR-026: host-composed offline gate; no internal permission/runtime exports.
export {
  startDevSquadAdoDesignApproval,
  reconcileDevSquadAdoDesignApproval,
  recoverDevSquadAdoDesignApproval,
} from "./DevSquadAdoDesignApproval.js";
export type {
  DevSquadAdoDesignRecoveryRequest,
  DevSquadAdoDesignRecoveryDependencies,
  DevSquadAdoDesignApprovalResult,
  DevSquadAdoDesignProvenance,
} from "./DevSquadAdoDesignApproval.js";
export type {
  DevSquadAdoDesignScope,
  DevSquadAdoDesignArtifact,
  DevSquadAdoDesignInput,
  DevSquadAdoDesignStartRequest,
  DevSquadAdoDesignEnvelope,
  DevSquadAdoDesignMutationRequest,
  DevSquadAdoDesignStartDependencies,
  DevSquadAdoDesignReconcileDependencies,
  DevSquadAdoDesignPublicationWitness,
  DevSquadAdoDesignPublicationVerifier,
} from "./DevSquadAdoDesignApprovalPublication.js";
export type {
  DevSquadAdoDesignProposalAnchor,
  DevSquadAdoDesignDecisionEvent,
  DevSquadAdoDesignDecisionPage,
  DevSquadAdoDesignHumanWitness,
  DevSquadAdoDesignDecisionDependencies,
} from "./DevSquadAdoDesignApprovalDecision.js";
export type {
  DevSquadAdoDesignTarget,
  DevSquadAdoDesignTargetRequest,
  DevSquadAdoDesignTargetVerifier,
} from "./DevSquadAdoDesignApprovalTarget.js";

// W070 / ADR-0028: one host-selected phase; no scheduler or live ADO adapter.
export {
  runDevSquadAdoPhase,
  recoverDevSquadAdoPhase,
} from "./DevSquadAdoPhaseRunner.js";
export type {
  DevSquadAdoPhaseFeedbackBinding,
  DevSquadAdoPhaseInput,
  RunDevSquadAdoPhaseRequest,
  DevSquadAdoPhasePolicyRequest,
  DevSquadAdoPhaseDesignRequest,
  DevSquadAdoPhaseReceiptVerificationRequest,
  DevSquadAdoPhaseTerminalReceiptVerifier,
  DevSquadAdoPhasePreparationReceipt,
  DevSquadAdoPhaseDependencies,
  DevSquadAdoPhaseRecoveryDependencies,
  DevSquadAdoPhaseResult,
} from "./DevSquadAdoPhaseTypes.js";

// W077 / ADR-0029: comments are provenance only; slice 16 remains the executor.
export {
  runDevSquadAdoCommentFeedback,
  recoverDevSquadAdoCommentFeedback,
} from "./DevSquadAdoCommentFeedback.js";
export type {
  DevSquadAdoCommentFeedbackEvidence,
  DevSquadAdoCommentFeedbackSource,
  DevSquadAdoCommentFeedbackSelectionPhase,
  DevSquadAdoCommentFeedbackSelection,
  RunDevSquadAdoCommentFeedbackRequest,
  DevSquadAdoCommentFeedbackNormalizationRequest,
  DevSquadAdoCommentFeedbackRouteAuthorizationRequest,
  DevSquadAdoCommentFeedbackBinding,
  DevSquadAdoCommentFeedbackDependencies,
  DevSquadAdoCommentFeedbackRecoveryRequest,
  DevSquadAdoCommentFeedbackRecoveryDependencies,
  DevSquadAdoCommentFeedbackResult,
} from "./DevSquadAdoCommentFeedbackTypes.js";
