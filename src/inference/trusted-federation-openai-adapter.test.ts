import assert from "node:assert/strict";
import { createServer, Server } from "node:http";
import test from "node:test";

import { InferenceCapability, SovereignInferenceRequest } from "./contracts.js";
import { runSovereignInferenceRoundTrip } from "./roundtrip.js";
import {
  createTrustedFederationOpenAIAdapter,
  TrustedFederationNode,
} from "./trusted-federation-openai-adapter.js";

interface TestRuntimeOptions {
  model: string;
  completion_id?: string;
  output?: string;
  health_status?: number;
  completion_status?: number;
}

async function startRuntime(
  options: TestRuntimeOptions,
): Promise<{ server: Server; base_url: string }> {
  const server = createServer((incoming, response) => {
    if (incoming.method === "GET" && incoming.url === "/v1/models") {
      response.statusCode = options.health_status ?? 200;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          data: [{ id: options.model }],
        }),
      );
      return;
    }

    if (incoming.method === "POST" && incoming.url === "/v1/chat/completions") {
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

        assert.equal(parsed.model, options.model);
        assert.equal(parsed.messages?.[0]?.content, "federation proof request");

        response.statusCode = options.completion_status ?? 200;
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            id: options.completion_id,
            model: options.model,
            choices: [
              {
                message: {
                  role: "assistant",
                  content: options.output ?? `response from ${options.model}`,
                },
              },
            ],
          }),
        );
      });
      return;
    }

    response.statusCode = 404;
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  return {
    server,
    base_url: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

const capability: InferenceCapability = {
  capability_id: "trusted-federation-chat",
  runtime: "trusted-federation-openai",
  node: "trusted-federation-pool-v0",
  capabilities: ["chat"],
  privacy_boundaries: ["trusted_federation"],
  strategies: ["federated"],
  available: true,
  evidence_capable: true,
  cost_class: "local_preferred",
  trust_level: "trusted",
};

function request(
  overrides: Partial<SovereignInferenceRequest> = {},
): SovereignInferenceRequest {
  return {
    request_id: "federation-proof-001",
    work_ref: "work:trusted-federation-topology-loss-v0.1",
    intent: "observe trusted federation topology behavior",
    input: "federation proof request",
    required_capabilities: ["chat"],
    privacy_boundary: "trusted_federation",
    authority_posture: "analysis_only",
    evidence_required: true,
    ...overrides,
  };
}

function nodes(
  nodeAUrl: string,
  nodeBUrl: string,
): TrustedFederationNode[] {
  return [
    {
      node_ref: "node-a",
      base_url: nodeAUrl,
      model: "model-a",
    },
    {
      node_ref: "node-b",
      base_url: nodeBUrl,
      model: "model-b",
    },
  ];
}

test("trusted federation v0.1 requires exactly two distinct nodes", () => {
  assert.throws(
    () =>
      createTrustedFederationOpenAIAdapter({
        nodes: [
          {
            node_ref: "node-a",
            base_url: "http://127.0.0.1:8000",
            model: "model-a",
          },
        ],
      }),
    /requires exactly two configured nodes/,
  );

  assert.throws(
    () =>
      createTrustedFederationOpenAIAdapter({
        nodes: [
          {
            node_ref: "duplicate",
            base_url: "http://127.0.0.1:8000",
            model: "model-a",
          },
          {
            node_ref: "duplicate",
            base_url: "http://127.0.0.1:8001",
            model: "model-b",
          },
        ],
      }),
    /node_ref values must be unique/,
  );
});

test("trusted federation adapter rejects local_only and bounded_execute requests", async () => {
  const nodeA = await startRuntime({
    model: "model-a",
    completion_id: "completion-a",
  });
  const nodeB = await startRuntime({
    model: "model-b",
    completion_id: "completion-b",
  });

  try {
    const adapter = createTrustedFederationOpenAIAdapter({
      nodes: nodes(nodeA.base_url, nodeB.base_url),
    });

    await assert.rejects(
      adapter.execute({
        request: request({ privacy_boundary: "local_only" }),
        plan: {
          request_id: "federation-proof-001",
          target_capability: "trusted-federation-chat",
          target_runtime: "trusted-federation-openai",
          strategy: "federated",
          privacy_boundary: "local_only",
          authority_posture: "analysis_only",
          route_reason: "test",
        },
      }),
      /accepts only trusted_federation/,
    );

    await assert.rejects(
      adapter.execute({
        request: request({ authority_posture: "bounded_execute" }),
        plan: {
          request_id: "federation-proof-001",
          target_capability: "trusted-federation-chat",
          target_runtime: "trusted-federation-openai",
          strategy: "federated",
          privacy_boundary: "trusted_federation",
          authority_posture: "bounded_execute",
          route_reason: "test",
        },
      }),
      /does not permit bounded_execute/,
    );
  } finally {
    await closeServer(nodeA.server);
    await closeServer(nodeB.server);
  }
});

test("two healthy peers yield a completed baseline with explicit topology evidence", async () => {
  const nodeA = await startRuntime({
    model: "model-a",
    completion_id: "completion-a",
    output: "baseline from node a",
  });
  const nodeB = await startRuntime({
    model: "model-b",
    completion_id: "completion-b",
    output: "baseline from node b",
  });

  try {
    const adapter = createTrustedFederationOpenAIAdapter({
      nodes: nodes(nodeA.base_url, nodeB.base_url),
    });

    const roundTrip = await runSovereignInferenceRoundTrip(
      request(),
      [capability],
      [adapter],
    );

    const result = roundTrip.return_path.archivist.result;
    assert.equal(result.status, "completed");
    assert.equal(result.output, "baseline from node a");
    assert.deepEqual(result.node_refs, ["node-a"]);
    assert.equal(result.fallback_used, false);
    assert.ok(result.evidence_refs.includes("topology:node-a:reachable"));
    assert.ok(result.evidence_refs.includes("topology:node-b:reachable"));
    assert.ok(result.evidence_refs.includes("route:selected:node-a"));
    assert.ok(result.evidence_refs.includes("completion:completion-a"));
    assert.equal(roundTrip.return_path.trace.status, "completed");
  } finally {
    await closeServer(nodeA.server);
    await closeServer(nodeB.server);
  }
});

test("loss of the preferred peer reroutes to the second peer and returns degraded evidence", async () => {
  const nodeA = await startRuntime({
    model: "model-a",
    health_status: 503,
    completion_id: "completion-a",
  });
  const nodeB = await startRuntime({
    model: "model-b",
    completion_id: "completion-b",
    output: "rerouted through node b",
  });

  try {
    const adapter = createTrustedFederationOpenAIAdapter({
      nodes: nodes(nodeA.base_url, nodeB.base_url),
    });

    const roundTrip = await runSovereignInferenceRoundTrip(
      request(),
      [capability],
      [adapter],
    );

    const result = roundTrip.return_path.archivist.result;
    assert.equal(result.status, "degraded");
    assert.equal(result.output, "rerouted through node b");
    assert.deepEqual(result.node_refs, ["node-b"]);
    assert.equal(result.fallback_used, true);
    assert.ok(
      result.evidence_refs.includes("topology:node-a:unreachable:http_503"),
    );
    assert.ok(result.evidence_refs.includes("topology:node-b:reachable"));
    assert.ok(result.evidence_refs.includes("route:selected:node-b"));
    assert.ok(result.evidence_refs.includes("completion:completion-b"));
    assert.equal(roundTrip.return_path.trace.status, "degraded");
  } finally {
    await closeServer(nodeA.server);
    await closeServer(nodeB.server);
  }
});

test("missing completion evidence on the preferred peer fails that route closed and falls back", async () => {
  const nodeA = await startRuntime({
    model: "model-a",
    output: "unwitnessed node a response",
  });
  const nodeB = await startRuntime({
    model: "model-b",
    completion_id: "completion-b",
    output: "witnessed node b response",
  });

  try {
    const adapter = createTrustedFederationOpenAIAdapter({
      nodes: nodes(nodeA.base_url, nodeB.base_url),
    });

    const roundTrip = await runSovereignInferenceRoundTrip(
      request(),
      [capability],
      [adapter],
    );

    const result = roundTrip.return_path.archivist.result;
    assert.equal(result.status, "degraded");
    assert.equal(result.output, "witnessed node b response");
    assert.equal(result.fallback_used, true);
    assert.ok(
      result.evidence_refs.includes("route:node-a:failed:missing_completion_id"),
    );
    assert.ok(result.evidence_refs.includes("route:selected:node-b"));
    assert.ok(result.evidence_refs.includes("completion:completion-b"));
  } finally {
    await closeServer(nodeA.server);
    await closeServer(nodeB.server);
  }
});

test("loss of both peers returns a failed evidence-bearing return path instead of synthetic success", async () => {
  const nodeA = await startRuntime({
    model: "model-a",
    health_status: 503,
  });
  const nodeB = await startRuntime({
    model: "model-b",
    health_status: 503,
  });

  try {
    const adapter = createTrustedFederationOpenAIAdapter({
      nodes: nodes(nodeA.base_url, nodeB.base_url),
    });

    const roundTrip = await runSovereignInferenceRoundTrip(
      request(),
      [capability],
      [adapter],
    );

    const result = roundTrip.return_path.archivist.result;
    assert.equal(result.status, "failed");
    assert.equal(result.output, undefined);
    assert.deepEqual(result.node_refs, ["node-a", "node-b"]);
    assert.ok(
      result.evidence_refs.includes("topology:node-a:unreachable:http_503"),
    );
    assert.ok(
      result.evidence_refs.includes("topology:node-b:unreachable:http_503"),
    );
    assert.ok(result.evidence_refs.includes("route:selected:none"));
    assert.equal(roundTrip.return_path.trace.status, "failed");
  } finally {
    await closeServer(nodeA.server);
    await closeServer(nodeB.server);
  }
});
