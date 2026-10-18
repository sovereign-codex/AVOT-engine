# CCC → AVOT receipt probe 001

**Standing: prepared and tested offline; no live probe has run.** This packet defines one synthetic request, its expected records, and a read-only verifier for evidence captured later. A successful probe establishes attributable transport and retention. Every record and report keeps execution `unverified` and `completion_claim: false`.

## Packet and current review chain

| File | Purpose |
|---|---|
| [route-event.json](route-event.json) | Exact proposed POST body; one fixed caller request ID and complete receipt-only payload. |
| [PROBE_PLAN.json](PROBE_PLAN.json) | Independently derived hashes, all five record paths, reviewed source identities, effect budget, and unresolved live inputs. |
| [readback-bundle.template.json](readback-bundle.template.json) | Incomplete evidence template with known request/paths/source pin and null live values. It must hold until real evidence is supplied. |
| [verify-readback.mjs](verify-readback.mjs) | Read-only offline comparison of three Actions files, two claims, two accepted outcomes, and the entire receipt. |
| [TEST_RESULTS.json](TEST_RESULTS.json), [tests.tap](tests.tap), [SHA256SUMS](SHA256SUMS) | Recorded verification and source identities for this review package. |

[CCC #21](https://github.com/sovereign-codex/Codex-control-center/pull/21) remains the frozen review candidate. [CCC #22](https://github.com/sovereign-codex/Codex-control-center/pull/22) supplies the disabled Router/Dispatcher integration and now adds its offline CI gate. [AVOT #18](https://github.com/sovereign-codex/AVOT-engine/pull/18) supplies the disabled receipt receiver and this packet. The new CCC check passed at `234ced28b823e56e72cc99878c600854e13631d1`: [run 39103298277](https://github.com/sovereign-codex/Codex-control-center/actions/runs/39103298277).

The reviewed runtime bytes remain the CCC implementation at `08e79156f540e3f869ad0dc2e6209f6e79f52164` and AVOT implementation at `92a39ec137429aafb8eab559731086647fc067e2`. The AVOT six-file runtime fingerprint remains:

```text
dfd180f83362a1095b60eaf742a023fea355976a4363c7a3cf2cf9fd98fbe058
```

The CI/readback additions do not change those runtime files or either policy. The AVOT CI path filter now includes this probe directory so future changes to the verifier or packet run the receiver tests. The original 44-test record remains frozen at the original AVOT commit; its full source checksum manifest describes that historical revision, including its earlier CI file. This package records the later CI filter and additional verifier tests separately.

The final local suite passed **64/64 tests** on Node v24.19.0 at 06:16:26 UTC on 2026-10-18: the existing 44 receiver tests plus 20 independent probe tests, with zero failures, skips, or cancellations. Four actual CLI cases cover a complete synthetic bundle, a missing file, duplicate outer JSON keys, and an oversized bundle. A separate invocation of the checked-in incomplete template returned `hold` / exit 1 as expected. All accepted test bundles are synthetic; no live GitHub capture is represented by these results. Reproduce from the repository root:

```sh
node --test --test-isolation=none --test-reporter=tap tests/receiver/*.test.mjs
```

## Fixed request and values known before dispatch

The request is `ccc-avot-receipt-probe-20261018-001`, declared by `sovereign-codex/Codex-control-center` / `handoff-receipt-probe-001`. That workflow name is a manual probe declaration, not proof that a producer workflow ran. The timestamp in the payload is fixed synthetic input, not a later runner observation.

The payload exercises nested Unicode content, arrays, booleans, nulls, governance, a runtime packet, an event extension, and a wrapper extension. Normalization preserves these and adds the contract's route/provenance aliases. It passes the actual pinned CCC normalizer with zero issues under a synthetic test policy.

| Derived value | SHA-256 |
|---|---|
| Canonical complete POST body | `bcbfd01e54b99c4676c49b99f8a75017a9d90183f300fe23cc39f6e78e3cf8eb` |
| Canonical observed source payload | `a0e307083d71272faea2978a936ebf384dc5ee758c8c847265dd94d4dea9fed7` |
| Complete normalized content | `28353ca150c2dbaf618cd09a4f5295e163231926ff85fac84b37780ed4eec0f8` |
| Router identity key | `b47c319cc7e069bf1a3a175a90def3251bb62d8d68cce71307600a1472836a40` |
| Dispatcher identity key | `60c4f9a6ed10c5fab4353bf922025df24667766305c279c4d62fafeaa7ede85e` |
| Receiver identity key | `12e8944d71b706b96f42e777784ddc01829cbdbe2df8d681a085a6fe8ced6a19` |

The plan gives all full paths: Router and Dispatcher each have `claim.json` and `outcome.json` beneath their hashed CCC ledger directory; AVOT has one `receipt.json` beneath its hashed receiver directory. Before a live request, read all five paths from current main and require absence. Existing state is a stop for this fresh-request probe. Preserve and investigate it; do not delete it or choose a new ID to bypass it.

Run IDs, exact Actions-file hashes, complete delivery-specific request hashes, record blobs, and readback commit SHAs are unknown until observed. Synthetic fixture values must never fill those live fields.

## Release and activation sequence

GitHub [repository dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch) runs the default-branch workflow at the event commit. A draft branch, payload `ref`, or historical review pointer does not select executable code.

1. Review and install AVOT #18 on main with its policy disabled. Install CCC #21, then verify or retarget #22 to main and refresh its diff/checks before installing the integration with its policy disabled. Merging #22 into its current #21 review-branch base does not deploy it. If a squash/rebase changes ancestry, inspect the resulting diff; preserve the original candidate's bytes.
2. Re-read all runtime files and both disabled policies at their actual main commits. Compare the files to `PROBE_PLAN.json`. Account for relevant legacy jobs that were already queued or running: new main files do not replace those jobs' selected source snapshots.
3. Establish the real sender mapping and current credential scope below. Keep the proposed live change confined to this one source declaration and the required principals. Current main snapshots showed `protected: false` and no visible rulesets in either repository; protection-detail reads returned 403 because this connection lacks administration visibility. None of those observations proves that a workflow token can write. The probe's attributable records supply that runtime evidence. If current rules block direct Contents writes, stop for a storage/permission review; do not widen permissions or bypass rules automatically.
4. Construct the final proposed **enabled** CCC policy P locally. Use the one approved producer tuple, the actual Router-to-Dispatcher sender, `receiver.compatible: true`, a pre-existing reviewed AVOT code commit such as `92a39ec137429aafb8eab559731086647fc067e2`, and the receiver review evidence URL. Hash canonical JSON of the entire P, including `enabled: true`, to obtain H. Do not hash pretty-printed file bytes in place of the canonical policy digest.
5. Construct the proposed enabled AVOT policy using its actual incoming sender, `upstream_policy_sha256: H`, and the six-file runtime fingerprint above. Record the complete two policies and their independent digests in the probe expectation packet before any dispatch.
6. Pre-stage the exact policy-only restorations to both reviewed disabled snapshots and establish that the operator can apply them promptly while preserving intervening ledger commits. After authorization for the concrete activation changes and defined probe, start the operator timer and activate AVOT first while CCC remains disabled. Verify it, then activate **exactly P** in CCC last. Record each repository's actual enable/disable commit and time. Keep runtime and policy content stable through the three stages. CCC's historical receiver review commit must not be replaced with the future AVOT activation commit: the latter contains the CCC policy hash and would recreate a circular pin.

Main may advance as policy and receipt commits are created while the receiver runtime fingerprint stays identical. The receiver retains the actual checkout commit and requires matching `GITHUB_SHA`, `GITHUB_WORKFLOW_SHA`, checkout SHA, and main workflow ref. CCC's claims do not retain code SHAs, so separately capture each CCC run's head/workflow revision and confirm its source. See GitHub's [Actions variable definitions](https://docs.github.com/en/actions/reference/workflows-and-actions/variables).

## Sender and credential roles

| Actual observed sender / operation | Required binding or capability |
|---|---|
| Producer → Router | `expected.sender_ids.router`; CCC producer tuple binds this numeric `sender.id` to the declared source repository/workflow. |
| Router → Dispatcher | `expected.sender_ids.dispatcher`; CCC `dispatcher_sender_ids`. Router's App token requests Contents write in CCC only. |
| Dispatcher → AVOT | `expected.sender_ids.receiver`; AVOT `allowed_dispatch_sender_ids`. Dispatcher's App token requests Contents write in AVOT only. |
| CCC ledger writes | CCC's own `GITHUB_TOKEN`, Contents write on main. |
| AVOT reads both CCC claims | AVOT's App token, Contents read in CCC only. |
| AVOT receipt write/read | AVOT's own `GITHUB_TOKEN`, Contents write on main. |

These are three separately admitted dispatch roles; their numeric IDs may coincide when they use the same App. A GitHub App ID, installation ID, PR author, artifact uploader, or fixture sender is not a substitute for the actual dispatch `sender.id`. Identical secret names across repositories do not establish identical credentials. Installation scope and the approved credential-to-sender mapping must be established without copying secret values into evidence.

A bounded historical lookup found `codex-net-orchestrator[bot]` / actor ID `273616379` in the latest relevant [Router run](https://github.com/sovereign-codex/Codex-control-center/actions/runs/31564892722) from August 12 and the latest [Dispatcher](https://github.com/sovereign-codex/Codex-control-center/actions/runs/25288854858) and [AVOT receiver](https://github.com/sovereign-codex/AVOT-engine/actions/runs/25288860454) runs from May 3, 2026. None retains an artifact. This identifies a historical candidate, not the current credential mapping or exact dispatch event captures. The plan records it separately, and all live sender fields remain unset.

## Bounded probe and shutdown

The proposed limit is **one initiating POST**, with a **15-minute operator window** starting immediately before the first AVOT activation and including both activations. The existing policy schema has no per-request quota, TTL, or automatic shutdown. That limit is an operator procedure, and other requests from an admitted principal could be admitted during the window. Use a controlled principal, the unique approved source declaration, and an accounted-for queue. The workflows' individual 10-minute job timeouts do not bound Actions queue delay.

For this request, the intended maximum application effects are one initiating `route-event`, one forwarded `engine_handoff`, one forwarded `avot_execution`, four CCC record creations, and one AVOT receipt creation. The normal workflow also requests at most three App tokens and uploads three evidence artifacts; token revocation and normal Actions operations are additional. The separate policy transition consists of at most two enable changes and two disabled-policy restorations, after the reviewed PRs have been installed. There is no model call, TRACE message, completion callback, receipt overwrite, or automatic retry.

Send the reviewed `route-event.json` body once to the fixed endpoint in the plan. Do not add a new dispatch workflow merely to run this probe. Observe the three existing workflows and their attempts. Router outcome creation can overlap Dispatcher claim creation on CCC main because downstream admission does not wait for the outcome. A write conflict or ambiguous response can leave the identity reserved; that is a stop, not permission to resend.

On a terminal success/failure or at 15 minutes, stop initiating work and disable CCC first, then AVOT, using policy-only changes. On the success path, allow the admitted three-stage chain to reach terminal results before disabling. On timeout/failure, disable immediately and inspect relevant queued/running jobs; policy changes affect future event snapshots and do not revoke an already-running checkout. Any needed cancellation is bounded to the identified probe runs and must be recorded. Late effects must be captured and reconciled. The window is therefore not a guarantee that all remote activity instantly ceases at the deadline.

Keep the historical enabled policy snapshots for readback verification after shutdown. Loading the newly disabled main policies would correctly make historical preparation hold.

## Capture and readback

Capture run/job metadata from GitHub and download the exact artifacts from the matching repository, run ID, and attempt. Check upload-step success, artifact identity/availability, workflow path, event type, and source revision. The receipt's expected artifact name is not upload proof. Preserve the downloaded ZIP identity and exact contained files. The GitHub connector's artifact-download operation can retrieve the ZIP; metadata lookup alone is insufficient.

| Bundle input | Capture source |
|---|---|
| `actions.router` | `control-center-router-<run>-<attempt>`: exact `observation-event.json` and `execute-observation.json`. |
| `actions.dispatcher` | `control-center-dispatcher-<run>-<attempt>`: exact `observation-event.json` and `execute-observation.json`. |
| `actions.receiver` | `avot-receiver-<run>-<attempt>`: exact `actions-event.json` and the observation in final `prepared.json`. |
| `records.router_claim`, `router_outcome`, `dispatcher_claim`, `dispatcher_outcome` | Exact Contents bytes from the plan's CCC paths at recorded commit SHAs. |
| `records.receiver_receipt` | Exact Contents bytes from the plan's AVOT path at a recorded commit SHA. |
| `expected` | The separately approved request, actual sender mapping, historical enabled policies, and their independent policy/source pins. |

Use the **execute** observations. Both CLIs prepare again before effects, so the earlier prepare timestamp differs and will fail full record equality. CCC `execute-observation.json` already uses the template's camel-case field names. Map AVOT's final prepared observation as follows:

| Prepared observation | Bundle observation |
|---|---|
| `run_id`, `run_attempt`, `observed_at` | `runId`, `runAttempt`, `observedAt` |
| `commit_sha`, `workflow_sha`, `checkout_sha` | `commitSha`, `workflowSha`, `checkoutSha` |
| `workflow_ref`, `receiver_source_sha256` | `workflowRef`, `receiverSourceSha256` |
| `repository`, `ref` | Same field names; `eventName` is `repository_dispatch`. |

Set each `bytes_base64` to canonical base64 of the exact downloaded bytes and `sha256` to their raw-byte hash. Remove API base64 line wrapping. Do not parse/reformat Actions files or repository records before encoding them. Each record must retain exactly canonical JSON plus one LF; its Git blob SHA must match the Contents API result. `commit_sha` means the commit used for that readback; use a returned creation commit where available, or resolve main to a concrete readback commit first. A readback commit is not automatically proof that this invocation created the file.

Fetch each file at its pinned commit and re-read current main to confirm the same blob is still present. Check the commit-to-path/blob relationship through GitHub independently. Compare CCC run head/workflow files and policy snapshots at their selected revisions; for AVOT compare all six runtime files at its executing commit. The verifier validates supplied values' consistency but cannot authenticate those retrievals.

Run from the AVOT repository root, using a completed evidence bundle saved outside the source tree:

```sh
node review/handoff-receipt-probe-001/verify-readback.mjs /absolute/path/readback-bundle.json
```

The command reads one local JSON file and writes a report to stdout. It does not read credentials, import an executor/service, call GitHub, or write any record. `offline_bundle_verified` exits 0; missing, incomplete, oversized, malformed, mismatched, or unaccepted evidence returns `hold` and exits 1. The bundle limit is 2 MB; each Actions file is limited to 256 KiB, with strict JSON and canonical record/base64 checks. The fixed synthetic request is well within these bounds.

This probe verifier deliberately requires both accepted CCC outcomes. The production receipt receiver requires only the two claims, because delivery can arrive before an upstream outcome is saved. A valid retained receipt can therefore exist while the stricter complete-probe check holds. While the expected runs are pending and the operator window remains open, repeat read-only collection as records appear; this never authorizes another POST.

## Acceptance and stop conditions

A complete successful probe needs all three expected workflow attempts to finish successfully, both CCC outcomes to bind their exact claims and record HTTP 204 acceptance, the complete AVOT receipt to match the expected request/policies/senders/source, a successful offline bundle verification, independent GitHub run/artifact/commit evidence, unchanged current-main readback blobs, and both reviewed policies disabled afterward. Any recovered existing receipt must be described as verified retention; readback does not establish which invocation created it.

Stop for unexpected source or policy changes, missing prior-state checks, unapproved sender IDs, extra request attempts, any ambiguous claim/create response, a rejected/uncertain outcome, an altered record, failed artifact capture, unexpected execution/completion assertions, or the window expiring with missing records or unfinished work. Preserve all available observations. Do not resend, mint an alternate request ID as recovery, delete claims, overwrite receipts, or promote a local fixture to live evidence.

Even successful readback does not establish immutable custody, remote exactly-once execution, producer workflow execution, or model completion. Repository writers can still alter records. The separate CCC return/completion listener and actual inference remain outside this probe.
