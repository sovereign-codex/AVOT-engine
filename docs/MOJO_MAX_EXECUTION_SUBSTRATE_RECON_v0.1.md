# Mojo / MAX Execution Substrate Reconnaissance v0.1

Status: experimental, non-canonical research artifact  
Observed: 2026-10-04  
Branch: `research/mojo-execution-substrate`

## Purpose

Evaluate Modular's newly open-sourced Mojo compiler/toolchain and the MAX inference stack against the existing AVOT / Tyme trajectory without promoting either into canonical architecture.

This reconnaissance is intentionally narrow. It asks whether Mojo or MAX can improve execution while preserving the current authority, privacy, evidence, and provider-replaceability boundaries.

## Current local architecture established by this repository

The existing AVOT real-model probe already defines the useful boundary:

```text
operator / CIT-side terminal
        |
        | administers node
        v
sovereign-controlled execution node
        |
        +-- AVOT-engine
        |       |
        |       | local_only
        |       v
        +-- loopback OpenAI-compatible runtime
                |
                v
              model
```

The current adapter rejects non-loopback hosts for `local_only`, requires ordinary assistant content, and requires a genuine completion identifier when evidence is required.

That means a candidate inference runtime does not need to become an AVOT identity, memory, authority, or governance layer. It only needs to satisfy the runtime contract.

## Upstream observations

At the upstream `modular/modular` repository observed on 2026-10-04:

- Mojo compiler + toolchain source is available in the repository.
- Mojo provides Python interoperability in both directions, including importing Mojo modules from Python.
- MAX includes a Python inference server with an OpenAI-compatible endpoint.
- MAX includes Python model graphs and Mojo CPU/GPU kernels.
- `Qwen/Qwen3-8B` is listed as an example supported Qwen3 model architecture.
- MAX Serve defaults its host to `0.0.0.0`; a sovereignty probe must override this to loopback.
- The repository is Apache-2.0-with-LLVM-exceptions, while MAX usage/distribution is separately governed by the Modular Community License.

Relevant upstream paths:

- `README.md`
- `Mojo/docs/site/manual/python/mojo-from-python.mdx`
- `Mojo/include/Mojo/Compiler/KGENCompiler.h`
- `Mojo/lib/Compiler/ObjectCompiler/KGENToLLVMPipeline.h`
- `max/README.md`
- `max/python/max/serve/config.py`
- `max/python/max/pipelines/architectures/qwen3/arch.py`
- `AI_TOOL_POLICY.md`
- `Licenses/LICENSE`

## Compatibility matrix

| Surface | Existing boundary | Mojo / MAX fit | Gate |
| --- | --- | --- | --- |
| Tyme governance | Human authority, no silent automation, auditability | No direct dependency required. Execution should remain below governance. | KEEP SEPARATE |
| AVOT local inference | Loopback-only OpenAI-compatible endpoint, evidence-required completion ID | MAX is structurally compatible at the API boundary. Live behavior still must be proven. | GO TO LIVE PROBE |
| Provider replaceability | Runtime must not become identity, memory, or authority | MAX can be treated as one runtime candidate beside vLLM if the adapter remains unchanged. | GO |
| Qwen3-8B reference model | Existing RunPod probe uses `Qwen/Qwen3-8B` | Upstream MAX source lists `Qwen/Qwen3-8B` as a supported Qwen3 example. | GO TO LIVE PROBE |
| Mojo kernel offload | No established Python compute hotspot in current AVOT-engine | Mojo/Python interop exists, but manufacturing a synthetic hotspot would not prove architectural value. | HOLD |
| QIL execution layer | No concrete execution IR contract is established here | KGEN/MLIR/LLVM internals are relevant research material, but no QIL dependency is justified yet. | HOLD |
| Licensing | Sovereign deployment should remain inspectable and replaceable | Mojo/compiler source is permissively licensed; MAX has a separate community license that must be reviewed before dependency promotion. | REVIEW BEFORE PROMOTION |
| Mobile operation | iPhone may administer but does not host the GPU runtime | Compatible with existing leased-node pattern. | GO |

## Reconnaissance conclusion

The strongest immediate path is not a Mojo rewrite.

It is a **runtime substitution test**:

```text
same AVOT request
same authority posture
same local_only boundary
same evidence requirement
same Qwen3-8B model class
        |
        +-- vLLM
        |
        +-- MAX
```

If both runtimes satisfy the existing adapter without changing AVOT semantics, MAX earns consideration as a replaceable execution provider.

