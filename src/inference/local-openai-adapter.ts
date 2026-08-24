import {
  InferenceRuntimeAdapter,
  InferenceRuntimeContext,
} from "./adapter.js";
import { SovereignInferenceResult } from "./contracts.js";

export interface LocalOpenAIAdapterOptions {
  base_url: string;
  model: string;
  runtime?: string;
  timeout_ms?: number;
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function assertLocalEndpoint(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("Local inference base_url must be a valid URL.");
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]";

  if (!isLoopback) {
    throw new Error(
      `Local-only inference requires a loopback endpoint; received host '${parsed.hostname}'.`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Local inference endpoint must use http or https; received '${parsed.protocol}'.`,
    );
  }
}

export function createLocalOpenAIAdapter(
  options: LocalOpenAIAdapterOptions,
): InferenceRuntimeAdapter {
  assertLocalEndpoint(options.base_url);

  const runtime = options.runtime ?? "local-openai-compatible";
  const endpoint = `${normalizeBaseUrl(options.base_url)}/v1/chat/completions`;

  return {
    runtime,
    execute: async ({ request, plan }: InferenceRuntimeContext): Promise<SovereignInferenceResult> => {
      if (request.privacy_boundary !== "local_only") {
        throw new Error(
          `Local adapter accepts only local_only requests; received '${request.privacy_boundary}'.`,
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.timeout_ms ?? 30_000,
      );

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model: plan.target_model ?? options.model,
            messages: [
              {
                role: "user",
                content: request.input,
              },
            ],
            stream: false,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(
            `Local inference runtime returned HTTP ${response.status}.`,
          );
        }

        const payload = (await response.json()) as ChatCompletionResponse;
        const output = payload.choices?.[0]?.message?.content ?? undefined;

        if (!output) {
          throw new Error("Local inference runtime returned no assistant content.");
        }

        if (request.evidence_required && !payload.id) {
          throw new Error(
            "Local inference runtime returned no recoverable completion identifier for an evidence-required request.",
          );
        }

        const evidenceRefs = payload.id ? [`completion:${payload.id}`] : [];

        return {
          request_id: request.request_id,
          status: "completed",
          output,
          capability_used: plan.target_capability,
          runtime_used: runtime,
          model_used: payload.model ?? plan.target_model ?? options.model,
          node_refs: plan.target_node ? [plan.target_node] : [],
          verification: {
            required: false,
            status: "not_required",
          },
          provenance_refs: [
            `runtime:${runtime}`,
            `endpoint:${endpoint}`,
          ],
          evidence_refs: evidenceRefs,
          authority_effect:
            plan.authority_posture === "bounded_execute"
              ? "bounded_execution_return"
              : plan.authority_posture === "analysis_only"
                ? "analysis_return"
                : "none",
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
