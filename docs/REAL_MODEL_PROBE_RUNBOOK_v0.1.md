# Real Model Probe Runbook v0.1

Status: experimental execution guide for PR #6. This document does not promote the probe, authorize production deployment, or redefine `local_only`.

## Purpose

Prove one actual model completion through the Main-backed Sovereign Inference Contract while preserving the existing privacy, authority, and evidence boundaries.

The operator may use physically owned hardware or a leased sovereign-controlled node. The important invariant for this probe is narrower: **the AVOT-engine process and inference runtime communicate only through loopback on the same execution node.** A leased provider remains an infrastructure dependency and should not be described as physically sovereign hardware.

An iPhone may remain only the administration terminal. The probe itself must execute on the node that hosts the model runtime.

## Required state

- checkout: `implementation/real-local-model-probe-v0.1`
- Node.js / npm sufficient to build AVOT-engine
- one OpenAI-compatible chat-completions runtime on the same node
- runtime bound to `localhost`, `127.0.0.1`, or loopback IPv6
- a model capable of returning ordinary assistant text
- the runtime must return a genuine OpenAI-style completion `id`

The adapter intentionally rejects a non-loopback host and an evidence-required response without a completion identifier.

## Boundary under test

```text
operator / CIT-side terminal
        |
        | administers node
        v
sovereign-controlled execution node
        |
        +-- AVOT-engine probe
        |       |
        |       | local_only
        |       v
        +-- loopback OpenAI-compatible runtime
                |
                v
              model
```

This probe does **not** test remote CIT-to-node transport. That belongs to the separate `trusted_federation` experiment.

## Environment contract

```bash
export LOCAL_INFERENCE_BASE_URL="http://127.0.0.1:<port>"
export LOCAL_INFERENCE_MODEL="<runtime model identifier>"

# optional
export LOCAL_INFERENCE_RUNTIME="<runtime name>"
export LOCAL_INFERENCE_NODE="<stable node label>"
export LOCAL_INFERENCE_PROMPT="Return exactly: sovereign local inference complete"
```

Do not place provider credentials, API keys, or secret tokens in the repository.

## Preflight

Before invoking AVOT-engine, verify from the execution node that:

1. the inference service is listening only on an intended local interface;
2. `POST /v1/chat/completions` succeeds locally;
3. the response contains assistant content;
4. the response contains a genuine completion `id`;
5. the selected model identifier matches the runtime configuration.

If any item fails, stop. Do not weaken the adapter to make the probe pass.

## Execute

```bash
npm install
npm test
npm run probe:local
```

Expected behavior:

- the request declares `privacy_boundary = local_only`;
- the request declares `authority_posture = analysis_only`;
- routing selects the declared local capability;
- the local adapter calls the loopback OpenAI-compatible endpoint;
- the runtime returns real model output plus a completion identifier;
- AVOT-engine returns the normal round-trip structure with the translated return path.

## Minimum evidence to preserve

Preserve the probe output without secrets and record at minimum:

```yaml
probe: real-local-model-probe-v0.1
node_ref: ""
runtime: ""
model: ""
request_id: ""
completion_id: ""
privacy_boundary: local_only
authority_posture: analysis_only
inference_status: ""
trace_ref: ""
archivist_ref: ""
observed_at: ""
operator_note: ""
```

The completion identifier is runtime evidence, not institutional truth by itself. The returned TRACE-compatible witness and Archivist envelope are the intended institutional bridge.

## Failure is evidence

Record rather than hide:

- runtime unavailable;
- loopback rejection;
- HTTP error;
- missing assistant content;
- missing genuine completion ID;
- model mismatch;
- timeout;
- malformed return path;
- TRACE / Archivist incompatibility.

A failed real-runtime attempt is more useful than a synthetic success if it reveals an incorrect contract assumption.

## Promotion gate

PR #6 remains unpromoted until all of the following are true:

1. build/tests pass on the current head;
2. an actual model runtime completes the probe;
3. a genuine completion identifier is returned;
4. the return path contains reconstructable TRACE + Archivist evidence;
5. no privacy, authority, or evidence invariant is weakened to obtain success;
6. review finds no unresolved material regression.

Mergeability is not promotion evidence.

## Next experiment after promotion review

Only after the single-node proof should the architecture widen to the separate topology experiment tracked in issue #7:

```text
single-node real inference
-> trusted_federation transport
-> two-node logical capability
-> deliberate topology loss
-> evidence-bearing recovery / fail-closed behavior
```

The purpose of this sequencing is to learn whether federation adds a new capability without allowing the distributed runtime to inherit CIT identity, authority, semantic continuity, or institutional memory.
