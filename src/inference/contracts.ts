export type PrivacyBoundary =
  | "local_only"
  | "trusted_federation"
  | "cloud_allowed";

export type AuthorityPosture = "none" | "analysis_only" | "bounded_execute";

export interface SovereignInferenceRequest {
  request_id: string;
  participant_id?: string;
  work_ref?: string | null;
  intent: string;
  input: string;
  context_refs?: string[];
  required_capabilities?: string[];
  prohibited_capabilities?: string[];
  privacy_boundary: PrivacyBoundary;
  authority_posture: AuthorityPosture;
  max_cost_class?: "zero_marginal" | "local_preferred" | "metered_allowed";
  latency_class?: "interactive" | "standard" | "batch";
  evidence_required?: boolean;
}

export interface SidecarBinding {
  sidecar_id: string;
  capability: string;
  role:
    | "draft"
    | "retrieval"
    | "verification"
    | "tool_adapter"
    | "hardware_optimizer"
    | "specialist";
  authority_posture: "none" | "analysis_only";
  required: boolean;
}

export interface InferenceExecutionPlan {
  request_id: string;
  target_capability: string;
  target_runtime: string;
  target_model?: string;
  target_node?: string;
  strategy:
    | "direct"
    | "speculative"
    | "moe"
    | "distributed"
    | "federated"
    | "cloud_fallback";
  sidecars?: SidecarBinding[];
  privacy_boundary: PrivacyBoundary;
  authority_posture: AuthorityPosture;
  route_reason: string;
  fallback_plan?: string[];
}

export interface SovereignInferenceResult {
  request_id: string;
  plan_ref?: string;
  status: "completed" | "refused" | "degraded" | "failed";
  output?: string;
  capability_used?: string;
  runtime_used?: string;
  model_used?: string;
  node_refs?: string[];
  sidecars_used?: string[];
  verification: {
    required: boolean;
    status: "not_required" | "pending" | "passed" | "failed";
    verifier_refs?: string[];
  };
  provenance_refs: string[];
  evidence_refs: string[];
  fallback_used?: boolean;
  authority_effect: "none" | "analysis_return" | "bounded_execution_return";
}

export interface InferenceCapability {
  capability_id: string;
  runtime: string;
  model?: string;
  node?: string;
  capabilities: string[];
  privacy_boundaries: PrivacyBoundary[];
  strategies: InferenceExecutionPlan["strategy"][];
  available: boolean;
  evidence_capable: boolean;
  cost_class: "zero_marginal" | "local_preferred" | "metered_allowed";
  trust_level: "local" | "trusted" | "external";
}
