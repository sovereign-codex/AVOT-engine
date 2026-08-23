import type { InferenceRuntimeAdapter } from "../inference/adapter.js";
import type {
  InferenceCapability,
  SovereignInferenceRequest,
} from "../inference/contracts.js";
import {
  runSovereignInferenceRoundTrip,
  type SovereignInferenceRoundTrip,
} from "../inference/roundtrip.js";
import {
  runSyntheticMonitorActivation,
  type EvidenceReturnV01,
  type MonitorManifestV01,
  type SignalPacketV01,
  type SyntheticMonitorEvent,
} from "./monitor.js";

export interface CitPilot02Result {
  monitor_signal: SignalPacketV01 | null;
  inference: SovereignInferenceRoundTrip | null;
  evidence_return: EvidenceReturnV01;
  council_handoff: {
    target: "cit-monitor-council" | null;
    authority_posture: "analysis_only";
    institutional_effect: "none";
    evidence_refs: string[];
  };
  trace: string[];
}

export async function runCitPilot02Conduction(
  manifest: MonitorManifestV01,
  event: SyntheticMonitorEvent,
  capabilities: InferenceCapability[],
  adapters: InferenceRuntimeAdapter[],
): Promise<CitPilot02Result> {
  const monitor = runSyntheticMonitorActivation(manifest, event);
  const trace = [...monitor.trace];

  if (!monitor.signal) {
    return {
      monitor_signal: null,
      inference: null,
      evidence_return: monitor.evidence_return,
      council_handoff: {
        target: null,
        authority_posture: "analysis_only",
        institutional_effect: "none",
        evidence_refs: [...monitor.evidence_return.source_refs],
      },
      trace,
    };
  }

  trace.push("cit:bounded_inference_requested");

  const request: SovereignInferenceRequest = {
    request_id: `inference:${event.event_id}`,
    participant_id: manifest.participant_id,
    work_ref: null,
    intent: `Interpret bounded monitor signal '${monitor.signal.subject}' without institutional consequence.`,
    input: monitor.signal.summary,
    context_refs: [monitor.signal.signal_id, ...monitor.signal.evidence_refs],
    required_capabilities: ["chat"],
    privacy_boundary: "local_only",
    authority_posture: "analysis_only",
    max_cost_class: "zero_marginal",
    latency_class: "interactive",
    evidence_required: true,
  };

  const inference = await runSovereignInferenceRoundTrip(
    request,
    capabilities,
    adapters,
  );

  if (inference.return_path.archivist.result.authority_effect !== "analysis_return") {
    throw new Error("cit_pilot_02:inference_authority_effect_violation");
  }

  const inferenceEvidence = inference.return_path.archivist.result.evidence_refs;
  if (inferenceEvidence.length === 0) {
    throw new Error("cit_pilot_02:missing_inference_evidence");
  }

  trace.push("cit:bounded_inference_returned", "cit:council_handoff_prepared");

  const evidenceReturn: EvidenceReturnV01 = {
    ...monitor.evidence_return,
    transform_refs: [
      ...monitor.evidence_return.transform_refs,
      `transform:${inference.return_path.archivist.evidence_id}`,
    ],
    handoff_target: "cit-monitor-council",
  };

  return {
    monitor_signal: monitor.signal,
    inference,
    evidence_return: evidenceReturn,
    council_handoff: {
      target: "cit-monitor-council",
      authority_posture: "analysis_only",
      institutional_effect: "none",
      evidence_refs: [
        ...monitor.signal.evidence_refs,
        ...inferenceEvidence,
      ],
    },
    trace,
  };
}
