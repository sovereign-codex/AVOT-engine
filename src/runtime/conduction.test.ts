import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { createLocalOpenAIAdapter } from "../inference/local-openai-adapter.js";
import type { InferenceCapability } from "../inference/contracts.js";
import { runCitPilot02Conduction } from "./conduction.js";
import type { MonitorManifestV01 } from "./monitor.js";

const manifest: MonitorManifestV01 = {
  monitor_id: "monitor-neuroplasticity-001",
  participant_id: "avot-neuroplasticity",
  participant_class: "avot_monitor",
  domain: "music-neuroplasticity",
  status: "candidate",
  host_runtime: "avot-engine",
  activation: {
    event_types: ["research_signal_observation"],
    schedule_fallback: null,
  },
  sensing_scope: {
    sources: ["peer_reviewed_literature"],
    queries: ["music neuroplasticity stroke"],
    exclusions: ["unsupported_frequency_healing_claims"],
  },
  interpretive_scope: {
    objectives: ["harmonic-neuroplasticity-research"],
    repositories: ["Tyme-Lab", "AVOT-engine"],
    notion_surfaces: ["CIT PILOT 01 — AVOT Monitor Council / Participation Runtime v0"],
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
  runtime: "local-openai-compatible",
  model: "cit-pilot-02-test-model",
  node: "loopback-node",
  capabilities: ["chat"],
  privacy_boundaries: ["local_only"],
  strategies: ["direct"],
  available: true,
  evidence_capable: true,
  cost_class: "zero_marginal",
  trust_level: "local",
};

test("CIT Pilot 02 conducts perception through local inference and returns evidence without consequence", async () => {
  const server = createServer((incoming, response) => {
    if (incoming.method !== "POST" || incoming.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }

    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        id: "cit-pilot-02-completion-001",
        model: "cit-pilot-02-test-model",
        choices: [
          {
            message: {
              role: "assistant",
              content: "The signal is relevant to the existing neuroplasticity research objective and should be reviewed, not executed.",
            },
          },
        ],
      }),
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const adapter = createLocalOpenAIAdapter({
      base_url: `http://127.0.0.1:${address.port}`,
      model: "cit-pilot-02-test-model",
    });

    const result = await runCitPilot02Conduction(
      manifest,
      {
        event_id: "neuroplasticity-signal-001",
        event_type: "research_signal_observation",
        observed_at: "2026-08-23T01:00:00Z",
        source_ref: "evidence:paper-001",
        subject: "Synthetic neuroplasticity research signal",
        summary: "A new study appears materially relevant to the existing neuroplasticity hypothesis.",
        material_change: true,
        novelty_score: 0.81,
        confidence: 0.89,
        recommended_disposition: "research_review",
      },
      [capability],
      [adapter],
    );

    assert.ok(result.monitor_signal);
    assert.ok(result.inference);
    assert.equal(result.inference.request.participant_id, "avot-neuroplasticity");
    assert.equal(result.inference.request.work_ref, null);
    assert.equal(result.inference.request.privacy_boundary, "local_only");
    assert.equal(result.inference.request.authority_posture, "analysis_only");
    assert.equal(
      result.inference.return_path.archivist.result.authority_effect,
      "analysis_return",
    );
    assert.equal(result.council_handoff.target, "cit-monitor-council");
    assert.equal(result.council_handoff.authority_posture, "analysis_only");
    assert.equal(result.council_handoff.institutional_effect, "none");
    assert.ok(result.council_handoff.evidence_refs.includes("evidence:paper-001"));
    assert.ok(
      result.council_handoff.evidence_refs.includes(
        "completion:cit-pilot-02-completion-001",
      ),
    );
    assert.equal(result.evidence_return.dormancy_entered, true);
    assert.equal(result.trace.at(-1), "cit:council_handoff_prepared");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("CIT Pilot 02 does not recruit inference when perception returns no material change", async () => {
  const result = await runCitPilot02Conduction(
    manifest,
    {
      event_id: "neuroplasticity-no-change-001",
      event_type: "research_signal_observation",
      observed_at: "2026-08-23T01:01:00Z",
      source_ref: "evidence:paper-002",
      subject: "No material change",
      summary: "The observed item does not change the current research state.",
      material_change: false,
    },
    [],
    [],
  );

  assert.equal(result.monitor_signal, null);
  assert.equal(result.inference, null);
  assert.equal(result.council_handoff.target, null);
  assert.equal(result.council_handoff.institutional_effect, "none");
  assert.equal(result.evidence_return.result, "no_material_change");
  assert.equal(result.evidence_return.dormancy_entered, true);
});
