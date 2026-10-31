import assert from "node:assert/strict";
import test from "node:test";
import { InferenceRuntimeAdapter } from "./adapter.js";
import { InferenceCapability, SovereignInferenceResult } from "./contracts.js";
import { createMarcusAureliusATRAdapter } from "./atr-grounded-adapter.js";
import { MA_CORPUS_0001 } from "./atr-ma-corpus.js";
import { retrieveATRPassages } from "./atr-retrieval.js";
import { runATRLineageRoundTrip } from "./atr-lineage.js";

test("retrieval selects duty and common-good records for modern labor question", () => {
  const hits = retrieveATRPassages(
    "How should I think about artificial intelligence replacing human labor and our duty to the community?",
    MA_CORPUS_0001,
    4,
  );

  const ids = hits.map((hit) => hit.record.record_id);
  assert.ok(ids.includes("MA-MED-05-01"));
  assert.ok(ids.includes("MA-MED-06-54"));
});

test("grounded adapter injects corpus context and returns corpus evidence refs", async () => {
  let observedPrompt = "";
  const delegate: InferenceRuntimeAdapter = {
    runtime: "fixture-provider",
    execute: async ({ request, plan }) => {
      observedPrompt = request.input;
      const result: SovereignInferenceResult = {
        request_id: request.request_id,
        status: "completed",
        output: JSON.stringify({
          lineage_id: "MA-001",
          response_text: "A modern labor question is a counterfactual extension; the surviving material supports examining duty and the common good rather than attributing a view on AI itself.",
          inference_classes: ["D"],
          temporal_boundary: "Artificial intelligence is outside Marcus Aurelius's historical horizon.",
          confidence: "moderate",
          evidence_refs: ["MA-CORPUS-0001:5.1", "MA-CORPUS-0001:6.54"],
        }),
        capability_used: plan.target_capability,
        runtime_used: "fixture-provider",
        model_used: "fixture",
        verification: { required: false, status: "not_required" },
        provenance_refs: ["fixture:provider"],
        evidence_refs: [],
        authority_effect: "analysis_return",
      };
      return result;
    },
  };

  const grounded = createMarcusAureliusATRAdapter({ delegate, max_passages: 6 });
  const capability: InferenceCapability = {
    capability_id: "atr-ma-001",
    runtime: grounded.runtime,
    model: "fixture",
    capabilities: ["lineage_reconstruction", "evidence_grounding"],
    privacy_boundaries: ["trusted_federation"],
    strategies: ["direct"],
    available: true,
    evidence_capable: true,
    cost_class: "zero_marginal",
    trust_level: "trusted",
  };

  const response = await runATRLineageRoundTrip(
    {
      request_id: "atr-ma-grounded-001",
      lineage_id: "MA-001",
      transcript: "How should I think about artificial intelligence replacing human labor and our duty to the community?",
    },
    [capability],
    [grounded],
  );

  assert.match(observedPrompt, /CANONICAL USER TRANSCRIPT/);
  assert.match(observedPrompt, /MA-CORPUS-0001:5\.1/);
  assert.match(observedPrompt, /never claim to be the historical person/);
  assert.deepEqual(response.inference_classes, ["D"]);
  assert.ok(response.evidence_refs.includes("MA-CORPUS-0001:5.1"));
  assert.ok(response.evidence_refs.includes("MA-CORPUS-0001:6.54"));
  assert.equal(response.authority_effect, "analysis_return");
});
