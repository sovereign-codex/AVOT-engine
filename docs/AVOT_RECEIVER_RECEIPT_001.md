# AVOT receiver receipt 001

**Standing: disabled receiver implementation for draft review.** This change retains a complete, admitted Control Center handoff and produces an attributable repository receipt. It performs no requested computation. Every result keeps `execution.status: "unverified"` and `completion_claim: false`.

The implementation builds on AVOT-engine main [`dea4b3f0c05334f8abd33ac4c2abae76b094e6f4`](https://github.com/sovereign-codex/AVOT-engine/tree/dea4b3f0c05334f8abd33ac4c2abae76b094e6f4), against the Control Center contract in [draft PR #22](https://github.com/sovereign-codex/Codex-control-center/pull/22), pinned at `08e79156f540e3f869ad0dc2e6209f6e79f52164`. No Control Center files or other AVOT inference paths are changed.

## Problem and resulting behavior

The previous `avot_execution` workflow extracted only root trace/source/route fields, rebuilt a small input, slept, and wrote `completed`. It then emitted TRACE messages and a sparse `avot_result` callback. That workflow did not preserve the CCC four-field envelope or call the engine/inference implementation.

| Surface | Receiver behavior in this change |
|---|---|
| Ingress | Existing `repository_dispatch: avot_execution`, AVOT-engine main only. |
| Input | Complete Actions event read as bytes; the entire CCC payload is preserved. |
| Admission | Independent receiver policy, actual sender allowlist, runtime source fingerprint, and both persisted CCC claims. |
| Persistence | One create-only, content-bound receipt at a deterministic request path. |
| Repeated delivery | Verified existing receipt or identity collision; no overwrite. |
| Processing | Receipt/retention only; producer status remains a declaration. |
| Return surface | Repository receipt plus workflow evidence; the separate CCC completion listener is not used. |

The runtime modules use built-in Node APIs and have no package-install requirement. Production code does not import test fixtures.

## Wire contract and upstream verification

The exact incoming `client_payload` has four properties:

```json
{
  "target": "avot-engine-runner",
  "event": { "...": "complete normalized producer event" },
  "request_id": "caller-assigned-request-id",
  "_ccc_handoff": { "...": "complete ccc-handoff/1 metadata" }
}
```

The event's producer repository/workflow aliases, request declaration if present, required producer fields, and fixed destination must agree. The receiver preserves producer timestamps/status, payload, governance, runtime packet, unknown extensions, and `_ccc_handoff.wrapper_fields`. It does not replace them with receiver observations or promote a producer's `completed` claim into execution evidence.

Preparation validates both CCC identities and binding fingerprints, full event/wrapper content hash, metadata schema, and the separate receiver policy's expected CCC policy digest. A direct five-field legacy payload lacks this handoff and holds. Legacy producers can still travel through the reviewed CCC normalizer if they supply its explicit caller request ID and other required fields.

Before writing, the receiver reads these fixed paths in `sovereign-codex/Codex-control-center` on `main`:

```text
handoff-ledger/v1/router/<derived-router-key>/claim.json
handoff-ledger/v1/dispatcher/<derived-dispatcher-key>/claim.json
```

Each returned record must match its complete expected claim schema, identity, binding, observation and outbound request hash, with canonical bytes and the exact Git blob SHA. The receiver reconstructs the original `engine_handoff` by removing only the four Dispatcher-added metadata fields. It separately hashes the actual received `avot_execution` request, including its destination repository.

Neither upstream outcome is required: delivery can arrive before the caller records its HTTP response. Verified claims establish admitted content. They do not establish upstream computation or prove that a particular workflow instance made the dispatch.

### Three distinct observed principals

| Field | Meaning |
|---|---|
| `origin_sender_id` | GitHub sender observed when Router received the producer event. |
| `_ccc_handoff.dispatcher_sender_id` | GitHub sender observed by CCC Dispatcher on `engine_handoff`. |
| Receiver's outer `event.sender.id` | GitHub sender observed by AVOT on `avot_execution`. |

Only the third is checked against `allowed_dispatch_sender_ids`. The first two must match the persisted CCC chain under the separately pinned CCC policy. A shared App may make some IDs equal, but equality is not assumed. Sender admission never proves execution of the producer workflow named in the payload.

## Independent policy and runtime version

The checked-in `config/avot-receiver.json` is deliberately disabled:

```json
{
  "schema_version": "avot-receiver-policy/1",
  "enabled": false,
  "ledger_branch": "main",
  "allowed_dispatch_sender_ids": [],
  "upstream_policy_sha256": null,
  "receiver_source_sha256": null
}
```

The exact schema is enforced. Event fields and environment overrides cannot enable it. Missing or mismatched sender/source/policy pins hold before App-token creation. Enabled policies used in tests are synthetic fixtures, with no live admission authority.

`receiver_source_sha256` binds the exact bytes of the receiver workflow and its five production modules. `receiverSourceFingerprint` hashes canonical JSON containing a versioned, sorted list of those paths and their SHA-256 hashes. It rejects omissions, extras and duplicate paths. The CLI computes this list itself. It does not accept a supplied source fingerprint from the event or an override variable.

The policy is excluded from the runtime fingerprint so it can name a reviewed code identity without containing a hash of itself. The complete policy has its own digest in each receipt binding. The offline CI workflow, documentation, receipts and test fixtures do not run as receiver code and are excluded from this fingerprint.

The CLI also compares the actual checkout commit with `GITHUB_SHA` and `GITHUB_WORKFLOW_SHA`, and requires the exact receiver workflow ref on main. GitHub documents these [Actions context variables](https://docs.github.com/en/actions/reference/workflows-and-actions/variables). The observed commit is retained in the receipt. Main may advance when receipt files are committed while the six runtime files remain identical.

CCC's existing `receiver.verified_commit` remains a historical review pointer. This receiver enforces its own runtime source fingerprint; it does not claim that `repository_dispatch` selected the historical commit. A later policy-only activation commit can retain the exact reviewed runtime bytes. This separates code review identity from the current repository commit and avoids circular cross-repository commit pins.

## Receipt and duplicate identity

The receipt key is SHA-256 of canonical JSON:

```json
["avot-receiver-identity-v1", "<lowercase-source-repo>", "<source-workflow>", "<caller-request-id>"]
```

The fixed storage path is:

```text
receiver-receipts/v1/<derived-key>/receipt.json
```

Contract version belongs in the binding rather than a new identity namespace. When an identity already has a valid retained receipt, a fully admitted reuse with a different semantic binding is a collision. Malformed or unauthorized changes hold before persistence. Receiver run ID, attempt, observation time, exact Actions-file hash, and current repository commit remain observations outside the duplicate binding. A redelivery therefore retains the original verified receipt rather than overwriting it with a newer observation.

The receipt schema is `avot-receiver-receipt/1`:

| Field | Retained evidence |
|---|---|
| `identity`, `binding` | Caller identity; content/request hashes; CCC fingerprints; receiver sender, policy and runtime source identity. |
| `envelope` | Entire received four-field payload, including complete producer event and wrapper extensions. |
| `observation` | Receiver repository/ref, run/attempt, observation time, commit/workflow/checkout identities and runtime fingerprint. |
| `evidence` | Exact Actions-file hash, canonical parsed-payload hash, complete dispatch request hash, content and policy/source hashes. |
| `upstream_claims` | Both fixed CCC paths, exact claim blob identities and request hashes. |
| `receipt` | Retention state, deterministic repository path and expected workflow artifact location. |
| `provenance`, `execution` | Admitted principal and claim checks; producer/upstream execution unverified; no completion claim. |

The receipt's own blob and returned commit identities appear in the execution result's `persistence` object, outside the receipt, avoiding self-referential hashes. The receipt's `blob/main` URL is a review location, not an immutable permalink. The result's returned commit SHA can anchor a subsequent readback.

### Evidence boundaries

The Actions-file hash covers exactly the bytes read from `GITHUB_EVENT_PATH`. GitHub has already parsed the producer's API request, so this is not a claim about original producer wire bytes. The complete parsed envelope is retained in the repository receipt. Exact Actions bytes are kept separately as `actions-event.json` in workflow evidence.

The receipt names the expected artifact `avot-receiver-<run-id>-<attempt>` and its Actions run URL. It explicitly marks artifact upload as unverified: the receipt cannot prove that a later upload step succeeded or that an artifact remains available after its 30-day retention period.

## Persistence and failure behavior

One receipt write is sufficient because no computation or downstream dispatch follows it. The adapter uses the [GitHub Contents API](https://docs.github.com/en/rest/repos/contents), fixed repositories/paths and `main`. Every write omits the overwrite `sha`. Only HTTP 201 with the exact expected receipt blob SHA establishes a newly recorded receipt.

| Situation | Disposition and effect |
|---|---|
| Invalid, disabled, unauthorized or unpinned preparation | Hold; no service access and no remote record. |
| Missing, altered, malformed or unverifiable upstream claim | Hold; no receipt write. |
| Verified new receipt | `receipt_recorded`; execution stays unverified. |
| Any other create response or exception | One readback; no second mutation. |
| Fully validated existing receipt with identical identity/binding | `duplicate`; return original receipt and observation. |
| Valid existing receipt with a different binding | `identity_collision`; preserve original record. |
| Missing or malformed readback | `receipt_uncertain`; retention is not established. |

Existing-receipt validation reconstructs all expected fields from the stored complete envelope, observation, and recomputed semantic binding. It checks canonical equality and the exact blob SHA. A copied binding, altered event, invented claim reference or added completion assertion cannot qualify as a verified duplicate.

Because retention is the only effect, readback after an ambiguous write can establish a verified existing receipt. It cannot establish which invocation created it. There is no retry, overwrite, expiry, reclaim, model call, TRACE emission or `avot_result` callback.

Durability depends on repository writers preserving receipts and CCC claims. This client's create-only behavior and Git object identity do not establish immutable institutional custody, actual GitHub atomicity under live concurrency, or exactly-once remote execution.

## Workflow and HTTP boundary

The receiver checks out the event commit without persisted credentials and runs Node 24. Preparation happens before requesting the App token. Execute freshly parses/prepares again; saved preparation JSON is not execution authority. In-process preparation objects are branded and deeply frozen.

The App token is restricted to CCC and explicitly requests Contents read permission. The built-in AVOT `GITHUB_TOKEN` provides receipt read/write access. The adapter has no dispatch method. It allows only fixed CCC claim GETs and AVOT receipt GET/PUTs, rejects redirects, bounds decoded records and response bodies, covers body consumption with a deadline, and sanitizes failures. Current App installation scope and live token capability have not been probed.

The only step output is `ready=true|false`. Event values never become shell source, filenames, environment-file assignments or commit messages. Fixed evidence files are written with restrictive local modes. The old global concurrency group is removed; request-specific create-only persistence handles duplicates without relying on workflow queue replacement behavior.

## Verification and completion criteria

The [recorded verification package](../review/avot-receiver-receipt-001/README.md) contains final test output, CLI checks, source identities and checksums. Tests use distinct synthetic senders and injected services. Three byte-exact CCC modules from PR #22 are vendored only under `tests/receiver/fixtures/ccc-v1`; their manifest verifies their pinned source identities. The interoperability test runs the actual Router and Dispatcher implementations, followed by the production receiver.

Reproduce on Node 24:

```sh
node --test --test-isolation=none --test-reporter=tap tests/receiver/*.test.mjs
```

The new `AVOT Receiver Contract` workflow runs these tests for matching pull requests and main pushes, with Contents read permission and no application secrets or dependency installation. Workflow setup uses GitHub checkout/Node actions; test transport and ledger behavior are injected locally. A configured CI workflow is separate from evidence that a particular remote run passed.

Before live receipt retention, a later reviewed change must establish actual sender admission, the expected CCC policy and receiver source fingerprints, current credential scope, live ledger behavior, and a bounded attributable receipt readback. Control Center's disabled policies remain unchanged by this PR. Consuming this receipt in a CCC return contract and enabling any actual inference are separate changes; the previous completion callback cannot substitute for them.
