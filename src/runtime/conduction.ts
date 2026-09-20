import type { InferenceRuntimeAdapter } from "../inference/adapter.js";
import type { InferenceCapability } from "../inference/contracts.js";
import {
  runSovereignInferenceRoundTrip,
  type SovereignInferenceRoundTrip,
} from "../inference/roundtrip.js";
import type {
  EvidenceReturnV01,
  MonitorActivationResult,
  SignalPacketV01,
} from "./monitor.js";

export type MonitorConductionDisposition =
  | "no_material_change"
  | "ready_for_review"
  | "inference_refused"
  | "inference_degraded"
  | "inference_failed";

export interface MonitorConductionHandoff {
  target: "cit-monitor-council" | null;
  authority_posture: "analysis_only";
  institutional_effect: "none";
  disposition: MonitorConductionDisposition;
  evidence_refs: string[];
}

export interface MonitorConductionResult {
  monitor_signal: SignalPacketV01 | null;
  inference: SovereignInferenceRoundTrip | null;
  monitor_evidence_return: EvidenceReturnV01;
  handoff: MonitorConductionHandoff;
  trace: string[];
}

function requestIdForSignal(signal: SignalPacketV01): string {
  if (!signal.signal_id.startsWith("signal:")) {
    throw new Error("monitor_conduction:invalid_signal_identity");
  }
  const suffix = signal.signal_id.slice("signal:".length);
  if (!suffix) {
    throw new Error("monitor_conduction:empty_signal_identity");
  }
  return `monitor-conduction:${suffix}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export async function conductMonitorSignal(
  activation: MonitorActivationResult,
  capabilities: InferenceCapability[],
  adapters: InferenceRuntimeAdapter[],
  capturedAt?: string,
): Promise<MonitorConductionResult> {
  const trace = [...activation.trace];

  if (!activation.signal) {
    trace.push("conduction:no_material_change");
    return {
      monitor_signal: null,
      inference: null,
      monitor_evidence_return: activation.evidence_return,
      handoff: {
        target: null,
        authority_posture: "analysis_only",
        institutional_effect: "none",
        disposition: "no_material_change",
        evidence_refs: [...activation.evidence_return.source_refs],
      },
      trace,
    };
  }

  const signal = activation.signal;
  trace.push("conduction:bounded_inference_requested");

  const request = {
    request_id: requestIdForSignal(signal),
    participant_id: signal.participant_id,
    work_ref: null,
    intent: `Interpret bounded monitor signal '${signal.subject}' without institutional consequence.`,
    input: signal.summary,
    context_refs: unique([
      signal.signal_id,
      ...signal.source_refs,
      ...signal.evidence_refs,
    ]),
    required_capabilities: ["chat"],
    privacy_boundary: "local_only" as const,
    authority_posture: "analysis_only" as const,
    max_cost_class: "zero_marginal" as const,
    latency_class: "interactive" as const,
    evidence_required: true,
  };

  const inference = await runSovereignInferenceRoundTrip(
    request,
    capabilities,
    adapters,
    capturedAt,
  );

  const archive = inference.return_path.archivist;
  const result = archive.result;

  if (archive.request.authority_posture !== "analysis_only") {
    throw new Error("monitor_conduction:archived_authority_violation");
  }
  if (result.authority_effect !== "analysis_return") {
    throw new Error("monitor_conduction:authority_effect_violation");
  }

  const requiredContext = [
    signal.signal_id,
    ...signal.source_refs,
    ...signal.evidence_refs,
  ];
  for (const ref of requiredContext) {
    if (!request.context_refs?.includes(ref)) {
      throw new Error(`monitor_conduction:missing_context_ref:${ref}`);
    }
  }

  const evidenceRefs = unique([
    ...signal.source_refs,
    ...signal.evidence_refs,
    ...result.evidence_refs,
  ]);

  if (result.status === "completed") {
    if (result.evidence_refs.length === 0) {
      throw new Error("monitor_conduction:completed_without_evidence");
    }

    trace.push(
      "conduction:bounded_inference_completed",
      "conduction:review_handoff_prepared",
    );

    return {
      monitor_signal: signal,
      inference,
      monitor_evidence_return: activation.evidence_return,
      handoff: {
        target: "cit-monitor-council",
        authority_posture: "analysis_only",
        institutional_effect: "none",
        disposition: "ready_for_review",
        evidence_refs: evidenceRefs,
      },
      trace,
    };
  }

  trace.push(`conduction:bounded_inference_${result.status}`);

  const disposition: MonitorConductionDisposition =
    result.status === "refused"
      ? "inference_refused"
      : result.status === "degraded"
        ? "inference_degraded"
        : "inference_failed";

  return {
    monitor_signal: signal,
    inference,
    monitor_evidence_return: activation.evidence_return,
    handoff: {
      target: null,
      authority_posture: "analysis_only",
      institutional_effect: "none",
      disposition,
      evidence_refs: evidenceRefs,
    },
    trace,
  };
}
