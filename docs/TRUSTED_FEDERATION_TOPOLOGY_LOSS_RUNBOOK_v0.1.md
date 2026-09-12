# Trusted Federation Topology-Loss Runbook v0.1

Status: experimental execution guide for issue #7. This document begins only after the single-node real-model proof was promoted to `main`. It does not authorize production federation, autonomous authority, persistent distributed memory, or any weakening of `local_only`.

## Baseline inherited from the canonical single-node proof

The experiment begins from the proven single-node invariant set:

- AVOT-engine can execute a real model through an OpenAI-compatible runtime;
- the model runtime can remain bound to loopback;
- the operator device may be only an administration terminal;
- the executor runtime can outlive the SSH administration session;
- a genuine completion ID can be preserved as runtime evidence;
- TRACE-compatible and Archivist-compatible return evidence can be preserved without widening authority;
- `local_only` and `analysis_only` remain meaningful enforceable boundaries.

The canonical single-node custody record for the first specimen is identified by SHA-256:

`4101211f30eebad452b2415386b758698e316974a0764696fada8ab1129baa73`

This federation experiment must add a new capability without redefining that baseline.

## Question under test

Can one logical inference capability remain coherent when one participating execution node becomes unavailable, while preserving identity, authority, privacy-boundary semantics, and reconstructable evidence?

## Narrowest useful topology

Use exactly two independently addressable execution participants behind one logical capability.

```text
operator / CIT-side administration
            |
            v
logical capability: trusted-federation-chat
            |
            | privacy_boundary = trusted_federation
            | authority_posture = analysis_only
            v
trusted federation adapter / harness
          /   \
         /     \
        v       v
     node A   node B
        |       |
        v       v
OpenAI-compatible model runtimes
         \     /
          \   /
           v v
return envelope
     |
     +-> TRACE witness
     +-> Archivist envelope
```

No participant is allowed to become CIT identity, session identity, authority source, Canon source, or institutional memory.

## Node roles

### Node A — baseline executor

Use the already-proven execution pattern where practical:

- independently administered compute;
- OpenAI-compatible chat-completions runtime;
- stable node label;
- explicit model/runtime provenance;
- evidence-bearing returns.

The existing RunPod L4 path is valid as node A for the first federation experiment, but RunPod is not part of the logical contract.

### Node B — independent peer

Provision one separate execution participant with:

- a distinct node label;
- a separately reachable endpoint from the federation harness;
- the same minimum chat capability;
- independent process lifetime;
- enough observability to prove participation or non-participation.

Node B may use a different GPU, provider, runtime, or model if the semantic return contract remains compatible. Heterogeneity is useful, but not required for the first gate.

## Substrate choice

For v0.1, prefer the smallest provider-neutral federation harness that can route to two OpenAI-compatible endpoints and preserve route evidence.

Do not make SwarmLLM, RunPod, a specific model family, or a provider proxy part of the CIT-facing contract. SwarmLLM remains a candidate implementation only if it can expose enough route/topology evidence to satisfy this runbook.

The harness must be replaceable without changing the request semantics above it.

## Logical capability contract

The experiment should advertise one logical capability similar to:

```yaml
capability_id: trusted-federation-chat
capabilities:
  - chat
privacy_boundaries:
  - trusted_federation
strategies:
  - distributed
  - direct
trust_level: trusted
evidence_capable: true
authority_posture_ceiling: analysis_only
```

Selection is not authorization. The selected node or federation runtime must not widen `analysis_only`.

## Required experiment phases

### Phase 0 — preflight

Before generating any evidence-bearing completion:

1. confirm node A is reachable from the federation harness;
2. confirm node B is reachable from the federation harness;
3. confirm neither endpoint is accidentally represented as `local_only` when transport is remote;
4. confirm the request declares `privacy_boundary = trusted_federation`;
5. confirm the request declares `authority_posture = analysis_only`;
6. confirm each runtime can return assistant content and a genuine completion ID;
7. confirm participating-node and route evidence can be reconstructed.

If any item fails, stop and record the failure.

### Phase 1 — two-node baseline

Run one bounded request while both nodes are available.

