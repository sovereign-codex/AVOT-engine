import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { InferenceCapability, SovereignInferenceRequest } from "./contracts.js";
import { createLocalOpenAIAdapter } from "./local-openai-adapter.js";
import { runSovereignInferenceRoundTrip } from "./roundtrip.js";

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}.`);
  return value;
}

function runCount(): number {
  const raw = process.env.BENCHMARK_RUNS?.trim() || "3";
  const count = Number.parseInt(raw, 10);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("BENCHMARK_RUNS must be an integer from 1 to 50.");
  }
  return count;
}

function percentile(values: number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

export async function runOpenAIRuntimeBenchmark(): Promise<void> {
  const baseUrl = requiredEnv("LOCAL_INFERENCE_BASE_URL");
  const model = requiredEnv("LOCAL_INFERENCE_MODEL");
  const runtime = process.env.LOCAL_INFERENCE_RUNTIME?.trim() || "local-openai-compatible";
  const node = process.env.LOCAL_INFERENCE_NODE?.trim() || "local-sovereign-node";
  const prompt =
    process.env.LOCAL_INFERENCE_PROMPT?.trim() ||
    "Return exactly: sovereign local inference complete";
  const count = runCount();

  const capability: InferenceCapability = {
    capability_id: "runtime-benchmark-chat",
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

  const adapter = createLocalOpenAIAdapter({
    base_url: baseUrl,
    model,
    runtime,
    timeout_ms: 120_000,
  });

  const runs: Array<{
    run: number;
    elapsed_ms: number;
    round_trip: Awaited<ReturnType<typeof runSovereignInferenceRoundTrip>>;
  }> = [];

  for (let index = 0; index < count; index += 1) {
    const request: SovereignInferenceRequest = {
      request_id: `runtime-benchmark-${Date.now()}-${index + 1}`,
      work_ref: "work:openai-runtime-benchmark-v0.1",
      intent: "compare a loopback OpenAI-compatible runtime without changing AVOT boundaries",
      input: prompt,
      required_capabilities: ["chat"],
      privacy_boundary: "local_only",
      authority_posture: "analysis_only",
      evidence_required: true,
    };

    const started = performance.now();
    const roundTrip = await runSovereignInferenceRoundTrip(
      request,
      [capability],
      [adapter],
    );
    const elapsedMs = performance.now() - started;

    runs.push({
      run: index + 1,
      elapsed_ms: Number(elapsedMs.toFixed(2)),
      round_trip: roundTrip,
    });
  }

  const durations = runs.map((entry) => entry.elapsed_ms);
  const result = {
    benchmark: "openai-runtime-benchmark-v0.1",
    runtime,
    model,
    node,
    privacy_boundary: "local_only",
    authority_posture: "analysis_only",
    evidence_required: true,
    run_count: count,
    latency_ms: {
      min: Math.min(...durations),
      median: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: Math.max(...durations),
    },
    runs,
  };

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  runOpenAIRuntimeBenchmark().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Runtime benchmark failed: ${message}\n`);
    process.exitCode = 1;
  });
}
