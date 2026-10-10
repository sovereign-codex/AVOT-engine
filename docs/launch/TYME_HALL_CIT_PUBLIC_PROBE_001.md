# Launch 001 public-source CIT probe — review specification

**Classification:** additive non-production runner and synthetic tests; not a commissioned live model result, not Hall integration, not Office/Canon admission. Tracks [AVOT-engine #16](https://github.com/sovereign-codex/AVOT-engine/issues/16), [Control Center launch #15](https://github.com/sovereign-codex/Codex-control-center/issues/15), [Notion launch command](https://app.notion.com/p/3f5c51d54b758197a92ff59d2c203045).

## What is implemented

Uses existing `createLocalOpenAIAdapter` + `runSovereignInferenceRoundTrip`, not a second transport or Hall backend. Only loopback OpenAI-compatible endpoints allowed. Source is the **exact pinned byte-for-byte** public `AGI-0001/publication.json` in Hall revision `5342cbaf1098391879a15c7ccca752d3fbc241b8`, Git blob SHA `af95bf125c109e85736a8fcd28e0fc3bb4d79c12`. Parse and check normative/publication/non-self-authorizing fields before calling the model.

Builds a bounded `KNOW` source-only question, includes the minimal approved record fields, and asks the receiving local model for strict JSON `CIT-RETURN v0.1`. The verified existing adapter must return a completion ID; no private participant or institutional source is sent.

A return is structurally checked for claimed standing, automatic authority, Hall receipt, source allowlist, model identity and distinct submission action. **Any substantive factual grounding still requires independent inspection of the model's raw summary and approved source.** Therefore `grounding_review=PENDING_INDEPENDENT_REVIEW`, `live_deployment_verified=false`, `release_gate_G2=OPEN` always remain true regardless of parser success.

## Local synthetic fixtures

```bash
npm install
npm test
```

Tests include exact-blob source accept/reject, no-authority requests, forbidden self-granted standing/receipt, source allowlist, malformed output, existing adapter completion ID, rejecting external host, and a synthetic OpenAI-compatible loopback server. **A green mock test is not proof of real inference.**

## Running an actual local inference host — separately authorized

From the repository root with a previously verified, authorized loopback OpenAI-compatible model endpoint:

```bash
npm install
npm run build
export CIT_PUBLIC_SOURCE_PATH=inputs/cit-probe/AGI-0001.publication.json
export LOCAL_INFERENCE_BASE_URL=http://127.0.0.1:8000
export LOCAL_INFERENCE_MODEL=your-verified-model-id
export CIT_PROBE_EXECUTION_KIND=operator_declared_live_model
node dist/inference/public-knowledge-cit-probe.js
```

No public internet source fetch or API key is involved in this CLI. Do not paste model credentials or server secrets into the terminal command, README, issues or logs. A nonlocal host fails closed. `operator_declared_live_model` is an operator claim **only**, not an independent attestation; record the model-server run/exit, actual timestamp, request/response digest, and reviewer identity elsewhere. If model execution fails or output is malformed, preserve that failure rather than rewriting it.

## Promotion gates

1. Immutable source fixture verified against Hall Git commit and exact source SHA; no private Office content.
2. Tests green on PR exact SHA in CI and independent checkout; review no authority widening.
3. Separately run against a **real** bounded local/loopback model, capture redacted raw response, actual runtime/server proof, latency/cost limits, and refusal/injection cases.
4. Independent reviewer checks source-grounded semantics and that every `CIT-RETURN` field is honest; do not self-promote based on positive prose.
5. Only then consider a separately authorized staging Hall -> CIT backend integration, Cloudflare binding and public route smoke. This PR neither provides nor authorizes those operations.

## Explicit constraints

- `work_ref=null`; `privacy_boundary=local_only`; `authority_posture=none`; `authority_effect=none`.
- No identity store, native Hall receipt, Notion write, external remote transport, Cloudflare deployment, automation wake, Canon promotion, production expense or payout.
- Failed, refused, malformed or model-unavailable output is not a live proof. Existing adapter transports may throw; preserve exit/error faithfully.
