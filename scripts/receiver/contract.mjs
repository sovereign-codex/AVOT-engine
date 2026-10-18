/** Pure, disabled-by-default receipt admission for the CCC handoff/1 envelope. */
import { strictJson, canonical, digest, hashBytes, validTimestamp } from './encoding.mjs';

export const RECEIVER_VERSION = 'avot-receiver-receipt/1';
export const CCC_VERSION = 'ccc-handoff/1';
export const ENGINE_REPO = 'sovereign-codex/AVOT-engine';
export const CONTROL_CENTER = 'sovereign-codex/Codex-control-center';
export const RECEIVER_WORKFLOW_REF = `${ENGINE_REPO}/.github/workflows/avot-engine-receiver.yml@refs/heads/main`;
export const ROUTE = Object.freeze({ stage: 'cross-repo-dispatcher', target: 'avot-engine-runner', targetRepo: ENGINE_REPO, receivingEventType: 'avot_execution' });
export const RECEIVER_SOURCE_PATHS = Object.freeze([
  '.github/workflows/avot-engine-receiver.yml',
  'scripts/receiver/contract.mjs',
  'scripts/receiver/encoding.mjs',
  'scripts/receiver/executor.mjs',
  'scripts/receiver/github-service.mjs',
  'scripts/receiver/run.mjs'
]);

const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => canonical(a) === canonical(b);
const exact = (value, keys) => obj(value) && same(Object.keys(value).sort(), [...keys].sort());
const clone = value => JSON.parse(JSON.stringify(value));
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hex40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positiveId = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.trim() === value;
const bounded = value => text(value) && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const repoName = value => bounded(value) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const requestId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const preparedObjects = new WeakSet();
const routerMetadataKeys = ['contract_version', 'router_claim_key', 'source_identity', 'origin_sender_id', 'source_input_sha256', 'normalized_content_sha256', 'policy_sha256', 'router_fingerprint', 'source_event_origin', 'wrapper_fields', 'router_observation'];
const dispatcherMetadataKeys = ['dispatcher_claim_key', 'dispatcher_fingerprint', 'dispatcher_sender_id', 'dispatcher_observation'];

function requireValue(condition, code, message) {
  if (!condition) { const error = new Error(message); error.code = code; throw error; }
}

function validIdentity(value) {
  return obj(value) && requestId(value.request_id) && repoName(value.source_repo) && bounded(value.source_workflow);
}
export function identityKey(identity) {
  requireValue(validIdentity(identity), 'invalid_identity', 'Explicit source and request identity are required.');
  return digest(['avot-receiver-identity-v1', identity.source_repo.toLowerCase(), identity.source_workflow, identity.request_id]);
}
function cccIdentityKey(stage, identity) {
  return digest(['ccc-request-identity-v1', stage, identity.source_repo.toLowerCase(), identity.source_workflow, identity.request_id]);
}
export function receiptPath(key) {
  requireValue(hex64(key), 'invalid_receipt_path', 'A fixed hashed receipt identity is required.');
  return `receiver-receipts/v1/${key}/receipt.json`;
}
export function claimPath(stage, key) {
  requireValue(['router', 'dispatcher'].includes(stage) && hex64(key), 'invalid_claim_path', 'A fixed CCC stage and hashed identity are required.');
  return `handoff-ledger/v1/${stage}/${key}/claim.json`;
}

export function receiverSourceFingerprint(entries) {
  requireValue(Array.isArray(entries) && entries.length === RECEIVER_SOURCE_PATHS.length && entries.every(e => exact(e, ['path', 'sha256']) && hex64(e.sha256)), 'invalid_source_manifest', 'The complete fixed receiver source list is required.');
  const sorted = [...entries].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  requireValue(same(sorted.map(e => e.path), RECEIVER_SOURCE_PATHS), 'invalid_source_manifest', 'Receiver source paths must match exactly.');
  return digest({ schema_version: 'avot-receiver-source/1', files: sorted });
}

function validCccObservation(value) {
  return exact(value, ['run_id', 'run_attempt', 'observed_at', 'actions_event_file_sha256', 'actions_run_url']) && positiveId(value.run_id) && positiveId(value.run_attempt) && validTimestamp(value.observed_at) && hex64(value.actions_event_file_sha256) && value.actions_run_url === `https://github.com/${CONTROL_CENTER}/actions/runs/${value.run_id}`;
}

