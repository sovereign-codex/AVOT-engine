import { pathToFileURL } from "node:url";
import { InferenceCapability } from "./contracts.js";
import { createMarcusAureliusATRAdapter } from "./atr-grounded-adapter.js";
import { runATRLineageRoundTrip } from "./atr-lineage.js";
import { createTrustedFederationOpenAIAdapter } from "./trusted-federation-openai-adapter.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

export async function runRealMarcusFederationProbe(): Promise<void> {
  const nodeAUrl = requiredEnv("ATR_FED_NODE_A_URL");
  const nodeAModel = requiredEnv("ATR_FED_NODE_A_MODEL");
  const nodeBUrl = requiredEnv("ATR_FED_NODE_B_URL");
  const nodeBModel = requiredEnv("ATR_FED_NODE_B_MODEL");
  const prompt =
    process.env.ATR_MA_PROMPT?.trim() ||
    "How should I think about artificial intelligence replacing human labor and our duty to the community?";

  const federation = createTrustedFederationOpenAIAdapter({
    nodes: [
      { node_ref: "atr-node-a", base_url: nodeAUrl, model: nodeAModel },
      { node_ref: "atr-node-b", base_url: nodeBUrl, model: nodeBModel },
    ],
    runtime: "atr-trusted-federation",
    timeout_ms: 120_000,
  });

  const atr = createMarcusAureliusATRAdapter({
    delegate: federation,
    runtime: "atr-ma-001-grounded",
    max_passages: 4,
  });

  const capability: InferenceCapability = {
    capability_id: "atr-ma-001-grounded",
    runtime: atr.runtime,
    node: "atr-trusted-federation-pool-v0",
    capabilities: ["lineage_reconstruction", "evidence_grounding"],
    privacy_boundaries: ["trusted_federation"],
    strategies: ["federated"],
    available: true,
    evidence_capable: true,
    cost_class: "local_preferred",
    trust_level: "trusted",
  };

  const response = await runATRLineageRoundTrip(
    {
      request_id: `atr-ma-real-${Date.now()}`,
      lineage_id: "MA-001",
      transcript: prompt,
      privacy_boundary: "trusted_federation",
    },
    [capability],
    [atr],
  );

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  runRealMarcusFederationProbe().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Real Marcus federation probe failed: ${message}\n`);
    process.exitCode = 1;
  });
}
