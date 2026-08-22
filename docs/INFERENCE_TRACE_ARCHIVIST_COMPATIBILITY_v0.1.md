# Inference × TRACE × Archivist Compatibility v0.1

## Status

Experimental compatibility note for `architecture/sovereign-inference-contract-v0.1`.

This document does not modify TRACE, Archivist, Canon, or autonomous authority.

## Finding

The Sovereign Inference Result is compatible in principle with the current AVOT-TRACE and AVOT-ARCHIVIST boundaries, but the existing TRACE schema is too narrow to preserve the full inference evidence envelope without an adapter.

## Current TRACE contract

Current `AVOT-TRACE/schemas/trace.schema.json` requires only:

- `trace_id`
- `repo`
- `workflow`
- `status`
- `timestamp`

Therefore inference results SHOULD NOT be written directly as TRACE records.

A translation layer should emit the current TRACE-required fields while preserving richer inference evidence as referenced payloads.

## Current Archivist constitutional contract

The Archivist repository contains the canonical AVOT behavioral interface. Relevant requirements include:

- identity awareness;
- lifecycle/state awareness;
- action classification;
- permission evaluation;
- first-class refusal;
- structured non-binding signal emission;
- no self-granted authority.

The Sovereign Inference Contract is consistent with these rules because routing and runtime selection do not grant authority, and execution is bounded by the request authority posture.

## Recommended return mapping

```text
SovereignInferenceResult
        |
        +--> Archivist evidence payload
        |      request_id
        |      plan_ref
        |      capability_used
        |      runtime_used
        |      model_used
        |      node_refs
        |      sidecars_used
        |      verification
        |      provenance_refs
        |      evidence_refs
        |      authority_effect
        |
        +--> TRACE compatibility record
               trace_id      <- inference request/result trace id
               repo          <- execution repository
               workflow      <- inference strategy/runtime path
               status        <- completed/refused/degraded/failed
               timestamp     <- return timestamp
               payload_ref   <- optional future extension / external evidence ref
```

## Compatibility law

TRACE remains the neutral witness.

Archivist preserves the evidence-bearing payload.

The inference runtime must not ask TRACE to interpret meaning and must not ask Archivist to grant authority.

## Promotion gate

Before promotion to Main:

1. CI must pass on the current branch head.
2. The result-to-TRACE mapping must remain additive and non-breaking.
3. Rich inference evidence must remain available to Archivist or another evidence store by reference.
4. No inference adapter may elevate `authority_posture`.
5. Required verification and evidence checks must continue to fail closed.

## Current recommendation

Proceed to promotion review as an experimental capability boundary, not yet as a Canon-wide runtime requirement.
