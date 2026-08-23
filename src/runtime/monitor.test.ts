import test from "node:test";
import assert from "node:assert/strict";
import { runSyntheticMonitorActivation, type MonitorManifestV01 } from "./monitor.js";

const manifest: MonitorManifestV01 = {
  monitor_id: "monitor-neuroplasticity-001",
  participant_id: "avot-neuroplasticity",
  participant_class: "avot_monitor",
  domain: "music-neuroplasticity",
  status: "candidate",
  host_runtime: "avot-engine",
  activation: { event_types: ["research_signal_observation"], schedule_fallback: null },
  sensing_scope: {
    sources: ["peer_reviewed_literature"],
    queries: ["music neuroplasticity stroke"],
    exclusions: ["unsupported_frequency_healing_claims"],
  },
  interpretive_scope: {
    objectives: ["harmonic-neuroplasticity-research"],
    repositories: ["Tyme-Lab"],
    notion_surfaces: ["CIT PILOT 01 — AVOT Monitor Council / Participation Runtime v0"],
  },
  authority_posture: "analysis_only",
  permitted_actions: ["observe", "normalize", "compare", "interpret", "recommend", "return_evidence"],
  prohibited_actions: ["create_work", "authorize_execution", "merge", "promote_canon", "mutate_institutional_memory"],
  signal_contract: "SIGNAL_PACKET_v0.1",
  return_contract: "EVIDENCE_RETURN_v0.1",
  dormancy_condition: "signal returned or no material change",
};

test("material signal returns evidence and remains consequence-free", () => {
  const result = runSyntheticMonitorActivation(manifest, {
    event_id: "research-001",
    event_type: "research_signal_observation",
    observed_at: "2026-08-23T00:40:00Z",
    source_ref: "evidence:research-001",
    subject: "Music neuroplasticity update",
    summary: "A synthetic material signal for runtime proof.",
    material_change: true,
    novelty_score: 0.8,
    confidence: 0.9,
    recommended_disposition: "research_review",
  });

  assert.ok(result.signal);
  assert.equal(result.signal.authority_posture, "analysis_only");
  assert.equal(result.signal.institutional_effect, "none");
  assert.equal(result.evidence_return.result, "material_signal");
  assert.equal(result.evidence_return.handoff_target, "cit-monitor-council");
  assert.equal(result.evidence_return.dormancy_entered, true);
  assert.deepEqual(result.trace.at(-1), "monitor:dormant");
});

test("no material change returns cleanly without a signal", () => {
  const result = runSyntheticMonitorActivation(manifest, {
    event_id: "research-002",
    event_type: "research_signal_observation",
    observed_at: "2026-08-23T00:41:00Z",
    source_ref: "evidence:research-002",
    subject: "No material change",
    summary: "Synthetic no-change path.",
    material_change: false,
  });

  assert.equal(result.signal, null);
  assert.equal(result.evidence_return.result, "no_material_change");
  assert.deepEqual(result.evidence_return.signal_refs, []);
  assert.equal(result.evidence_return.handoff_target, null);
  assert.equal(result.evidence_return.dormancy_entered, true);
});

test("unpermitted event types fail closed", () => {
  assert.throws(
    () =>
      runSyntheticMonitorActivation(manifest, {
        event_id: "bad-001",
        event_type: "repository_event",
        observed_at: "2026-08-23T00:42:00Z",
        source_ref: "evidence:bad-001",
        subject: "Wrong event",
        summary: "Should fail closed.",
        material_change: true,
      }),
    /event_type_not_permitted/,
  );
});

test("manifest cannot omit the activation path", () => {
  const invalid = structuredClone(manifest);
  invalid.activation.event_types = [];
  invalid.activation.schedule_fallback = null;

  assert.throws(
    () =>
      runSyntheticMonitorActivation(invalid, {
        event_id: "bad-002",
        event_type: "research_signal_observation",
        observed_at: "2026-08-23T00:43:00Z",
        source_ref: "evidence:bad-002",
        subject: "Invalid manifest",
        summary: "Should fail closed.",
        material_change: false,
      }),
    /no_activation_path/,
  );
});
