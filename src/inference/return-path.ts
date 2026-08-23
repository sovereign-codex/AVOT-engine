import {
  InferenceExecutionPlan,
  SovereignInferenceRequest,
  SovereignInferenceResult,
} from "./contracts.js";

export interface ArchivistInferenceEvidence {
  evidence_id: string;
  request_id: string;
  plan: InferenceExecutionPlan;
  request: Pick<
    SovereignInferenceRequest,
    "intent" | "privacy_boundary" | "authority_posture" | "work_ref"
  >;
  result: SovereignInferenceResult;
  captured_at: string;
}

export interface TraceCompatibilityRecord {
  trace_id: string;
  repo: string;
  workflow: string;
  status: SovereignInferenceResult["status"];
  timestamp: string;
}

export interface InferenceReturnPath {
  archivist: ArchivistInferenceEvidence;
  trace: TraceCompatibilityRecord;
}

export function buildInferenceReturnPath(
  request: SovereignInferenceRequest,
  plan: InferenceExecutionPlan,
  result: SovereignInferenceResult,
  capturedAt = new Date().toISOString(),
): InferenceReturnPath {
  if (request.request_id !== plan.request_id || request.request_id !== result.request_id) {
    throw new Error("Cannot build return path for mismatched inference request identities.");
  }

  const evidenceId = `inference:${request.request_id}`;

  return {
    archivist: {
      evidence_id: evidenceId,
      request_id: request.request_id,
      plan,
      request: {
        intent: request.intent,
        privacy_boundary: request.privacy_boundary,
        authority_posture: request.authority_posture,
        work_ref: request.work_ref,
      },
      result,
      captured_at: capturedAt,
    },
    trace: {
      trace_id: evidenceId,
      repo: "sovereign-codex/AVOT-engine",
      workflow: `sovereign-inference/${plan.strategy}/${plan.target_runtime}`,
      status: result.status,
      timestamp: capturedAt,
    },
  };
}