Mojo kernel work remains downstream until a real, measured computational hotspot exists. QIL/compiler integration remains further downstream until there is a concrete execution contract worth lowering.

## Gate A — MAX compatibility probe

### Invariant

Do not modify `src/inference/local-openai-adapter.ts` merely to make MAX pass.

### MAX launch boundary

MAX Serve currently defaults to `0.0.0.0`. For this probe, bind it to loopback explicitly:

```bash
export MAX_SERVE_HOST='127.0.0.1'
export MAX_SERVE_PORT='8000'
max serve --model Qwen/Qwen3-8B
```

Then attach AVOT-engine without changing its contract:

```bash
export LOCAL_INFERENCE_BASE_URL='http://127.0.0.1:8000'
export LOCAL_INFERENCE_MODEL='Qwen/Qwen3-8B'
export LOCAL_INFERENCE_RUNTIME='max'
export LOCAL_INFERENCE_NODE='leased-node-max-01'
export LOCAL_INFERENCE_PROMPT='Return exactly: sovereign local inference complete'

npm install
npm test
npm run probe:local
```

### Pass criteria

1. MAX remains loopback-only.
2. `POST /v1/chat/completions` succeeds through the existing adapter.
3. Assistant content is present.
4. A genuine completion `id` is present.
5. TRACE / Archivist return structure remains reconstructable.
6. No authority, privacy, or evidence invariant is weakened.
7. Runtime identity is recorded as `max`, not promoted into institutional identity.

### Fail criteria

Record failure if any of these are required:

- expose MAX publicly;
- disable the AVOT loopback assertion;
- synthesize completion evidence;
- weaken `local_only`;
- broaden authority;
- special-case MAX in the governance layer;
- treat a successful completion as architectural promotion.

## Gate B — comparative runtime benchmark

This branch adds `src/inference/openai-runtime-benchmark.ts`.

The benchmark deliberately reuses the same local adapter and Sovereign Inference round trip. It can therefore compare MAX and vLLM without creating a second inference contract.

Example:

```bash
export LOCAL_INFERENCE_BASE_URL='http://127.0.0.1:8000'
export LOCAL_INFERENCE_MODEL='Qwen/Qwen3-8B'
export LOCAL_INFERENCE_RUNTIME='max'
export LOCAL_INFERENCE_NODE='leased-node-max-01'
export BENCHMARK_RUNS='5'

npm run probe:benchmark | tee max-benchmark.json
```

Repeat against vLLM on a comparable node and model configuration.

Do not interpret latency alone as promotion evidence. Compare at minimum:

- contract pass/fail;
- completion-ID evidence;
- model-output integrity;
- median and p95 round-trip latency;
- runtime setup friction;
- GPU memory footprint if observable;
- cold-start / compile behavior;
- operational replaceability;
- license implications.

## Gate C — Mojo kernel experiment

Status: HOLD.

There is currently no evidenced Python compute hotspot in AVOT-engine that merits extraction into Mojo. A synthetic vector benchmark would establish only that Mojo can execute quickly, not that it improves Sovereign Intelligence architecture.

Open this gate only when profiling identifies a real hotspot in one of:

- signal / resonance transforms;
- simulation kernels;
- scoring or vector math;
- scientific-model preprocessing;
- local inference pre/post-processing.

Then require a before/after benchmark with identical inputs and a clean Python-to-Mojo boundary.

## Gate D — QIL / compiler reconnaissance

Status: HOLD.

The open compiler makes this branch worth watching, especially KGEN -> LLVM lowering and MLIR-based passes. But QIL should not be invented around upstream compiler internals.

Open this gate only when QIL has a concrete execution contract with at least:

1. a typed operation;
2. deterministic inputs/outputs;
3. an explicit capability/authority boundary;
4. a target-independent representation;
5. a demonstrable need that ordinary Python/TypeScript/Rust/Mojo code does not already satisfy.

## Decision

**Proceed with MAX as a bounded runtime candidate.**  
**Do not promote Mojo, MAX, or KGEN into canonical architecture.**  
**Do not begin a Mojo rewrite.**  
**Defer kernel and compiler work until measured need exists.**

The shortest useful evidence sequence is:

```text
MAX loopback smoke test
-> AVOT real-model round trip
-> MAX vs vLLM benchmark
-> evidence review
-> go / hold decision
-> only then consider a real Mojo hotspot
```

## Promotion question

After the live probe, ask only:

> Did this substrate improve execution while leaving sovereignty, evidence, authority, and replaceability intact?

If the answer is not demonstrably yes, keep it experimental.