Preserve at minimum:

- logical capability ID;
- request ID;
- selected or participating node set;
- route/topology evidence;
- runtime and model provenance;
- genuine completion ID;
- semantic return;
- TRACE reference;
- Archivist reference;
- authority and privacy-boundary posture.

Do not infer participation merely because both nodes are healthy. Record only what the harness or runtime can actually prove.

### Phase 2 — controlled topology loss

Make exactly one participant unavailable after the baseline is captured.

Preferred first action:

- leave the federation harness alive;
- leave node A unchanged;
- make node B unavailable in a controlled, reversible way.

Examples include stopping node B's inference process, removing node B from the private transport, or pausing the node. Do not corrupt model state merely to simulate failure.

### Phase 3 — follow-up request

Submit the same bounded semantic request through the same logical capability after topology loss.

Observe one of these outcomes without disguising it:

- `rerouted` — another eligible participant completes the request;
- `degraded` — the logical capability remains available with explicitly reduced capacity;
- `failed_closed` — the request is refused because evidence/trust requirements cannot be satisfied;
- `unavailable` — the logical capability cannot serve the request;
- `invalid_success` — tokens are returned but required topology/evidence/authority invariants are missing.

`invalid_success` is a failure.

### Phase 4 — recovery

Restore the removed participant and perform one final bounded request.

The recovery must not silently inherit stale identity, authority, or institutional memory from the failed topology.

## Evidence schema

Preserve one record per phase using at least:

```yaml
experiment_id: trusted-federation-topology-loss-v0.1
phase: baseline | topology_loss | recovery
logical_capability_id: trusted-federation-chat
request_id: ""
privacy_boundary: trusted_federation
authority_posture: analysis_only
runtime: ""
model: ""
participating_nodes_before: []
participating_nodes_after: []
selected_node: ""
route_or_topology_refs: []
completion_id: ""
failure_or_transition_observed: ""
recovery_behavior: ""
trace_ref: ""
archivist_ref: ""
semantic_continuity_preserved: false
authority_unchanged: false
privacy_boundary_unchanged: false
unresolved_risks: []
observed_at: ""
```

Hash sanitized evidence artifacts before promotion review.

## Fail-closed conditions

Stop and preserve the failure if any of the following occurs:

- a remote node is labeled or routed as `local_only`;
- a node or substrate claims CIT/session identity;
- topology loss broadens authority;
- a successful-looking response lacks reconstructable route evidence when evidence is required;
- a synthetic completion ID is introduced;
- the harness hides the loss of a participant;
- the experiment requires persistent distributed KV/cache state to be treated as institutional memory;
- recovery silently changes the semantic return contract;
- the federation substrate cannot be replaced without changing the CIT-facing contract.

## Promotion gate

The experiment is not promotable merely because both nodes can generate tokens.

Promotion review begins only when all of the following are true:

1. current-head build/tests pass;
2. a two-node baseline returns reconstructable evidence;
3. one controlled topology-loss event is observed;
4. the post-loss outcome is explicitly classified;
5. TRACE + Archivist evidence reconstruct both the baseline and changed topology;
6. `trusted_federation` remains distinct from `local_only`;
7. authority remains `analysis_only` throughout;
8. CIT/session identity is unchanged by node selection or failure;
9. runtime cache/KV state remains derived, disposable state rather than institutional memory;
10. recovery or fail-closed behavior is legible;
11. review finds no unresolved material regression.

## First execution target

The first execution should prove only this sequence:

```text
two reachable peers
-> one logical trusted_federation capability
-> baseline real completion
-> deliberate loss of one peer
-> second request
-> explicit reroute/degrade/fail-closed evidence
-> peer restoration
-> recovery request
-> hashed evidence bundle
```

Do not widen to general-purpose peer discovery, public participation, token economics, multi-agent coordination, or persistent distributed memory in v0.1.

## Relationship to issue #7

This runbook operationalizes issue #7 without changing its invariants. The single-node real-model proof remains canonical and is not superseded by federation. This branch exists to test whether topology can change without allowing infrastructure to become identity, authority, semantic continuity, or institutional memory.
