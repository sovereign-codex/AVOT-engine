import assert from "node:assert/strict";
import test from "node:test";
import { InferenceRuntimeAdapter } from "./adapter.js";
import { InferenceCapability, SovereignInferenceResult } from "./contracts.js";
import { buildATRInferenceRequest, runATRLineageRoundTrip } from "./atr-lineage.js";

const capability: InferenceCapability = {
  capability_id: "atr-lineage-test",
  runtime: "atr-test-runtime",
  model: "fixture",
  capabilities: ["lineage_reconstruction", "evidence_grounding"],
  privacy_boundaries: ["trusted_federation"],
  strategies: ["direct"],
  available: true,
  evidence_capable: true,
  cost_class: "zero_marginal",
  trust_level: "trusted",
};

function adapter(output: unknown, evidenceRefs: string[]): InferenceRuntimeAdapter {
  return {
    runtime: "atr-test-runtime",
    execute: async ({ request, plan }) => {
      const result: SovereignInferenceResult = {
        request_id: request.request_id,
        status: "completed",
        output: JSON.stringify(output),
        capability_used: plan.target_capability,
        runtime_used: plan.target_runtime,
        model_used: "fixture",
        verification: { required: false, status: "not_required" },
        provenance_refs: ["fixture:atr-002v"],
        evidence_refs: evidenceRefs,
        authority_effect: "analysis_return",
      };
      return result;
    },
  };
}

test("maps canonical transcript into existing sovereign inference contract", () => {
  const request = buildATRInferenceRequest({
    request_id: "atr-002v-001",
    lineage_id: "MA-001",
    transcript: "How should I think about artificial intelligence replacing human labor?",
  });

  assert.equal(request.authority_posture, "analysis_only");
  assert.equal(request.evidence_required, true);
  assert.equal(request.intent, "atr.lineage_reconstruction:MA-001");
  assert.deepEqual(request.required_capabilities, ["lineage_reconstruction", "evidence_grounding"]);
  assert.ok(request.prohibited_capabilities?.includes("identity_impersonation"));
});

test("returns voice-ready text plus trace metadata without changing authority", async () => {
  const evidence = ["MA-CORPUS-0001:5.1", "MA-CORPUS-0001:6.54"];
  const response = await runATRLineageRoundTrip(
    {
      request_id: "atr-002v-002",
      lineage_id: "MA-001",
      transcript: "How should I think about artificial intelligence replacing human labor?",
    },
    [capability],
    [
      adapter(
        {
          lineage_id: "MA-001",
          response_text: "A reconstructed answer would distinguish the work itself from judgments about status, fear, and control.",
          inference_classes: ["D"],
          temporal_boundary: "Artificial intelligence is a modern counterfactual outside Marcus Aurelius's historical horizon.",
          confidence: "moderate",
          evidence_refs: evidence,
        },
        evidence,
      ),
    ],
  );

  assert.equal(response.lineage_id, "MA-001");
  assert.equal(response.authority_effect, "analysis_return");
  assert.equal(response.trace_receipt_id, "inference:atr-002v-002");
  assert.deepEqual(response.inference_classes, ["D"]);
  assert.deepEqual(response.evidence_refs, evidence);
});

test("fails closed when non-E reconstruction has no evidence", async () => {
  await assert.rejects(
    () =>
      runATRLineageRoundTrip(
        { request_id: "atr-002v-003", lineage_id: "MA-001", transcript: "Question" },
        [capability],
        [
          adapter(
            {
              lineage_id: "MA-001",
              response_text: "Unsupported synthesis.",
              inference_classes: ["C"],
              temporal_boundary: "within historical horizon",
              confidence: "moderate",
              evidence_refs: [],
            },
            [],
          ),
        ],
      ),
    /missing required evidence references|require evidence references/,
  );
});

test("permits explicit insufficient-evidence return", async () => {
  const response = await runATRLineageRoundTrip(
    { request_id: "atr-002v-004", lineage_id: "MA-001", transcript: "Unanswerable question" },
    [capability],
    [
      adapter(
        {
          lineage_id: "MA-001",
          response_text: "The preserved corpus is insufficient to reconstruct a responsible answer.",
          inference_classes: ["E"],
          temporal_boundary: "outside supported evidentiary scope",
          confidence: "insufficient",
          evidence_refs: [],
        },
        ["ATR:E:insufficient-evidence"],
      ),
    ],
  );

  assert.deepEqual(response.inference_classes, ["E"]);
  assert.equal(response.confidence, "insufficient");
});
