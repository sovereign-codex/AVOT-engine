import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { InferenceCapability, SovereignInferenceRequest } from "./contracts.js";
import { createLocalOpenAIAdapter } from "./local-openai-adapter.js";
import { runSovereignInferenceRoundTrip } from "./roundtrip.js";

const capability: InferenceCapability = {
  capability_id: "local-chat",
  runtime: "local-openai-compatible",
  model: "test-local-model",
  node: "loopback-node",
  capabilities: ["chat"],
  privacy_boundaries: ["local_only"],
  strategies: ["direct"],
  available: true,
  evidence_capable: true,
  cost_class: "zero_marginal",
  trust_level: "local",
};

const request: SovereignInferenceRequest = {
  request_id: "cit-roundtrip-001",
  work_ref: "work:test-roundtrip",
  intent: "prove a local sovereign inference return path",
  input: "Return the phrase: local round trip complete",
  required_capabilities: ["chat"],
  privacy_boundary: "local_only",
  authority_posture: "analysis_only",
  evidence_required: true,
};

test("CIT request completes through a loopback OpenAI-compatible runtime and returns TRACE + Archivist records", async () => {
  const server = createServer((incoming, response) => {
    if (incoming.method !== "POST" || incoming.url !== "/v1/chat/completions") {
      response.statusCode = 404;
      response.end();
      return;
    }

    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk) => {
      body += chunk;
    });
    incoming.on("end", () => {
      const parsed = JSON.parse(body) as {
        model?: string;
        messages?: Array<{ content?: string }>;
      };

      assert.equal(parsed.model, "test-local-model");
      assert.equal(
        parsed.messages?.[0]?.content,
        "Return the phrase: local round trip complete",
      );

      response.statusCode = 200;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          id: "local-completion-001",
          model: "test-local-model",
          choices: [
            {
              message: {
                role: "assistant",
                content: "local round trip complete",
              },
            },
          ],
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const adapter = createLocalOpenAIAdapter({
      base_url: `http://127.0.0.1:${address.port}`,
      model: "test-local-model",
    });

    const roundTrip = await runSovereignInferenceRoundTrip(
      request,
      [capability],
      [adapter],
    );

    assert.equal(roundTrip.return_path.archivist.result.status, "completed");
    assert.equal(
      roundTrip.return_path.archivist.result.output,
      "local round trip complete",
    );
    assert.deepEqual(
      roundTrip.return_path.archivist.result.evidence_refs,
      ["completion:local-completion-001"],
    );
    assert.equal(
      roundTrip.return_path.archivist.result.authority_effect,
      "analysis_return",
    );
    assert.equal(roundTrip.return_path.trace.repo, "sovereign-codex/AVOT-engine");
    assert.equal(roundTrip.return_path.trace.status, "completed");
    assert.equal(
      roundTrip.return_path.trace.workflow,
      "sovereign-inference/direct/local-openai-compatible",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
