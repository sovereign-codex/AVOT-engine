import {
  InferenceCapability,
  InferenceExecutionPlan,
  SovereignInferenceRequest,
} from "./contracts.js";

const costRank = {
  zero_marginal: 0,
  local_preferred: 1,
  metered_allowed: 2,
} as const;

function satisfiesCapabilities(
  candidate: InferenceCapability,
  request: SovereignInferenceRequest,
): boolean {
  const required = request.required_capabilities ?? [];
  const prohibited = request.prohibited_capabilities ?? [];

  return (
    required.every((capability) => candidate.capabilities.includes(capability)) &&
    prohibited.every((capability) => !candidate.capabilities.includes(capability))
  );
}

function satisfiesPrivacy(
  candidate: InferenceCapability,
  request: SovereignInferenceRequest,
): boolean {
  if (!candidate.privacy_boundaries.includes(request.privacy_boundary)) return false;

  if (request.privacy_boundary === "local_only") {
    return candidate.trust_level === "local";
  }

  if (request.privacy_boundary === "trusted_federation") {
    return candidate.trust_level === "local" || candidate.trust_level === "trusted";
  }

  return true;
}

function satisfiesCost(
  candidate: InferenceCapability,
  request: SovereignInferenceRequest,
): boolean {
  if (!request.max_cost_class) return true;
  return costRank[candidate.cost_class] <= costRank[request.max_cost_class];
}

function satisfiesEvidence(
  candidate: InferenceCapability,
  request: SovereignInferenceRequest,
): boolean {
  return !request.evidence_required || candidate.evidence_capable;
}

function hasDeclaredStrategy(candidate: InferenceCapability): boolean {
  return candidate.strategies.length > 0;
}

export function routeInferenceRequest(
  request: SovereignInferenceRequest,
  candidates: InferenceCapability[],
): InferenceExecutionPlan {
  const eligible = candidates.filter(
    (candidate) =>
      candidate.available &&
      satisfiesCapabilities(candidate, request) &&
      satisfiesPrivacy(candidate, request) &&
      satisfiesCost(candidate, request) &&
      satisfiesEvidence(candidate, request) &&
      hasDeclaredStrategy(candidate),
  );

  if (eligible.length === 0) {
    throw new Error(
      `No inference route satisfies hard constraints for request '${request.request_id}'.`,
    );
  }

  const ranked = [...eligible].sort((a, b) => {
    const trustRank = { local: 0, trusted: 1, external: 2 } as const;
    const trustDelta = trustRank[a.trust_level] - trustRank[b.trust_level];
    if (trustDelta !== 0) return trustDelta;
    return costRank[a.cost_class] - costRank[b.cost_class];
  });

  const selected = ranked[0];
  const strategy = selected.strategies[0];

  return {
    request_id: request.request_id,
    target_capability: selected.capability_id,
    target_runtime: selected.runtime,
    target_model: selected.model,
    target_node: selected.node,
    strategy,
    privacy_boundary: request.privacy_boundary,
    authority_posture: request.authority_posture,
    route_reason: `Selected ${selected.capability_id}: satisfies capability, privacy/trust, availability, cost, evidence, and strategy constraints.`,
    fallback_plan: ranked.slice(1).map((candidate) => candidate.capability_id),
  };
}
