export type MonitorResultKind = "material_signal" | "no_material_change" | "failed";

export interface MonitorManifestV01 {
  monitor_id: string;
  participant_id: string;
  participant_class: "avot_monitor";
  domain: string;
  status: "candidate" | "tested" | "graduated" | "deprecated";
  host_runtime: string;
  activation: {
    event_types: string[];
    schedule_fallback: string | null;
  };
  sensing_scope: {
    sources: string[];
    queries: string[];
    exclusions: string[];
  };
  interpretive_scope: {
    objectives: string[];
    repositories: string[];
    notion_surfaces: string[];
  };
  authority_posture: "analysis_only";
  permitted_actions: Array<"observe" | "normalize" | "compare" | "interpret" | "recommend" | "return_evidence">;
  prohibited_actions: Array<"create_work" | "authorize_execution" | "merge" | "promote_canon" | "mutate_institutional_memory">;
  signal_contract: "SIGNAL_PACKET_v0.1";
  return_contract: "EVIDENCE_RETURN_v0.1";
  dormancy_condition: string;
}

export interface SyntheticMonitorEvent {
  event_id: string;
  event_type: string;
  observed_at: string;
  source_ref: string;
  subject: string;
  summary: string;
  material_change: boolean;
  novelty_score?: number;
  confidence?: number;
  institutional_significance?: string;
  recommended_receiver?: string;
  recommended_disposition?: "archive_only" | "office_review" | "research_review" | "admission_candidate";
}

export interface SignalPacketV01 {
  signal_id: string;
  monitor_id: string;
  participant_id: string;
  observed_at: string;
  source_type: string;
  source_refs: string[];
  subject: string;
  summary: string;
  novelty_score: number;
  confidence: number;
  material_change: boolean;
  related_objectives: string[];
  related_repositories: string[];
  related_notion_surfaces: string[];
  contradicts_prior_assumption: boolean;
  contradiction_refs: string[];
  institutional_significance: string;
  recommended_receiver: string;
  recommended_disposition: "archive_only" | "office_review" | "research_review" | "admission_candidate";
  authority_posture: "analysis_only";
  institutional_effect: "none";
  evidence_refs: string[];
}

export interface EvidenceReturnV01 {
  activation_id: string;
  participant_id: string;
  activation_event: string;
  started_at: string;
  completed_at: string;
  result: MonitorResultKind;
  signal_refs: string[];
  source_refs: string[];
  transform_refs: string[];
  error_refs: string[];
  handoff_target: string | null;
  return_status: "returned";
  authority_posture: "analysis_only";
  institutional_effect: "none";
  dormancy_entered: true;
}

export interface MonitorActivationResult {
  signal: SignalPacketV01 | null;
  evidence_return: EvidenceReturnV01;
  trace: string[];
}

function assertMonitorManifest(manifest: MonitorManifestV01): void {
  const hasEvent = manifest.activation.event_types.length > 0;
  const hasSchedule = Boolean(manifest.activation.schedule_fallback);
  if (!hasEvent && !hasSchedule) throw new Error("monitor_manifest:no_activation_path");
  if (manifest.sensing_scope.sources.length === 0) throw new Error("monitor_manifest:no_sensing_source");
  if (manifest.authority_posture !== "analysis_only") throw new Error("monitor_manifest:authority_violation");
  for (const required of ["create_work", "authorize_execution", "merge", "promote_canon", "mutate_institutional_memory"] as const) {
    if (!manifest.prohibited_actions.includes(required)) throw new Error(`monitor_manifest:missing_prohibition:${required}`);
  }
}

export function runSyntheticMonitorActivation(
  manifest: MonitorManifestV01,
  event: SyntheticMonitorEvent,
): MonitorActivationResult {
  assertMonitorManifest(manifest);

  const trace = ["monitor:dormant", "monitor:awaken"];
  const startedAt = event.observed_at;

  if (!manifest.activation.event_types.includes(event.event_type)) {
    throw new Error(`monitor_activation:event_type_not_permitted:${event.event_type}`);
  }

  trace.push("monitor:context_bound", "monitor:sensed", "monitor:interpreted");

  let signal: SignalPacketV01 | null = null;
  let result: MonitorResultKind = "no_material_change";
  let handoffTarget: string | null = null;

  if (event.material_change) {
    result = "material_signal";
    handoffTarget = "cit-monitor-council";
    signal = {
      signal_id: `signal:${event.event_id}`,
      monitor_id: manifest.monitor_id,
      participant_id: manifest.participant_id,
      observed_at: event.observed_at,
      source_type: manifest.sensing_scope.sources[0],
      source_refs: [event.source_ref],
      subject: event.subject,
      summary: event.summary,
      novelty_score: event.novelty_score ?? 0.5,
      confidence: event.confidence ?? 0.5,
      material_change: true,
      related_objectives: manifest.interpretive_scope.objectives,
      related_repositories: manifest.interpretive_scope.repositories,
      related_notion_surfaces: manifest.interpretive_scope.notion_surfaces,
      contradicts_prior_assumption: false,
      contradiction_refs: [],
      institutional_significance: event.institutional_significance ?? "Requires bounded institutional interpretation.",
      recommended_receiver: event.recommended_receiver ?? "Knowledge Curator",
      recommended_disposition: event.recommended_disposition ?? "office_review",
      authority_posture: "analysis_only",
      institutional_effect: "none",
      evidence_refs: [event.source_ref],
    };
    trace.push("monitor:signal_packet_emitted", "monitor:handoff_recommended");
  } else {
    trace.push("monitor:no_material_change");
  }

  trace.push("monitor:evidence_returned", "monitor:dormant");

  return {
    signal,
    evidence_return: {
      activation_id: `activation:${event.event_id}`,
      participant_id: manifest.participant_id,
      activation_event: `${event.event_type}:${event.event_id}`,
      started_at: startedAt,
      completed_at: startedAt,
      result,
      signal_refs: signal ? [signal.signal_id] : [],
      source_refs: [event.source_ref],
      transform_refs: ["transform:synthetic-monitor-v0"],
      error_refs: [],
      handoff_target: handoffTarget,
      return_status: "returned",
      authority_posture: "analysis_only",
      institutional_effect: "none",
      dormancy_entered: true,
    },
    trace,
  };
}
