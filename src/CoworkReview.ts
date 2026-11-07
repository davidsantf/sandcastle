import { createHash } from "node:crypto";
import {
  coworkReviewPasses,
  type CoworkCriticRoute,
  type CoworkCriticSelection,
  type CoworkReviewContext,
  type CoworkReviewHistoryEntry,
  type CoworkReviewHost,
  type CoworkReviewPolicy,
  type CoworkReviewReceipt,
  type CoworkReviewRequest,
  type CoworkReviewResult,
  type CoworkStageCriticHost,
  type CoworkStageCriticRequest,
  type CoworkStageCriticResult,
} from "./CoworkReviewContract.js";

const hash = /^[a-f0-9]{64}$/;
const revision = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,199}$/;
const contractIdentifier = /^[a-zA-Z0-9][a-zA-Z0-9._/:-]{0,199}$/;
const categories = new Set([
  "correctness",
  "security",
  "data-loss",
  "missing-meaningful-tests",
  "advisory",
]);
const stages = new Set([
  "research",
  "design",
  "build",
  "verification",
  "review",
  "change-request-proposal",
]);
const guidance = {
  fast: "Find immediate correctness, security, data-loss and meaningful-test gaps.",
  "spec-wiring":
    "Compare acceptance criteria to real caller/callee paths, registration and public wiring. Identify unreachable implementations.",
  "meaningful-tests":
    "Check that tests fail on the replaced/broken behavior and distinguish the requested fix. Require intentional failing controls, not only mocks agreeing with implementation.",
  "operations-docs":
    "Review restart, recovery, cancellation, failure handling, operational behavior and documentation accuracy.",
  "changed-files":
    "Read every changed file completely, including generated artifacts, fixtures and documentation. Return exact complete file coverage.",
  compatibility:
    "Compare the replaced behavior and contracts with consumers. Identify unintended compatibility changes and missing migration/version documentation.",
} as const;

function snapshot<T>(value: T): T {
  const copy: T = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item && typeof item === "object") {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  freeze(copy);
  return copy;
}

export function selectCoworkCritic(
  input: CoworkCriticSelection,
): CoworkCriticRoute {
  if (
    !identifier.test(input.author.id) ||
    !identifier.test(input.author.family) ||
    !stages.has(input.stage) ||
    !["devsquad", "spec-kit", "custom"].includes(input.framework) ||
    input.models.length > 100 ||
    new Set(input.models.map((model) => model.id)).size !==
      input.models.length ||
    input.models.some(
      (model) =>
        !identifier.test(model.id) ||
        !identifier.test(model.family) ||
        !model.executor ||
        !identifier.test(model.executor.capabilityId),
    )
  ) {
    return { state: "blocked", reason: "invalid-identity-registry" };
  }
  const authorEntry = input.models.find(
    (model) => model.id === input.author.id,
  );
  if (authorEntry && authorEntry.family !== input.author.family) {
    return { state: "blocked", reason: "author-family-conflict" };
  }
  const model = input.models.find(
    (candidate) =>
      candidate.stages.includes(input.stage) &&
      candidate.executor.framework === input.framework &&
      candidate.executor.available === true &&
      (!input.requiredDiversity || candidate.family !== input.author.family),
  );
  return model
    ? { state: "selected", model: snapshot(model) }
    : {
        state: input.unavailable === "human" ? "needs-human" : "blocked",
        reason: "critic-diversity-unavailable",
      };
}

function validFiles(files: readonly string[]): boolean {
  return (
    files.length > 0 &&
    files.length <= 10000 &&
    new Set(files).size === files.length &&
    files.every(
      (file) =>
        identifier.test(file) &&
        !file.split("/").some((part) => part === ".." || part === "."),
    )
  );
}

