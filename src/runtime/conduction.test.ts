import assert from "node:assert/strict";
import test from "node:test";

import type { InferenceRuntimeAdapter } from "../inference/adapter.js";
import type { InferenceCapability } from "../inference/contracts.js";
import { conductMonitorSignal } from "./conduction.js";
import {
  runSyntheticMonitorActivation,
  type MonitorManifestV01,
  type SyntheticMonitorEvent,
} from "./monitor.js";

const manifest: MonitorManifestV01 = {
  monitor_id: "monitor-era-circulation-001",
  participant_id: "avot-era-circulation",
  participant_class: "avot_monitor",
  domain: "institutional-coherence",
  status: "candidate",
  host_runtime: "avot-engine",
  activation: {
    event_types: ["research_signal_observation"],
    schedule_fallback: null,
  },
  sensing_scope: {
    sources: ["synthetic_fixture"],
    queries: ["era avot circulation"],
    exclusions: ["live_monitoring"],
  },
  interpretive_scope: {
    objectives: ["era-avot-circulation-001"],
    repositories: ["AVOT-engine", "AVOT-ARCHIVIST"],
    notion_surfaces: ["ERA_RESTAGING_DESIGN_001"],
  },
  authority_posture: "analysis_only",
  permitted_actions: [
    "observe",
    "normalize",
    "compare",
    "interpret",
    "recommend",
    "return_evidence",
  ],
  prohibited_actions: [
    "create_work",
    "authorize_execution",
    "merge",
    "promote_canon",
    "mutate_institutional_memory",
  ],
  signal_contract: "SIGNAL_PACKET_v0.1",
  return_contract: "EVIDENCE_RETURN_v0.1",
  dormancy_condition: "signal returned or no material change",
};

const capability: InferenceCapability = {
  capability_id: "local-chat",
  runtime: "era-test-runtime",
  model: "era-test-model",
  node: "era-test-node",
  capabilities: ["chat"],
  privacy_boundaries: ["local_only"],
  strategies: ["direct"],
  available: true,
  evidence_capable: true,
  cost_class: "zero_marginal",
  trust_level: "local",
};

function event(materialChange = true): SyntheticMonitorEvent {
  return {
    event_id: "era-avot-circulation-001",
    event_type: "research_signal_observation",
    observed_at: "2026-09-20T17:00:00Z",
    source_ref: "evidence:era-avot-circulation-source-001",
    subject: "Synthetic institutional coherence signal",
    summary: "A synthetic signal for current-main Engine and Archivist circulation testing.",
    material_change: materialChange,
    novelty_score: 0.8,
    confidence: 0.9,
    recommended_disposition: "research_review",
  };
}

function adapter(
  status: "completed" | "refused" | "degraded" | "failed",
): InferenceRuntimeAdapter {
  return {
    runtime: "era-test-runtime",
    execute: async ({ request, plan }) => ({
      request_id: request.request_id,
      status,
      output:
        status === "completed" || status === "degraded"
          ? `synthetic ${status} analysis return`
          : undefined,
      capability_used: plan.target_capability,
      runtime_used: plan.target_runtime,
      model_used: plan.target_model,
      node_refs: plan.target_node ? [plan.target_node] : [],
      verification: {
        required: false,
        status: "not_required",
      },
      provenance_refs: ["runtime:era-test-runtime"],
      evidence_refs: [`evidence:era-${status}-001`],
      authority_effect: "analysis_return",
    }),
  };
}

test("material signal conducts through bounded inference and prepares a non-authorizing review handoff", async () => {
  const activation = runSyntheticMonitorActivation(manifest, event(true));
  const result = await conductMonitorSignal(
    activation,
    [capability],
    [adapter("completed")],
  );

  assert.ok(result.monitor_signal);
  assert.ok(result.inference);
  assert.equal(
    result.inference.request.request_id,
    "monitor-conduction:era-avot-circulation-001",
  );
  assert.deepEqual(result.inference.request.context_refs, [
    "signal:era-avot-circulation-001",
    "evidence:era-avot-circulation-source-001",
  ]);
  assert.equal(result.inference.request.work_ref, null);
  assert.equal(result.inference.request.authority_posture, "analysis_only");
  assert.equal(
    result.inference.return_path.archivist.result.authority_effect,
    "analysis_return",
  );
  assert.equal(result.handoff.target, "cit-monitor-council");
  assert.equal(result.handoff.institutional_effect, "none");
  assert.equal(result.handoff.disposition, "ready_for_review");
  assert.ok(
    result.handoff.evidence_refs.includes(
      "evidence:era-avot-circulation-source-001",
    ),
  );
  assert.ok(
    result.handoff.evidence_refs.includes("evidence:era-completed-001"),
  );
});

test("no material change does not recruit inference", async () => {
  const activation = runSyntheticMonitorActivation(manifest, event(false));
  const result = await conductMonitorSignal(activation, [], []);

  assert.equal(result.monitor_signal, null);
  assert.equal(result.inference, null);
  assert.equal(result.handoff.target, null);
  assert.equal(result.handoff.disposition, "no_material_change");
});

for (const status of ["refused", "degraded", "failed"] as const) {
  test(`${status} inference remains non-success and cannot produce a council handoff`, async () => {
    const activation = runSyntheticMonitorActivation(manifest, event(true));
    const result = await conductMonitorSignal(
      activation,
      [capability],
      [adapter(status)],
    );

    assert.ok(result.inference);
    assert.equal(result.inference.return_path.archivist.result.status, status);
    assert.equal(result.handoff.target, null);
    assert.equal(result.handoff.institutional_effect, "none");
    assert.equal(result.handoff.disposition, `inference_${status}`);
  });
}

test("widened authority effect is rejected by the existing inference validator", async () => {
  const violating: InferenceRuntimeAdapter = {
    runtime: "era-test-runtime",
    execute: async ({ request, plan }) => ({
      request_id: request.request_id,
      status: "completed",
      output: "invalid widened authority",
      capability_used: plan.target_capability,
      runtime_used: plan.target_runtime,
      model_used: plan.target_model,
      node_refs: plan.target_node ? [plan.target_node] : [],
      verification: {
        required: false,
        status: "not_required",
      },
      provenance_refs: ["runtime:era-test-runtime"],
      evidence_refs: ["evidence:era-authority-violation"],
      authority_effect: "bounded_execution_return",
    }),
  };

  const activation = runSyntheticMonitorActivation(manifest, event(true));
  await assert.rejects(
    conductMonitorSignal(activation, [capability], [violating]),
    /does not match bounded plan posture 'analysis_only'/,
  );
});

test("completed inference without evidence fails closed", async () => {
  const missingEvidence: InferenceRuntimeAdapter = {
    runtime: "era-test-runtime",
    execute: async ({ request, plan }) => ({
      request_id: request.request_id,
      status: "completed",
      output: "missing evidence",
      capability_used: plan.target_capability,
      runtime_used: plan.target_runtime,
      model_used: plan.target_model,
      node_refs: plan.target_node ? [plan.target_node] : [],
      verification: {
        required: false,
        status: "not_required",
      },
      provenance_refs: ["runtime:era-test-runtime"],
      evidence_refs: [],
      authority_effect: "analysis_return",
    }),
  };

  const activation = runSyntheticMonitorActivation(manifest, event(true));
  await assert.rejects(
    conductMonitorSignal(activation, [capability], [missingEvidence]),
    /missing required evidence references/,
  );
});
