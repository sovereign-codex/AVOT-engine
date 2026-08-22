# Sovereign Inference Contract v0.1

Status: experimental architecture contract  
Authority posture: analysis and implementation scaffold only; does not grant execution authority.

## Purpose

The Collaborative Intelligence Terminal binds to a stable inference contract rather than to any single model, runtime, accelerator, or hardware substrate.

This contract defines the minimum boundary between a CIT request and the intelligence fabric that may satisfy it.

## Architectural law

> The terminal owns the relationship; compute is a replaceable substrate.

An implementation may change model, runtime, hardware, routing strategy, sidecar, federation path, or cloud fallback without changing the CIT-facing contract, provided all authority, provenance, verification, and evidence obligations remain satisfied.

## Request envelope

```ts
export interface SovereignInferenceRequest {
  request_id: string;
  participant_id?: string;
  work_ref?: string | null;
  intent: string;
  input: string;
  context_refs?: string[];
  required_capabilities?: string[];
  prohibited_capabilities?: string[];
  privacy_boundary: "local_only" | "trusted_federation" | "cloud_allowed";
  authority_posture: "none" | "analysis_only" | "bounded_execute";
  max_cost_class?: "zero_marginal" | "local_preferred" | "metered_allowed";
  latency_class?: "interactive" | "standard" | "batch";
  evidence_required?: boolean;
}
```

## Execution plan

The router produces a plan before execution.

```ts
export interface InferenceExecutionPlan {
  request_id: string;
  target_capability: string;
  target_runtime: string;
  target_model?: string;
  target_node?: string;
  strategy:
    | "direct"
    | "speculative"
    | "moe"
    | "distributed"
    | "federated"
    | "cloud_fallback";
  sidecars?: SidecarBinding[];
  privacy_boundary: SovereignInferenceRequest["privacy_boundary"];
  authority_posture: SovereignInferenceRequest["authority_posture"];
  route_reason: string;
  fallback_plan?: string[];
}
```

## Sidecar binding

Sidecars assist but do not become authoritative by attachment alone.

```ts
export interface SidecarBinding {
  sidecar_id: string;
  capability: string;
  role:
    | "draft"
    | "retrieval"
    | "verification"
    | "tool_adapter"
    | "hardware_optimizer"
    | "specialist";
  authority_posture: "none" | "analysis_only";
  required: boolean;
}
```

A sidecar MAY accelerate, retrieve, classify, draft, specialize, or verify. A sidecar MUST NOT silently expand the authority of the primary request or replace the declared verification boundary.

## Result envelope

```ts
export interface SovereignInferenceResult {
  request_id: string;
  plan_ref?: string;
  status: "completed" | "refused" | "degraded" | "failed";
  output?: string;
  capability_used?: string;
  runtime_used?: string;
  model_used?: string;
  node_refs?: string[];
  sidecars_used?: string[];
  verification: {
    required: boolean;
    status: "not_required" | "pending" | "passed" | "failed";
    verifier_refs?: string[];
  };
  provenance_refs: string[];
  evidence_refs: string[];
  fallback_used?: boolean;
  authority_effect: "none" | "analysis_return" | "bounded_execution_return";
}
```

## Capability-aware routing criteria

A compliant router evaluates, at minimum:

1. required capability;
2. prohibited capability;
3. privacy boundary;
4. authority posture;
5. available memory and compute;
6. runtime and model compatibility;
7. node health and locality;
8. expected latency;
9. marginal cost class;
10. trust level of remote or federated nodes;
11. verification requirements;
12. evidence-return capability.

Routing MUST fail closed when no route satisfies a hard privacy, authority, or capability constraint.

## Authority boundary

Inference selection is not authorization.

The router MAY select where cognition occurs. It MUST NOT independently grant broader institutional authority, mutate Canon, promote memory, or widen the Work boundary.

Existing Value Kernel, Work, authority, TRACE, Archivist, and promotion contracts remain controlling where applicable.

## AVOT interpretation

An AVOT is a bounded capability attached to the intelligence fabric. Its implementation form may be:

- a model;
- a prompt/runtime definition;
- a repository workflow;
- a toolchain;
- a memory domain;
- a simulation;
- a specialist sidecar;
- a federated service;
- or a composite of these.

AVOT identity is therefore not equivalent to model identity.

## Reference flow

```text
CIT request
  -> capability-aware router
  -> execution plan
  -> target intelligence
      + optional sidecars
  -> verifier / constraint checks
  -> tools or bounded action
  -> result envelope
  -> TRACE / evidence return
  -> Archivist / institutional memory path
```

## v0.1 non-goals

This contract does not yet define:

- a node discovery protocol;
- a federation handshake;
- cryptographic attestation;
- billing or intelligence allocation;
- scheduling across multiple simultaneous users;
- model-specific speculative decoding APIs;
- transport protocol details.

Those should be layered beneath or beside this contract without changing the CIT-facing relationship unless a real implementation test proves the contract insufficient.

## First implementation test

Implement one deterministic adapter that accepts a `SovereignInferenceRequest`, selects between at least two declared local capabilities, emits an `InferenceExecutionPlan`, and returns a `SovereignInferenceResult` with provenance and evidence fields populated.

No autonomous shared-state mutation is required for the first test.
