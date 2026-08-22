import {
  AuthorityPosture,
  InferenceExecutionPlan,
  SovereignInferenceRequest,
  SovereignInferenceResult,
} from "./contracts.js";

export interface InferenceRuntimeContext {
  request: SovereignInferenceRequest;
  plan: InferenceExecutionPlan;
}

export type InferenceRuntimeExecutor = (
  context: InferenceRuntimeContext,
) => Promise<SovereignInferenceResult>;

export interface InferenceRuntimeAdapter {
  runtime: string;
  execute: InferenceRuntimeExecutor;
}

const authorityRank: Record<AuthorityPosture, number> = {
  none: 0,
  analysis_only: 1,
  bounded_execute: 2,
};

function expectedAuthorityEffect(
  posture: AuthorityPosture,
): SovereignInferenceResult["authority_effect"] {
  if (posture === "bounded_execute") return "bounded_execution_return";
  if (posture === "analysis_only") return "analysis_return";
  return "none";
}

function validateResult(
  request: SovereignInferenceRequest,
  plan: InferenceExecutionPlan,
  result: SovereignInferenceResult,
): SovereignInferenceResult {
  if (result.request_id !== request.request_id) {
    throw new Error(
      `Inference result request mismatch: expected '${request.request_id}', received '${result.request_id}'.`,
    );
  }

  if (plan.request_id !== request.request_id) {
    throw new Error(
      `Inference plan request mismatch: expected '${request.request_id}', received '${plan.request_id}'.`,
    );
  }

  if (authorityRank[plan.authority_posture] > authorityRank[request.authority_posture]) {
    throw new Error(
      `Inference plan escalates authority beyond request posture '${request.authority_posture}'.`,
    );
  }

  const expectedEffect = expectedAuthorityEffect(plan.authority_posture);
  if (result.authority_effect !== expectedEffect) {
    throw new Error(
      `Inference result authority effect '${result.authority_effect}' does not match bounded plan posture '${plan.authority_posture}'.`,
    );
  }

  if (request.evidence_required && result.evidence_refs.length === 0) {
    throw new Error("Inference result is missing required evidence references.");
  }

  if (result.verification.required && result.verification.status !== "passed") {
    throw new Error(
      `Inference result verification required but status is '${result.verification.status}'.`,
    );
  }

  return result;
}

export async function executeInferencePlan(
  request: SovereignInferenceRequest,
  plan: InferenceExecutionPlan,
  adapters: InferenceRuntimeAdapter[],
): Promise<SovereignInferenceResult> {
  if (plan.privacy_boundary !== request.privacy_boundary) {
    throw new Error(
      `Inference plan privacy boundary '${plan.privacy_boundary}' does not match request boundary '${request.privacy_boundary}'.`,
    );
  }

  const adapter = adapters.find((candidate) => candidate.runtime === plan.target_runtime);
  if (!adapter) {
    throw new Error(`No runtime adapter registered for '${plan.target_runtime}'.`);
  }

  const result = await adapter.execute({ request, plan });
  return validateResult(request, plan, result);
}