function validContext(context: CoworkReviewContext): boolean {
  const digests = [context.artifacts, context.contracts];
  return (
    hash.test(context.intent) &&
    revision.test(context.revision) &&
    identifier.test(context.projectId) &&
    identifier.test(context.taskId) &&
    identifier.test(context.author.id) &&
    identifier.test(context.author.family) &&
    ["ordinary", "critical"].includes(context.risk) &&
    validFiles(context.changedFiles) &&
    Object.keys(context.artifacts).length > 0 &&
    digests.every(
      (values) =>
        Object.keys(values).length <= 1000 &&
        Object.entries(values).every(
          ([name, digest]) =>
            contractIdentifier.test(name) && hash.test(digest),
        ),
    )
  );
}

function validReceipt(
  value: CoworkReviewReceipt,
  request: CoworkReviewRequest,
): boolean {
  if (
    !value ||
    Object.keys(value).sort().join(",") !==
      "evaluatedFiles,findings,intent,modelId,pass,revision" ||
    value.intent !== request.context.intent ||
    value.revision !== request.context.revision ||
    value.pass !== request.pass ||
    value.modelId !== request.critic.id ||
    !Array.isArray(value.evaluatedFiles) ||
    !validFiles(value.evaluatedFiles) ||
    value.evaluatedFiles.some(
      (file) => !request.context.changedFiles.includes(file),
    ) ||
    !Array.isArray(value.findings) ||
    value.findings.length > 1000
  ) {
    return false;
  }
  if (
    request.pass === "changed-files" &&
    value.evaluatedFiles.length !== request.context.changedFiles.length
  ) {
    return false;
  }
  return value.findings.every(
    (finding) =>
      finding &&
      Object.keys(finding).sort().join(",") === "category,evidence,signature" &&
      categories.has(finding.category) &&
      identifier.test(finding.signature) &&
      identifier.test(finding.evidence),
  );
}

