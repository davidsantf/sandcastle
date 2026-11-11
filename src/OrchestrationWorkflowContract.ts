export const orchestrationWorkflowLabels: readonly string[] = [
  "orchestration-ready",
  "orchestration-planning",
  "orchestration-user-approval",
  "orchestration-implementation-ready",
  "orchestration-implementing",
  "orchestration-reviewing",
  "orchestration-finished",
];
export const workflowOwner = (stage: string) =>
  stage === "orchestration-user-approval"
    ? "user"
    : stage === "orchestration-finished"
      ? "none"
      : "agent";