function cccBinding(stage, identity, m) {
  const data = {
    contract_version: CCC_VERSION, stage,
    source_repo: identity.source_repo.toLowerCase(), source_workflow: identity.source_workflow,
    request_id: identity.request_id, source_input_sha256: m.source_input_sha256,
    normalized_content_sha256: m.normalized_content_sha256, route: ROUTE,
    admitted_sender_id: stage === 'router' ? m.origin_sender_id : m.dispatcher_sender_id,
    policy_sha256: m.policy_sha256,
    upstream_router_fingerprint: stage === 'router' ? null : m.router_fingerprint
  };
  return { ...data, fingerprint: digest(data) };
}

/** Describes structurally valid content; this does not establish sender or claim authority. */
export function envelopeDetails(payload) {
  requireValue(exact(payload, ['target', 'event', 'request_id', '_ccc_handoff']) && payload.target === ROUTE.target && requestId(payload.request_id) && obj(payload.event), 'invalid_envelope', 'The exact four-field CCC envelope and explicit request ID are required.');
  const m = payload._ccc_handoff, event = payload.event;
  requireValue(exact(m, [...routerMetadataKeys, ...dispatcherMetadataKeys]) && m.contract_version === CCC_VERSION, 'invalid_handoff_metadata', 'The complete supported Router and Dispatcher metadata are required.');
  requireValue(exact(m.source_identity, ['request_id', 'source_repo', 'source_workflow']) && validIdentity(m.source_identity) && m.source_identity.request_id === payload.request_id, 'identity_mismatch', 'The carried source identity must match the caller request ID.');
  requireValue(positiveId(m.origin_sender_id) && positiveId(m.dispatcher_sender_id) && validCccObservation(m.router_observation) && validCccObservation(m.dispatcher_observation), 'invalid_upstream_observation', 'Both CCC principal and workflow observations must be well formed.');
  requireValue(['router_claim_key', 'dispatcher_claim_key', 'source_input_sha256', 'normalized_content_sha256', 'policy_sha256', 'router_fingerprint', 'dispatcher_fingerprint'].every(k => hex64(m[k])), 'invalid_handoff_digest', 'Every carried claim and content digest must be a bounded SHA-256 value.');
  requireValue(obj(m.wrapper_fields) && !['_ccc_handoff', 'target', 'event', 'request_id'].some(k => Object.hasOwn(m.wrapper_fields, k)) && !Object.hasOwn(event, '_ccc_handoff') && !Object.hasOwn(event, 'target'), 'reserved_metadata', 'Preserved content cannot override handoff control fields.');
  requireValue(['producer_declared', 'legacy_profile_annotation'].includes(m.source_event_origin), 'invalid_source_event_origin', 'A supported source-event annotation origin is required.');
  const source = m.source_identity;
  requireValue(event.repo === source.source_repo && event.source_repo === source.source_repo && event.workflow === source.source_workflow && event.source_workflow === source.source_workflow && (!Object.hasOwn(event, 'request_id') || event.request_id === source.request_id), 'producer_identity_mismatch', 'Normalized producer declarations must agree with the handoff identity.');
  requireValue(text(event.trace_id) && text(event.status) && validTimestamp(event.timestamp) && text(event.source_event) && (m.source_event_origin !== 'legacy_profile_annotation' || event.source_event === 'legacy'), 'invalid_producer_event', 'Preserved producer trace, status, timestamp and source event are required.');
  requireValue(event.target_repo === ENGINE_REPO && event.target_stage === 'avot_execution' && event.receiving_event_type === 'avot_execution', 'route_mismatch', 'The normalized event must name the fixed AVOT receiver route.');
  requireValue(['payload', 'governance', 'runtime_packet'].every(k => !Object.hasOwn(event, k) || obj(event[k])), 'invalid_rich_event', 'Rich producer fields must remain objects when supplied.');
  const contentHash = digest({ target: payload.target, event, wrapper_fields: m.wrapper_fields });
  requireValue(contentHash === m.normalized_content_sha256, 'content_digest_mismatch', 'The complete event and wrapper fields must match their carried digest.');
  const router = { identity: { ...source, key: cccIdentityKey('router', source) }, binding: cccBinding('router', source, m), observation: clone(m.router_observation) };
  const dispatcher = { identity: { ...source, key: cccIdentityKey('dispatcher', source) }, binding: cccBinding('dispatcher', source, m), observation: clone(m.dispatcher_observation) };
  requireValue(router.identity.key === m.router_claim_key && dispatcher.identity.key === m.dispatcher_claim_key && router.binding.fingerprint === m.router_fingerprint && dispatcher.binding.fingerprint === m.dispatcher_fingerprint, 'handoff_binding_mismatch', 'Both CCC identities and binding fingerprints must match the complete declared contract.');
  const routerMetadata = Object.fromEntries(routerMetadataKeys.map(k => [k, m[k]]));
  router.request_sha256 = digest({ repository: CONTROL_CENTER, body: { event_type: 'engine_handoff', client_payload: { ...payload, _ccc_handoff: routerMetadata } } });
  dispatcher.request_sha256 = digest({ repository: ENGINE_REPO, body: { event_type: 'avot_execution', client_payload: payload } });
  requireValue(Buffer.byteLength(JSON.stringify({ event_type: 'avot_execution', client_payload: payload }), 'utf8') <= 60_000, 'dispatch_payload_too_large', 'The complete dispatch body must fit the reviewed 60,000-byte limit.');
  return {
    identity: { ...source, key: identityKey(source) }, router, dispatcher,
    client_payload_canonical_sha256: digest(payload), dispatch_request_sha256: dispatcher.request_sha256,
    normalized_content_sha256: contentHash, source_input_sha256: m.source_input_sha256, ccc_policy_sha256: m.policy_sha256
  };
}

