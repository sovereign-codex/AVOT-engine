import { pathToFileURL } from "node:url";
import { InferenceCapability, SovereignInferenceRequest } from "./contracts.js";
import { createLocalOpenAIAdapter } from "./local-openai-adapter.js";
import { runSovereignInferenceRoundTrip } from "./roundtrip.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }
  return value;
}

export async function runRealLocalModelProbe(): Promise<void> {
  const baseUrl = requiredEnv("LOCAL_INFERENCE_BASE_URL");
  const model = requiredEnv("LOCAL_INFERENCE_MODEL");
  const runtime = process.env.LOCAL_INFERENCE_RUNTIME?.trim() || "local-openai-compatible";
  const node = process.env.LOCAL_INFERENCE_NODE?.trim() || "local-sovereign-node";
  const prompt =
    process.env.LOCAL_INFERENCE_PROMPT?.trim() ||
    "Return exactly: sovereign local inference complete";

  const capability: InferenceCapability = {
    capability_id: "real-local-chat",
    runtime,
    model,
    node,
    capabilities: ["chat"],
    privacy_boundaries: ["local_only"],
    strategies: ["direct"],
    available: true,
    evidence_capable: true,
    cost_class: "zero_marginal",
    trust_level: "local",
  };

  const request: SovereignInferenceRequest = {
    request_id: `real-local-${Date.now()}`,
    work_ref: "work:real-local-model-probe-v0.1",
    intent: "observe a real sovereign local model round trip",
    input: prompt,
    required_capabilities: ["chat"],
    privacy_boundary: "local_only",
    authority_posture: "analysis_only",
    evidence_required: true,
  };

  const adapter = createLocalOpenAIAdapter({
    base_url: baseUrl,
    model,
    runtime,
    timeout_ms: 120_000,
  });

  const roundTrip = await runSovereignInferenceRoundTrip(
    request,
    [capability],
    [adapter],
  );

  process.stdout.write(`${JSON.stringify(roundTrip, null, 2)}\n`);
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  runRealLocalModelProbe().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Real local model probe failed: ${message}\n`);
    process.exitCode = 1;
  });
}
