import type {
  DevSquadAdoDiscoveryFacts,
  DevSquadAdoDiscoveryMatchingPolicy,
  DevSquadAdoDiscoveryMatchingEvidence,
} from "./DevSquadAdoWorkflowWatcher.js";

/** W040 / FR-065: exact host-normalized comparisons before allowlisted evidence. */
export const matchDevSquadAdoDiscovery = (
  policy: DevSquadAdoDiscoveryMatchingPolicy,
  facts: DevSquadAdoDiscoveryFacts,
): DevSquadAdoDiscoveryMatchingEvidence => {
  const order = [
    "state",
    "team",
    "tags-all",
    "tags-any",
    "tags-none",
    "area",
    "iteration",
  ] as const;
  const predicates: DevSquadAdoDiscoveryMatchingEvidence["predicates"][number][] =
    [];
  for (const predicate of order) {
    const filter = policy.filters.find(
      (f) =>
        (f.dimension === "tags" ? `tags-${f.operator}` : f.dimension) ===
        predicate,
    );
    if (!filter) continue;
    const fact =
      facts[filter.dimension === "team" ? "teams" : filter.dimension];
    let outcome: "matched" | "unmatched" | "missing" = "missing";
    if (fact?.kind === "known") {
      let matched: boolean;
      if (filter.dimension === "state")
        matched = filter.values.includes(fact.value as string);
      else {
        const values = fact.value as readonly string[];
        if ("segments" in filter) {
          matched =
            (filter.operator === "subtree" ||
              values.length === filter.segments.length) &&
            filter.segments.length <= values.length &&
            filter.segments.every(
              (segment, index) => segment === values[index],
            );
        } else if (filter.dimension === "team" || filter.operator === "any")
          matched = filter.values.some((value) => values.includes(value));
        else if (filter.operator === "all")
          matched = filter.values.every((value) => values.includes(value));
        else matched = filter.values.every((value) => !values.includes(value));
      }
      outcome = matched ? "matched" : "unmatched";
    }
    predicates.push(Object.freeze({ predicate, outcome }));
  }
  return Object.freeze({
    policyVersion: policy.version,
    decision: predicates.some((p) => p.outcome === "missing")
      ? "facts-missing"
      : predicates.some((p) => p.outcome === "unmatched")
        ? "excluded"
        : "matched",
    predicates: Object.freeze(predicates),
  });
};