/** Engineering evidence only; downstream effects still need fresh host policy. */
export async function runCoworkReview(
  input: CoworkReviewContext,
  policyInput: CoworkReviewPolicy,
  host: CoworkReviewHost,
  historyInput: readonly CoworkReviewHistoryEntry[] = [],
  signal: AbortSignal = new AbortController().signal,
): Promise<CoworkReviewResult> {
  const context = snapshot(input);
  const policy = snapshot(policyInput);
  const history = snapshot(historyInput);
  const receipts: CoworkReviewReceipt[] = [];
  let attempt = 0;
  let uncertain = false;
  const result = (
    state: CoworkReviewResult["state"],
    reason: string,
  ): CoworkReviewResult => {
    const findings = receipts.flatMap((receipt) => receipt.findings);
    const blocking = [
      ...new Set(
        findings
          .filter((finding) => finding.category !== "advisory")
          .map((finding) => `${finding.category}:${finding.signature}`),
      ),
    ].sort();
    return snapshot({
      state,
      reason,
      revision: context.revision,
      attempt,
      findings,
      blockingSignature: blocking.length
        ? createHash("sha256").update(JSON.stringify(blocking)).digest("hex")
        : null,
    });
  };
  const finish = async (
    state: CoworkReviewResult["state"],
    reason: string,
  ): Promise<CoworkReviewResult> => {
    const evidence = result(state, reason);
    await host.audit(
      snapshot({
        context,
        attempt,
        state,
        reason,
        receipts,
        blockingSignature: evidence.blockingSignature,
      }),
      signal,
    );
    if (signal.aborted) return result("unknown", "cancelled-audit");
    if (
      state === "ready" &&
      (await host.resolveRevision(snapshot(context), signal)) !==
        context.revision
    ) {
      return finish("stale", "revision-changed-after-audit");
    }
    if (signal.aborted) return result("unknown", "cancelled-audit");
    return evidence;
  };
  if (
    !validContext(context) ||
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 100 ||
    !Number.isInteger(policy.repeatedSignatureLimit) ||
    policy.repeatedSignatureLimit < 2 ||
    policy.repeatedSignatureLimit > policy.maxAttempts ||
    history.length > policy.maxAttempts ||
    history.some(
      (entry, index) =>
        entry.intent !== context.intent ||
        !revision.test(entry.revision) ||
        entry.attempt !== index + 1 ||
        (entry.blockingSignature !== null &&
          !hash.test(entry.blockingSignature)),
    )
  ) {
    return result("blocked", "invalid-input");
  }
  attempt = history.length + 1;
  try {
    if (signal.aborted) return result("stopped", "cancelled-before-dispatch");
    if (attempt > policy.maxAttempts) {
      return await finish("stopped", "attempt-limit");
    }
    const route = selectCoworkCritic({
      ...policy.routing,
      stage: "review",
      author: context.author,
    });
    if (route.state !== "selected") {
      return await finish(route.state, route.reason);
    }
    for (const pass of coworkReviewPasses) {
      if (signal.aborted) return await finish("unknown", "cancelled");
      if (
        (await host.resolveRevision(snapshot(context), signal)) !==
        context.revision
      ) {
        return await finish("stale", "revision-changed");
      }
      const request = snapshot({
        context,
        pass,
        objective: guidance[pass],
        critic: { id: route.model.id, family: route.model.family },
        executor: route.model.executor,
        attempt,
        prompt: JSON.stringify({
          instruction:
            "Review only. Do not approve or execute hub/configuration actions. " +
            "Report blocking correctness/security/data-loss/missing meaningful tests " +
            "separately from advisory findings. Use nonsecret evidence references.",
          pass,
          intent: context.intent,
          revision: context.revision,
          artifacts: context.artifacts,
          contracts: context.contracts,
          changedFiles: context.changedFiles,
        }),
      });
      if ((await host.authorizeReview(snapshot(request), signal)) !== true) {
        return await finish("blocked", "policy-denied");
      }
      if (signal.aborted)
        return await finish("stopped", "cancelled-before-dispatch");
      // Dispatch may have external effects. Failure is uncertainty, not known stop.
      uncertain = true;
      const receipt = snapshot(
        await host.executeReview(snapshot(request), signal),
      );
      if (signal.aborted) return await finish("unknown", "cancelled-dispatch");
      if (!validReceipt(receipt, request)) {
        return await finish("unknown", "invalid-receipt");
      }
      if (
        (await host.attestReview(
          snapshot(request),
          snapshot(receipt),
          signal,
        )) !== true
      ) {
        return await finish("unknown", "executed-identity-unverified");
      }
      uncertain = false;
      receipts.push(receipt);
      if (
        (await host.resolveRevision(snapshot(context), signal)) !==
        context.revision
      ) {
        return await finish("stale", "revision-changed");
      }
      if (receipt.findings.some((finding) => finding.category !== "advisory")) {
        const signature = result("blocked", "findings").blockingSignature;
        const consecutive = [...history]
          .reverse()
          .findIndex((entry) => entry.blockingSignature !== signature);
        const repetitions = consecutive === -1 ? history.length : consecutive;
        return await finish(
          repetitions + 1 >= policy.repeatedSignatureLimit
            ? "stopped"
            : "blocked",
          repetitions + 1 >= policy.repeatedSignatureLimit
            ? "repeated-findings"
            : "blocking-findings",
        );
      }
    }

    if (
      context.risk === "critical" &&
      (await host.verifyHumanApproval(
        snapshot(context),
        snapshot([{ id: route.model.id, family: route.model.family }]),
        signal,
      )) !== true
    ) {
      return await finish("needs-human", "critical-human-gate");
    }
    if (signal.aborted) return await finish("unknown", "cancelled-approval");
    if (
      (await host.resolveRevision(snapshot(context), signal)) !==
      context.revision
    ) {
      return await finish("stale", "revision-changed");
    }
    return await finish("ready", "reviewed-not-authorized");
  } catch {
    // No dependency error body is retained: it may contain credentials or source.
    return result(
      "unknown",
      uncertain ? "dispatch-unconfirmed" : "host-evidence-unconfirmed",
    );
  }
}