export function receiverBinding(details, sender, policyHash, sourceHash) {
  const i = details.identity;
  const data = {
    contract_version: RECEIVER_VERSION, handoff_contract_version: CCC_VERSION,
    receiver_repository: ENGINE_REPO,
    source_repo: i.source_repo.toLowerCase(), source_workflow: i.source_workflow, request_id: i.request_id,
    source_input_sha256: details.source_input_sha256, normalized_content_sha256: details.normalized_content_sha256,
    dispatch_request_sha256: details.dispatch_request_sha256, ccc_policy_sha256: details.ccc_policy_sha256,
    router_fingerprint: details.router.binding.fingerprint, dispatcher_fingerprint: details.dispatcher.binding.fingerprint,
    admitted_sender_id: sender, receiver_policy_sha256: policyHash, receiver_source_sha256: sourceHash
  };
  return { ...data, fingerprint: digest(data) };
}

export function validReceiverObservation(value) {
  return exact(value, ['repository', 'ref', 'run_id', 'run_attempt', 'observed_at', 'commit_sha', 'workflow_sha', 'checkout_sha', 'workflow_ref', 'receiver_source_sha256', 'actions_event_file_sha256', 'actions_run_url']) &&
    value.repository === ENGINE_REPO && value.ref === 'refs/heads/main' && positiveId(value.run_id) && positiveId(value.run_attempt) && validTimestamp(value.observed_at) &&
    hex40(value.commit_sha) && value.workflow_sha === value.commit_sha && value.checkout_sha === value.commit_sha && value.workflow_ref === RECEIVER_WORKFLOW_REF &&
    hex64(value.receiver_source_sha256) && hex64(value.actions_event_file_sha256) && value.actions_run_url === `https://github.com/${ENGINE_REPO}/actions/runs/${value.run_id}`;
}

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const isPreparedReceiver = value => preparedObjects.has(value);
function finish(result) {
  result.disposition = result.issues.length ? 'hold' : 'ready';
  preparedObjects.add(result);
  return freeze(result);
}

