import assert from "node:assert/strict";
import test from "node:test";

import { InferenceCapability, SovereignInferenceRequest } from "./contracts.js";
import { routeInferenceRequest } from "./router.js";

const localFast: InferenceCapability = {
  capability_id: "local-fast",
  runtime: "llama.cpp",
  model: "small-local",
  node: "node-a",
  capabilities: ["chat", "tool_calling"],
  privacy_boundaries: ["local_only", "trusted_federation"],
  strategies: ["direct", "speculative"],
  available: true,
  cost_class: "zero_marginal",
  trust_level: "local",
};

const localDeep: InferenceCapability = {
  capability_id: "local-deep",
  runtime: "vllm",
  model: "large-local",
  node: "node-b",
  capabilities: ["chat", "tool_calling", "deep_reasoning"],
  privacy_boundaries: ["local_only", "trusted_federation"],
  strategies: ["distributed", "direct"],
  available: true,
  cost_class: "local_preferred",
  trust_level: "local",
};

function request(overrides: Partial<SovereignInferenceRequest> = {}): SovereignInferenceRequest {
  return {
    request_id: "req-001",
    intent: "test sovereign routing",
    input: "route this request",
    privacy_boundary: "local_only",
    authority_posture: "analysis_only",
    evidence_required: true,
    ...overrides,
  };
}

test("routes to the least-cost local capability when both satisfy hard constraints", () => {
  const plan = routeInferenceRequest(request({ required_capabilities: ["chat"] }), [
    localDeep,
    localFast,
  ]);

  assert.equal(plan.target_capability, "local-fast");
  assert.equal(plan.target_runtime, "llama.cpp");
  assert.deepEqual(plan.fallback_plan, ["local-deep"]);
});

test("routes to the only capability satisfying a specialist requirement", () => {
  const plan = routeInferenceRequest(
    request({ required_capabilities: ["deep_reasoning"] }),
    [localFast, localDeep],
  );

  assert.equal(plan.target_capability, "local-deep");
  assert.equal(plan.strategy, "distributed");
});

test("fails closed when privacy constraints exclude all candidates", () => {
  const externalOnly: InferenceCapability = {
    ...localFast,
    capability_id: "external-only",
    privacy_boundaries: ["cloud_allowed"],
    trust_level: "external",
    cost_class: "metered_allowed",
  };

  assert.throws(
    () => routeInferenceRequest(request(), [externalOnly]),
    /No inference route satisfies hard constraints/,
  );
});

test("fails closed when prohibited capabilities are present", () => {
  assert.throws(
    () =>
      routeInferenceRequest(
        request({ prohibited_capabilities: ["tool_calling"] }),
        [localFast, localDeep],
      ),
    /No inference route satisfies hard constraints/,
  );
});
