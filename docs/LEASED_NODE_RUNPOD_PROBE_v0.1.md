# Leased Sovereign Node Probe v0.1 — Runpod reference path

Status: experimental operator guide for PR #6. This is a provider-specific reference path beneath the provider-neutral `REAL_MODEL_PROBE_RUNBOOK_v0.1.md`. It does not make Runpod a CIT dependency and does not redefine `local_only`.

## Purpose

Provide the shortest practical path from an iPhone-administered environment to the first real sovereign inference proof when no owned GPU workstation is available.

The leased machine is **sovereign-controlled but provider-dependent compute**. For this proof, sovereignty is expressed through replaceability, explicit contracts, loopback-only inference transport, evidence return, and refusal to let the provider become the identity, authority, or memory boundary.

## Reference configuration

- provider: Runpod Pod
- GPU class: 24 GB NVIDIA GPU as the minimum practical target for the reference model
- first-choice economical class: RTX A5000 24 GB when available
- reference model: `Qwen/Qwen3-8B`
- reference runtime: vLLM OpenAI-compatible server
- inference bind: `127.0.0.1:8000`
- AVOT-engine branch: `implementation/real-local-model-probe-v0.1`
- administration: Runpod Web Terminal or SSH from a trusted operator device

The reference model is intentionally modest. The first proof is about contract integrity and evidence return, not maximum model size.

## Important networking boundary

For PR #6, **do not expose vLLM port 8000 through the provider proxy**. The public Runpod deployment guides normally bind vLLM to `0.0.0.0` so external clients can reach it; that is deliberately not the topology under test here.

Use:

```text
operator terminal
   |
   | provider administration channel
   v
Runpod pod
   +-- AVOT-engine probe
   |      |
   |      | http://127.0.0.1:8000
   |      v
   +-- vLLM
          |
          v
      Qwen3-8B
```

The later CIT-to-remote-node path belongs to `trusted_federation`, not this `local_only` proof.

## Pod selection

Choose one GPU with at least 24 GB VRAM. A5000 is the preferred low-cost proof target when available; L4, 3090, or 4090 are valid substitutes. Do not increase GPU size merely to make the institutional proof feel more significant.

Persistent network storage is optional for the first run. Add it only if model re-download time becomes operationally material.

No public inference port is required.

## Runtime launch

Install or use a current vLLM environment, then start the server on loopback:

```bash
vllm serve Qwen/Qwen3-8B \
  --host 127.0.0.1 \
  --port 8000 \
  --served-model-name Qwen/Qwen3-8B \
  --generation-config vllm
```

`--generation-config vllm` avoids silently inheriting model-repository sampling defaults during this deterministic infrastructure proof.

Do not rely on vLLM's API-key flag as the security boundary for this experiment. Current vLLM documentation notes that not every server endpoint is covered by that authentication mechanism. The stronger boundary here is that the inference server is not publicly reachable at all.

## Runtime preflight

From the pod itself:

```bash
curl -s http://127.0.0.1:8000/v1/models
```

Then make one direct local completion:

```bash
curl -s http://127.0.0.1:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "Qwen/Qwen3-8B",
    "messages": [
      {"role": "user", "content": "Return exactly: sovereign local inference complete"}
    ],
    "stream": false
  }'
```

Stop if the response lacks either assistant content or a genuine completion `id`.

## Attach AVOT-engine

On the same pod:

```bash
git clone https://github.com/sovereign-codex/AVOT-engine.git
cd AVOT-engine
git checkout implementation/real-local-model-probe-v0.1

export LOCAL_INFERENCE_BASE_URL='http://127.0.0.1:8000'
export LOCAL_INFERENCE_MODEL='Qwen/Qwen3-8B'
export LOCAL_INFERENCE_RUNTIME='vllm'
export LOCAL_INFERENCE_NODE='leased-runpod-node-01'
export LOCAL_INFERENCE_PROMPT='Return exactly: sovereign local inference complete'

npm install
npm test
npm run probe:local | tee real-model-probe-output.json
```

If the runtime container does not already include Node.js/npm, install a supported Node.js runtime before executing the AVOT-engine steps. Do not alter AVOT-engine contracts merely to accommodate a provider image.

## Required evidence

The run is not complete when tokens appear. Preserve:

- provider-independent node label;
- GPU class and execution environment note;
- vLLM version;
- exact model identifier;
- request ID;
- genuine completion ID;
- model output;
- returned TRACE-compatible witness;
- returned Archivist envelope;
- timestamp;
- any failure, timeout, mismatch, or contract friction.

Do not preserve provider secrets, access tokens, SSH private keys, or unrelated environment variables in the evidence artifact.

## Success criterion

A successful result demonstrates only:

> One real model executed on a leased sovereign-controlled node through the existing `local_only`, `analysis_only`, evidence-required inference contract, with a reconstructable return path.

It does **not** demonstrate remote federation, physical hardware sovereignty, persistent service availability, multi-node continuity, or production readiness.

## Failure criterion

Any need to expose the inference server publicly, weaken loopback enforcement, synthesize a completion ID, broaden authority, skip evidence return, or bypass a failing contract means the proof has failed and the friction should be recorded.

## After the run

1. preserve sanitized output;
2. compare the actual return structure against the PR #6 promotion gate;
3. review any runtime/contract mismatch;
4. only then decide whether PR #6 has earned promotion;
5. topology-loss issue #7 remains downstream.

## External implementation references

This reference path follows current vLLM documentation for `vllm serve` and current Runpod guidance for pod-based vLLM deployment, except for one intentional divergence: Runpod's public-endpoint examples bind to `0.0.0.0`, while this proof binds only to `127.0.0.1` because `local_only` is the invariant being tested.