export function prepareReceiver(input = {}) {
  const { eventBytes, observation, policy } = obj(input) ? input : {};
  const result = {
    contract_version: RECEIVER_VERSION, disposition: 'hold', issues: [], identity: null, binding: null,
    envelope: null, observation: null, upstream: null,
    evidence: { byte_boundary: 'exact_GITHUB_EVENT_PATH_bytes_not_original_producer_wire_bytes', actions_event_file_sha256: null },
    provenance: { github_sender_id: null, sender_policy_admitted: false, producer_workflow_execution_verified: false, upstream_dispatch_execution_verified: false },
    execution: { status: 'unverified', completion_claim: false }
  };
  const issue = (code, message) => result.issues.push({ code, message });
  let safePolicy;
  try { safePolicy = strictJson(JSON.stringify(policy)); }
  catch { issue('invalid_policy_json', 'Policy must be bounded strict JSON data.'); }
  const policyValid = exact(safePolicy, ['schema_version', 'enabled', 'ledger_branch', 'allowed_dispatch_sender_ids', 'upstream_policy_sha256', 'receiver_source_sha256']) && safePolicy.schema_version === 'avot-receiver-policy/1' && typeof safePolicy.enabled === 'boolean' && safePolicy.ledger_branch === 'main' && Array.isArray(safePolicy.allowed_dispatch_sender_ids) && safePolicy.allowed_dispatch_sender_ids.every(positiveId) && new Set(safePolicy.allowed_dispatch_sender_ids).size === safePolicy.allowed_dispatch_sender_ids.length;
  if (!policyValid) issue('invalid_policy', 'The exact reviewed receiver policy and sender-ID list are required.');
  else {
    if (!safePolicy.enabled) issue('policy_disabled', 'Receiver retention is disabled in the checked-in policy.');
    if (!hex64(safePolicy.upstream_policy_sha256)) issue('upstream_policy_unpinned', 'An independently reviewed CCC policy digest is required.');
    if (!hex64(safePolicy.receiver_source_sha256)) issue('receiver_source_unpinned', 'An independently reviewed runtime source fingerprint is required.');
  }
  if (!(eventBytes instanceof Uint8Array) || eventBytes.byteLength > 262_144) { issue('invalid_event_bytes', 'Complete Actions UTF-8 event bytes within 256 KiB are required.'); return finish(result); }
  result.evidence.actions_event_file_sha256 = hashBytes(eventBytes);
  let event;
  try { event = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(eventBytes)); }
  catch { issue('invalid_event_json', 'The Actions event must be bounded strict UTF-8 JSON.'); return finish(result); }
  if (!obj(event) || event.repository?.full_name !== ENGINE_REPO || event.action !== 'avot_execution') issue('event_context_mismatch', 'The event must name this repository and the avot_execution action.');
  const sender = Number.isSafeInteger(event?.sender?.id) && event.sender.id > 0 ? String(event.sender.id) : null;
  result.provenance.github_sender_id = sender;
  if (!sender) issue('missing_github_sender', 'A GitHub-supplied positive numeric sender ID is required.');
  if (policyValid && !safePolicy.allowed_dispatch_sender_ids.includes(sender)) issue('sender_not_allowed', 'The actual AVOT dispatch sender is not admitted by this receiver policy.');
  else if (policyValid) result.provenance.sender_policy_admitted = true;
  // Validate the scalar before interpolation: even plain JSON objects can
  // disable their inherited toString and make implicit coercion throw.
  if (obj(observation) && positiveId(observation.runId)) {
    result.observation = {
      repository: observation.repository, ref: observation.ref, run_id: observation.runId, run_attempt: observation.runAttempt,
      observed_at: observation.observedAt, commit_sha: observation.commitSha, workflow_sha: observation.workflowSha,
      checkout_sha: observation.checkoutSha, workflow_ref: observation.workflowRef, receiver_source_sha256: observation.receiverSourceSha256,
      actions_event_file_sha256: result.evidence.actions_event_file_sha256,
      actions_run_url: `https://github.com/${ENGINE_REPO}/actions/runs/${observation.runId}`
    };
  }
  if (observation?.eventName !== 'repository_dispatch' || !validReceiverObservation(result.observation)) {
    issue('invalid_observation', 'Trusted main-branch Actions, workflow, checkout and source identities must agree.');
    result.observation = null;
  }
  if (policyValid && result.observation && safePolicy.receiver_source_sha256 !== result.observation.receiver_source_sha256) issue('receiver_source_mismatch', 'The executing receiver bytes do not match the reviewed source fingerprint.');
  let details;
  try { details = envelopeDetails(event?.client_payload); }
  catch (error) { issue(error.code || 'invalid_envelope', error.code ? error.message : 'The complete handoff envelope is invalid.'); return finish(result); }
  result.envelope = clone(event.client_payload);
  result.identity = details.identity;
  result.upstream = { router: details.router, dispatcher: details.dispatcher };
  if (!policyValid || !result.observation) return finish(result);
  if (safePolicy.upstream_policy_sha256 !== details.ccc_policy_sha256) issue('upstream_policy_mismatch', 'The handoff does not use the separately pinned CCC policy.');
  const policyHash = digest(safePolicy);
  result.binding = receiverBinding(details, sender, policyHash, result.observation.receiver_source_sha256);
  Object.assign(result.evidence, {
    client_payload_canonical_sha256: details.client_payload_canonical_sha256,
    dispatch_request_sha256: details.dispatch_request_sha256,
    normalized_content_sha256: details.normalized_content_sha256,
    source_input_sha256: details.source_input_sha256, ccc_policy_sha256: details.ccc_policy_sha256,
    receiver_policy_sha256: policyHash, receiver_source_sha256: result.observation.receiver_source_sha256
  });
  return finish(result);
}
