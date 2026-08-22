import assert from "node:assert/strict";
import test from "node:test";

import { executeInferencePlan, InferenceRuntimeAdapter } from "./adapter.js";
import { InferenceExecutionPlan, SovereignInferenceRequest, SovereignInferenceResult } from "./contracts.js";

function request(overrides: Partial<SovereignInferenceRequest> = {}): SovereignInferenceRequest {
  return {
    request_id: "req-adapter-001",
    intent: "test bounded execution",
    input: "perform analysis",
    privacy_boundary: "local_only",
    authority_posture: "analysis_only",
    evidence_required: true,
    ...overrides,
  };
}

function plan(overrides: Partial<InferenceExecutionPlan> = {}): InferenceExecutionPlan {
  return {
    request_id: "req-adapter-001",
    target_capability: "local-fast",
    target_runtime: "mock-local",
    strategy: "direct",
    privacy_boundary: "local_only",
    authority_posture: "analysis_only",
    route_reason: "test route",
    ...overrides,
  };
}

function result(overrides: Partial<SovereignInferenceResult> = {}): SovereignInferenceResult {
  return {
    request_id: "req-adapter-001",
    status: "completed",
    output: "bounded result",
    verification: {
      required: false,
      status: "not_required",
    },
    provenance_refs: ["prov:test"],
    evidence_refs: ["evidence:test"],
    authority_effect: "analysis_return",
    ...overrides,
  };
}

function adapter(output: SovereignInferenceResult): InferenceRuntimeAdapter {
  return {
    runtime: "mock-local",
    execute: async () => output,
  };
}

test("accepts a result that preserves privacy, authority, evidence, and request identity", async () => {
  const accepted = await executeInferencePlan(request(), plan(), [adapter(result())]);
  assert.equal(accepted.status, "completed");
  assert.equal(accepted.authority_effect, "analysis_return");
});

test("fails closed when required evidence is absent", async () => {
  await assert.rejects(
    executeInferencePlan(request(), plan(), [adapter(result({ evidence_refs: [] }))]),
    /missing required evidence references/,
  );
});

test("fails closed when a result claims authority beyond the bounded plan", async () => {
  await assert.rejects(
    executeInferencePlan(
      request(),
      plan(),
      [adapter(result({ authority_effect: "bounded_execution_return" }))],
    ),
    /does not match bounded plan posture/,
  );
});

test("fails closed when verification is required but not passed", async () => {
  await assert.rejects(
    executeInferencePlan(
      request(),
      plan(),
      [
        adapter(
          result({
            verification: {
              required: true,
              status: "pending",
            },
          }),
        ),
      ],
    ),
    /verification required but status is 'pending'/,
  );
});

test("fails closed when the runtime adapter is unavailable", async () => {
  await assert.rejects(
    executeInferencePlan(request(), plan({ target_runtime: "missing-runtime" }), []),
    /No runtime adapter registered/,
  );
});
