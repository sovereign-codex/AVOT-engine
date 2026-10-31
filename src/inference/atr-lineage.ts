import { InferenceRuntimeAdapter } from "./adapter.js";
import {
  InferenceCapability,
  SovereignInferenceRequest,
  SovereignInferenceResult,
} from "./contracts.js";
import { runSovereignInferenceRoundTrip } from "./roundtrip.js";

export type ATRInferenceClass = "A" | "B" | "C" | "D" | "E";

export interface ATRLineageRequest {
  request_id: string;
  lineage_id: string;
  transcript: string;
  context_refs?: string[];
  privacy_boundary?: SovereignInferenceRequest["privacy_boundary"];
}

export interface ATRLineagePayload {
  lineage_id: string;
  response_text: string;
  inference_classes: ATRInferenceClass[];
  temporal_boundary: string;
  confidence: "high" | "moderate" | "low" | "insufficient";
  evidence_refs: string[];
}

export interface ATRLineageResponse extends ATRLineagePayload {
  request_id: string;
  trace_receipt_id: string;
  status: SovereignInferenceResult["status"];
  provenance_refs: string[];
  authority_effect: SovereignInferenceResult["authority_effect"];
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= max;
}

function parseATRPayload(result: SovereignInferenceResult, expectedLineage: string): ATRLineagePayload {
  if (!boundedText(result.output, 20000)) {
    throw new Error("ATR lineage result must contain a bounded JSON output string.");
  }

  let value: unknown;
  try {
    value = JSON.parse(result.output);
  } catch {
    throw new Error("ATR lineage result output must be valid JSON.");
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ATR lineage result output must be a JSON object.");
  }

  const payload = value as Record<string, unknown>;
  if (payload.lineage_id !== expectedLineage) {
    throw new Error("ATR lineage result lineage_id does not match the request.");
  }
  if (!boundedText(payload.response_text, 12000)) {
    throw new Error("ATR lineage response_text is missing or invalid.");
  }
  if (
    !Array.isArray(payload.inference_classes) ||
    payload.inference_classes.length === 0 ||
    payload.inference_classes.some((v) => !["A", "B", "C", "D", "E"].includes(String(v)))
  ) {
    throw new Error("ATR lineage inference_classes must contain one or more A-E classes.");
  }
  if (!boundedText(payload.temporal_boundary, 1000)) {
    throw new Error("ATR lineage temporal_boundary is missing or invalid.");
  }
  if (!["high", "moderate", "low", "insufficient"].includes(String(payload.confidence))) {
    throw new Error("ATR lineage confidence is invalid.");
  }
  if (
    !Array.isArray(payload.evidence_refs) ||
    payload.evidence_refs.some((v) => !boundedText(v, 2048))
  ) {
    throw new Error("ATR lineage evidence_refs must be an array of bounded strings.");
  }

  const classes = payload.inference_classes as ATRInferenceClass[];
  const evidence = payload.evidence_refs as string[];

  if (classes.some((c) => c !== "E") && evidence.length === 0) {
    throw new Error("ATR lineage claims above class E require evidence references.");
  }
  if (classes.includes("E") && payload.confidence !== "insufficient") {
    throw new Error("ATR class E must use confidence 'insufficient'.");
  }

  return {
    lineage_id: expectedLineage,
    response_text: payload.response_text as string,
    inference_classes: classes,
    temporal_boundary: payload.temporal_boundary as string,
    confidence: payload.confidence as ATRLineagePayload["confidence"],
    evidence_refs: evidence,
  };
}

export function buildATRInferenceRequest(input: ATRLineageRequest): SovereignInferenceRequest {
  if (!boundedText(input.request_id, 128)) throw new Error("ATR request_id is invalid.");
  if (!/^[-A-Za-z0-9_.:]{1,128}$/.test(input.lineage_id)) throw new Error("ATR lineage_id is invalid.");
  if (!boundedText(input.transcript, 12000)) throw new Error("ATR transcript is invalid.");

  return {
    request_id: input.request_id,
    intent: `atr.lineage_reconstruction:${input.lineage_id}`,
    input: input.transcript,
    context_refs: input.context_refs ?? [],
    required_capabilities: ["lineage_reconstruction", "evidence_grounding"],
    prohibited_capabilities: ["identity_impersonation", "historical_voice_claim"],
    privacy_boundary: input.privacy_boundary ?? "trusted_federation",
    authority_posture: "analysis_only",
    latency_class: "interactive",
    evidence_required: true,
  };
}

export async function runATRLineageRoundTrip(
  input: ATRLineageRequest,
  capabilities: InferenceCapability[],
  adapters: InferenceRuntimeAdapter[],
): Promise<ATRLineageResponse> {
  const request = buildATRInferenceRequest(input);
  const roundTrip = await runSovereignInferenceRoundTrip(request, capabilities, adapters);
  const result = roundTrip.return_path.archivist.result;
  const payload = parseATRPayload(result, input.lineage_id);

  const genericEvidence = new Set(result.evidence_refs);
  for (const ref of payload.evidence_refs) {
    if (!genericEvidence.has(ref)) {
      throw new Error(`ATR payload evidence ref '${ref}' is absent from the sovereign inference result evidence_refs.`);
    }
  }

  return {
    request_id: request.request_id,
    ...payload,
    trace_receipt_id: roundTrip.return_path.trace.trace_id,
    status: result.status,
    provenance_refs: result.provenance_refs,
    authority_effect: result.authority_effect,
  };
}
