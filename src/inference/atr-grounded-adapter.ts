import { InferenceRuntimeAdapter, InferenceRuntimeContext } from "./adapter.js";
import { InferenceExecutionPlan, SovereignInferenceRequest, SovereignInferenceResult } from "./contracts.js";
import { MA_CORPUS_0001, ATRPassageRecord } from "./atr-ma-corpus.js";
import { evidenceRef, retrieveATRPassages } from "./atr-retrieval.js";

export interface ATRGroundedAdapterOptions {
  delegate: InferenceRuntimeAdapter;
  corpus?: readonly ATRPassageRecord[];
  runtime?: string;
  max_passages?: number;
}

function lineageFromIntent(intent: string): string {
  const prefix = "atr.lineage_reconstruction:";
  if (!intent.startsWith(prefix)) throw new Error("ATR grounded adapter received a non-ATR intent.");
  return intent.slice(prefix.length);
}

function promptFor(request: SovereignInferenceRequest, records: readonly ATRPassageRecord[]): string {
  const lineageId = lineageFromIntent(request.intent);
  const evidence = records.map((record) => ({
    evidence_ref: evidenceRef(record),
    record_id: record.record_id,
    work: record.work,
    locator: record.locator,
    source_tier: record.source_tier,
    anchor_text: record.anchor_text,
    paraphrase: record.paraphrase,
    concepts: record.concepts,
    reasoning_edges: record.reasoning_edges,
    inference_ceiling: record.default_inference_ceiling,
    temporal_boundary: record.temporal_boundary,
    uncertainty: record.uncertainty,
    contradiction_links: record.contradiction_links,
  }));

  return [
    "You are executing a bounded AVOT Trace Reconstruction inference.",
    `Lineage: ${lineageId} (reconstructed intellectual lineage; never claim to be the historical person).`,
    "Use only the supplied corpus evidence for lineage claims.",
    "Modern or historically unavailable subject matter must be class D.",
    "If evidence is insufficient or irreconcilable, return class E and confidence 'insufficient'.",
    "Do not invent citations. evidence_refs must be selected only from supplied evidence_ref values.",
    "Return JSON only with exactly these fields:",
    '{"lineage_id":"...","response_text":"...","inference_classes":["A"],"temporal_boundary":"...","confidence":"high|moderate|low|insufficient","evidence_refs":["..."]}',
    "",
    "CANONICAL USER TRANSCRIPT:",
    request.input,
    "",
    "RETRIEVED CORPUS EVIDENCE:",
    JSON.stringify(evidence, null, 2),
  ].join("\n");
}

function delegatedPlan(plan: InferenceExecutionPlan, delegateRuntime: string): InferenceExecutionPlan {
  return {
    ...plan,
    target_runtime: delegateRuntime,
    route_reason: `${plan.route_reason} ATR grounded adapter delegated execution to ${delegateRuntime} after deterministic corpus retrieval.`,
  };
}

export function createMarcusAureliusATRAdapter(
  options: ATRGroundedAdapterOptions,
): InferenceRuntimeAdapter {
  const runtime = options.runtime ?? "atr-ma-001-grounded";
  const corpus = options.corpus ?? MA_CORPUS_0001;
  const limit = options.max_passages ?? 4;

  return {
    runtime,
    execute: async ({ request, plan }: InferenceRuntimeContext): Promise<SovereignInferenceResult> => {
      const lineageId = lineageFromIntent(request.intent);
      if (lineageId !== "MA-001") throw new Error(`Marcus adapter cannot execute lineage '${lineageId}'.`);
      if (request.authority_posture !== "analysis_only") throw new Error("ATR Marcus adapter requires analysis_only authority.");
      if (!request.evidence_required) throw new Error("ATR Marcus adapter requires evidence_required=true.");

      const hits = retrieveATRPassages(request.input, corpus, limit);
      const records = hits.map((hit) => hit.record);
      const corpusEvidence = records.map(evidenceRef);

      const groundedRequest: SovereignInferenceRequest = {
        ...request,
        input: promptFor(request, records),
        context_refs: [...new Set([...(request.context_refs ?? []), ...corpusEvidence])],
      };

      const result = await options.delegate.execute({
        request: groundedRequest,
        plan: delegatedPlan(plan, options.delegate.runtime),
      });

      return {
        ...result,
        request_id: request.request_id,
        runtime_used: result.runtime_used ?? options.delegate.runtime,
        provenance_refs: [
          ...new Set([
            ...result.provenance_refs,
            "lineage:MA-001",
            "corpus:MA-CORPUS-0001",
            `retrieval:deterministic-term-v1:${records.map((record) => record.record_id).join(",")}`,
          ]),
        ],
        evidence_refs: [...new Set([...result.evidence_refs, ...corpusEvidence])],
      };
    },
  };
}