/** Shared executed-critic gate for research/design/build and proposal producers. */
export async function runCoworkStageCritic(
  input: CoworkStageCriticRequest,
  routing: Omit<CoworkCriticSelection, "stage" | "author">,
  host: CoworkStageCriticHost,
  signal: AbortSignal = new AbortController().signal,
): Promise<CoworkStageCriticResult> {
  const request = snapshot(input);
  const finish = async (
    outcome: CoworkStageCriticResult,
  ): Promise<CoworkStageCriticResult> => {
    await host.audit(snapshot(request), snapshot(outcome), signal);
    if (signal.aborted)
      return { state: "unknown", reason: "cancelled" } as const;
    if (
      outcome.state === "passed" &&
      (await host.resolveRevision(snapshot(request), signal)) !==
        request.revision
    ) {
      return finish({
        state: "stale",
        reason: "revision-changed-after-audit",
      });
    }
    return signal.aborted
      ? ({ state: "unknown", reason: "cancelled" } as const)
      : snapshot(outcome);
  };
  if (
    !stages.has(request.stage) ||
    !hash.test(request.intent) ||
    !revision.test(request.revision) ||
    !hash.test(request.artifact) ||
    Object.keys(request.contracts).length > 1000 ||
    !Object.entries(request.contracts).every(
      ([name, value]) => contractIdentifier.test(name) && hash.test(value),
    )
  ) {
    return { state: "blocked", reason: "invalid-input" };
  }
  try {
    const route = selectCoworkCritic({
      ...snapshot(routing),
      stage: request.stage,
      author: request.author,
    });
    if (route.state !== "selected") return await finish(route);
    if (signal.aborted) return { state: "unknown", reason: "cancelled" };
    const invocation = snapshot({
      request,
      critic: { id: route.model.id, family: route.model.family },
      executor: route.model.executor,
    });
    if (
      (await host.resolveRevision(snapshot(request), signal)) !==
      request.revision
    ) {
      return await finish({ state: "stale", reason: "revision-changed" });
    }
    if ((await host.authorize(snapshot(invocation), signal)) !== true) {
      return await finish({ state: "blocked", reason: "policy-denied" });
    }
    if (signal.aborted) return { state: "unknown", reason: "cancelled" };
    const receipt = snapshot(await host.execute(snapshot(invocation), signal));
    if (
      signal.aborted ||
      !receipt ||
      Object.keys(receipt).sort().join(",") !==
        "artifact,critic,findings,intent,revision,stage,state" ||
      receipt.stage !== request.stage ||
      receipt.intent !== request.intent ||
      receipt.revision !== request.revision ||
      receipt.artifact !== request.artifact ||
      !receipt.critic ||
      Object.keys(receipt.critic).sort().join(",") !== "family,id" ||
      receipt.critic.id !== route.model.id ||
      receipt.critic.family !== route.model.family ||
      !["passed", "blocked", "unknown"].includes(receipt.state) ||
      !Array.isArray(receipt.findings) ||
      receipt.findings.length > 1000 ||
      !receipt.findings.every((finding) => identifier.test(finding)) ||
      (receipt.state === "passed" && receipt.findings.length > 0)
    ) {
      return await finish({ state: "unknown", reason: "invalid-receipt" });
    }
    if (
      (await host.attest(snapshot(invocation), snapshot(receipt), signal)) !==
      true
    ) {
      return await finish({
        state: "unknown",
        reason: "executed-identity-unverified",
      });
    }
    if (signal.aborted) return { state: "unknown", reason: "cancelled" };
    if (
      (await host.resolveRevision(snapshot(request), signal)) !==
      request.revision
    ) {
      return await finish({ state: "stale", reason: "revision-changed" });
    }
    return await finish({
      state: receipt.state,
      reason: "executed-critic",
      receipt,
    });
  } catch {
    return { state: "unknown", reason: "host-evidence-unconfirmed" };
  }
}
