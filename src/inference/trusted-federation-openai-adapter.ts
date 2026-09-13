import {
  InferenceRuntimeAdapter,
  InferenceRuntimeContext,
} from "./adapter.js";
import { SovereignInferenceResult } from "./contracts.js";

export interface TrustedFederationNode {
  node_ref: string;
  base_url: string;
  model: string;
}

export interface TrustedFederationOpenAIAdapterOptions {
  nodes: TrustedFederationNode[];
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

interface NodeHealth {
  node: TrustedFederationNode;
  reachable: boolean;
  reason?: string;
}

interface CompletionAttempt {
  node: TrustedFederationNode;
  payload?: ChatCompletionResponse;
  output?: string;
  failure_reason?: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function validateNode(node: TrustedFederationNode): void {
  if (!/^[A-Za-z0-9._-]+$/.test(node.node_ref)) {
    throw new Error(
      `Trusted federation node_ref '${node.node_ref}' must use only letters, digits, '.', '_', or '-'.`,
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(node.base_url);
  } catch {
    throw new Error(
      `Trusted federation node '${node.node_ref}' base_url must be a valid URL.`,
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `Trusted federation node '${node.node_ref}' must use http or https; received '${parsed.protocol}'.`,
    );
  }

  if (!node.model.trim()) {
    throw new Error(
      `Trusted federation node '${node.node_ref}' must declare a model identifier.`,
    );
  }
}

function validateOptions(options: TrustedFederationOpenAIAdapterOptions): void {
  if (options.nodes.length !== 2) {
    throw new Error(
      `Trusted federation topology-loss v0.1 requires exactly two configured nodes; received ${options.nodes.length}.`,
    );
  }

  options.nodes.forEach(validateNode);

  const refs = new Set(options.nodes.map((node) => node.node_ref));
  if (refs.size !== options.nodes.length) {
    throw new Error("Trusted federation node_ref values must be unique.");
  }
}

function failureReason(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "timeout";
  return "network_error";
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeNode(
  node: TrustedFederationNode,
  timeoutMs: number,
): Promise<NodeHealth> {
  const endpoint = `${normalizeBaseUrl(node.base_url)}/v1/models`;

  try {
    const response = await fetchWithTimeout(endpoint, { method: "GET" }, timeoutMs);
    await response.text();

    if (!response.ok) {
      return {
        node,
        reachable: false,
        reason: `http_${response.status}`,
      };
    }

    return { node, reachable: true };
  } catch (error: unknown) {
    return {
      node,
      reachable: false,
      reason: failureReason(error),
    };
  }
}

async function requestCompletion(
  node: TrustedFederationNode,
  request: InferenceRuntimeContext["request"],
  timeoutMs: number,
): Promise<CompletionAttempt> {
  const endpoint = `${normalizeBaseUrl(node.base_url)}/v1/chat/completions`;

  try {
    const response = await fetchWithTimeout(
      endpoint,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: node.model,
          messages: [
            {
              role: "user",
              content: request.input,
            },
          ],
          stream: false,
        }),
      },
      timeoutMs,
    );

    if (!response.ok) {
      await response.text();
      return {
        node,
        failure_reason: `http_${response.status}`,
      };
    }

    const payload = (await response.json()) as ChatCompletionResponse;
    const output = payload.choices?.[0]?.message?.content ?? undefined;

    if (!output) {
      return {
        node,
        failure_reason: "missing_assistant_content",
      };
    }

    if (request.evidence_required && !payload.id) {
      return {
        node,
        failure_reason: "missing_completion_id",
      };
    }

    return {
      node,
      payload,
      output,
    };
  } catch (error: unknown) {
    return {
      node,
      failure_reason: failureReason(error),
    };
  }
}

function authorityEffect(
  posture: InferenceRuntimeContext["plan"]["authority_posture"],
): SovereignInferenceResult["authority_effect"] {
  if (posture === "analysis_only") return "analysis_return";
  return "none";
}

export function createTrustedFederationOpenAIAdapter(
  options: TrustedFederationOpenAIAdapterOptions,
): InferenceRuntimeAdapter {
  validateOptions(options);

  const runtime = options.runtime ?? "trusted-federation-openai";
  const timeoutMs = options.timeout_ms ?? 30_000;

  return {
    runtime,
    execute: async ({ request, plan }: InferenceRuntimeContext): Promise<SovereignInferenceResult> => {
      if (request.privacy_boundary !== "trusted_federation") {
        throw new Error(
          `Trusted federation adapter accepts only trusted_federation requests; received '${request.privacy_boundary}'.`,
        );
      }

      if (plan.authority_posture === "bounded_execute") {
        throw new Error(
          "Trusted federation topology-loss v0.1 does not permit bounded_execute authority.",
        );
      }

      const health = await Promise.all(
        options.nodes.map((node) => probeNode(node, timeoutMs)),
      );

      const topologyEvidence = health.map((entry) =>
        entry.reachable
          ? `topology:${entry.node.node_ref}:reachable`
          : `topology:${entry.node.node_ref}:unreachable:${entry.reason ?? "unknown"}`,
      );

      const healthyNodes = health
        .filter((entry) => entry.reachable)
        .map((entry) => entry.node);

      const routeEvidence: string[] = [];

      for (const node of healthyNodes) {
        const attempt = await requestCompletion(node, request, timeoutMs);

        if (!attempt.output || !attempt.payload) {
          routeEvidence.push(
            `route:${node.node_ref}:failed:${attempt.failure_reason ?? "unknown"}`,
          );
          continue;
        }

        const completionEvidence = attempt.payload.id
          ? [`completion:${attempt.payload.id}`]
          : [];
        const configuredIndex = options.nodes.findIndex(
          (candidate) => candidate.node_ref === node.node_ref,
        );
        const degradedTopology = health.some((entry) => !entry.reachable);
        const fallbackUsed = configuredIndex > 0 || routeEvidence.length > 0;

        return {
          request_id: request.request_id,
          status: degradedTopology || fallbackUsed ? "degraded" : "completed",
          output: attempt.output,
          capability_used: plan.target_capability,
          runtime_used: runtime,
          model_used: attempt.payload.model ?? node.model,
          node_refs: [node.node_ref],
          verification: {
            required: false,
            status: "not_required",
          },
          provenance_refs: [
            `runtime:${runtime}`,
            `federation:selected:${node.node_ref}`,
            `federation:configured:${options.nodes.map((candidate) => candidate.node_ref).join(",")}`,
          ],
          evidence_refs: [
            ...topologyEvidence,
            ...routeEvidence,
            `route:selected:${node.node_ref}`,
            ...completionEvidence,
          ],
          fallback_used: fallbackUsed,
          authority_effect: authorityEffect(plan.authority_posture),
        };
      }

      return {
        request_id: request.request_id,
        status: "failed",
        capability_used: plan.target_capability,
        runtime_used: runtime,
        node_refs: health.map((entry) => entry.node.node_ref),
        verification: {
          required: false,
          status: "not_required",
        },
        provenance_refs: [
          `runtime:${runtime}`,
          `federation:configured:${options.nodes.map((candidate) => candidate.node_ref).join(",")}`,
        ],
        evidence_refs: [
          ...topologyEvidence,
          ...routeEvidence,
          "route:selected:none",
        ],
        fallback_used: routeEvidence.length > 0,
        authority_effect: authorityEffect(plan.authority_posture),
      };
    },
  };
}
