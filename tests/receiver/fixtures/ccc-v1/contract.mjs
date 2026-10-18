/** Pure preparation for one explicitly admitted CCC -> Dispatcher -> Engine edge. */
import { createHash } from 'node:crypto';
import { normalizeHandoff, strictJson, stable, validTimestamp } from './normalization.mjs';

export const CONTRACT_VERSION = 'ccc-handoff/1';
export const CONTROL_CENTER = 'sovereign-codex/Codex-control-center';
export const ENGINE_REPO = 'sovereign-codex/AVOT-engine';
export const ROUTE = Object.freeze({ stage: 'cross-repo-dispatcher', target: 'avot-engine-runner', targetRepo: ENGINE_REPO, receivingEventType: 'avot_execution' });
export const canonical = stable;
export const digest = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex');
export const recordBytes = value => Buffer.from(canonical(value) + '\n', 'utf8');
export const gitBlobSha = value => {
  const bytes = Buffer.from(value);
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
};
const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const own = (value, key) => Object.hasOwn(value, key);
const same = (a, b) => canonical(a) === canonical(b);
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positiveId = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const bounded = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
const repoName = value => bounded(value) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value);
const requestId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const stages = new Set(['router', 'dispatcher']);
const preparedObjects = new WeakSet();

export function identityKey(stage, identity) {
  if (!stages.has(stage) || !repoName(identity?.source_repo) || !bounded(identity?.source_workflow) || !requestId(identity?.request_id)) throw new TypeError('Invalid handoff identity.');
  return digest(['ccc-request-identity-v1', stage, identity.source_repo.toLowerCase(), identity.source_workflow, identity.request_id]);
}

export function ledgerPath(stage, key, kind = 'claim') {
  if (!stages.has(stage) || !hex64(key) || !['claim', 'outcome'].includes(kind)) throw new TypeError('Invalid ledger path.');
  return `handoff-ledger/v1/${stage}/${key}/${kind}.json`;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const isPreparedHandoff = value => preparedObjects.has(value);
function finish(result) {
  if (result.issues.length) { result.disposition = 'hold'; result.request = null; }
  preparedObjects.add(result);
  return freeze(result);
}

function allowedProducer(policy, sender, identity) {
  return policy.producer_bindings.some(binding => binding.sender_id === sender && binding.source_repo.toLowerCase() === identity.source_repo.toLowerCase() && binding.source_workflow === identity.source_workflow);
}

function bindingFor(stage, identity, sourceInputDigest, contentDigest, sender, policyDigest, upstream = null) {
  const data = {
    contract_version: CONTRACT_VERSION, stage,
    source_repo: identity.source_repo.toLowerCase(), source_workflow: identity.source_workflow,
    request_id: identity.request_id,
    source_input_sha256: sourceInputDigest,
    normalized_content_sha256: contentDigest,
    route: ROUTE, admitted_sender_id: sender, policy_sha256: policyDigest,
    upstream_router_fingerprint: upstream
  };
  return { ...data, fingerprint: digest(data) };
}

function exactKeys(value, expected) {
  return obj(value) && same(Object.keys(value).sort(), [...expected].sort());
}

function observationValid(value) {
  return exactKeys(value, ['run_id', 'run_attempt', 'observed_at', 'actions_event_file_sha256', 'actions_run_url']) &&
    positiveId(value.run_id) && positiveId(value.run_attempt) && validTimestamp(value.observed_at) && hex64(value.actions_event_file_sha256) &&
    value.actions_run_url === `https://github.com/${CONTROL_CENTER}/actions/runs/${value.run_id}`;
}

function validatePolicy(policy, issue) {
  try { strictJson(JSON.stringify(policy)); }
  catch { issue('invalid_policy_json', 'Policy must be bounded strict JSON data.'); return false; }
  if (!obj(policy) || policy.schema_version !== 'ccc-handoff-policy/1' || policy.ledger_branch !== 'main') {
    issue('invalid_policy', 'Use the reviewed policy schema and fixed main ledger branch.');
    return false;
  }
  if (policy.enabled !== true) issue('policy_disabled', 'Live handoff is disabled in the checked-in policy.');
  const producers = Array.isArray(policy.producer_bindings) && policy.producer_bindings.every(p => obj(p) && positiveId(p.sender_id) && repoName(p.source_repo) && bounded(p.source_workflow));
  const dispatchers = Array.isArray(policy.dispatcher_sender_ids) && policy.dispatcher_sender_ids.every(positiveId);
  if (!producers || !dispatchers) issue('invalid_sender_policy', 'Sender policy entries must be explicit bounded GitHub IDs and producer declarations.');
  const receiver = policy.receiver;
  if (!obj(receiver) || receiver.repository !== ENGINE_REPO || receiver.event_type !== 'avot_execution' || receiver.compatible !== true ||
      typeof receiver.verified_commit !== 'string' || !/^[a-f0-9]{40}$/.test(receiver.verified_commit) || !bounded(receiver.evidence_ref)) {
    issue('receiver_unverified', 'An independently reviewed compatible AVOT-engine receiver is required.');
  }
  return producers && dispatchers;
}

function limitRequest(request, issue) {
  const payload = request.body.client_payload;
  const serialized = JSON.stringify(request.body);
  try { strictJson(serialized); }
  catch { issue('dispatch_json_limit', 'The complete outgoing body must also fit the strict JSON nesting profile.'); }
  // A conservative UTF-8 byte bound is also below GitHub's character ceiling.
  if (Object.keys(payload).length > 10 || Buffer.byteLength(serialized, 'utf8') > 60_000) {
    issue('dispatch_payload_too_large', 'The complete request including evidence must fit the 60,000-byte integration limit.');
  }
}

export function prepareHandoff(input = {}) {
  const { stage, eventBytes, observation, policy } = obj(input) ? input : {};
  const result = {
    contract_version: CONTRACT_VERSION, stage: stages.has(stage) ? stage : null,
    disposition: 'hold', issues: [], identity: null, binding: null, request: null,
    evidence: { byte_boundary: 'exact_GITHUB_EVENT_PATH_bytes_not_original_producer_wire_bytes', actions_event_file_sha256: null, client_payload_canonical_sha256: null, normalized_content_sha256: null, outbound_request_sha256: null },
    observation: null,
    provenance: { github_sender_id: null, sender_policy_admitted: false, producer_workflow_execution_verified: false },
    execution: { status: 'unverified', completion_claim: false }
  };
  const issue = (code, message) => result.issues.push({ code, message });
  if (!stages.has(stage)) issue('unsupported_stage', 'Stage must be router or dispatcher.');
  const policyValid = validatePolicy(policy, issue);
  if (!obj(observation) || observation.eventName !== 'repository_dispatch' || observation.repository !== CONTROL_CENTER ||
      !positiveId(observation.runId) || !positiveId(observation.runAttempt) || !validTimestamp(observation.observedAt)) {
    issue('invalid_observation', 'Trusted Actions context and a real observation time are required.');
  }
  if (!(eventBytes instanceof Uint8Array) || eventBytes.byteLength > 262_144) {
    issue('invalid_event_bytes', 'The complete Actions event must be UTF-8 bytes within 256 KiB.');
    return finish(result);
  }
  result.evidence.actions_event_file_sha256 = hashBytes(eventBytes);
  let event;
  try { event = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(eventBytes)); }
  catch { issue('invalid_event_json', 'The Actions event must be strict, lossless JSON without duplicate keys or unsafe numbers.'); return finish(result); }
  if (!obj(event) || !obj(event.client_payload)) { issue('invalid_client_payload', 'An object client_payload is required.'); return finish(result); }
  if (event.repository?.full_name !== CONTROL_CENTER || event.action !== (stage === 'router' ? 'route-event' : 'engine_handoff')) issue('event_context_mismatch', 'The observed repository and event action must match this workflow.');
  const sender = Number.isSafeInteger(event.sender?.id) && event.sender.id > 0 ? String(event.sender.id) : null;
  if (!sender) issue('missing_github_sender', 'A GitHub-supplied numeric sender ID is required.');
  result.provenance.github_sender_id = sender;
  result.evidence.client_payload_canonical_sha256 = digest(event.client_payload);
  if (obj(observation) && positiveId(observation.runId) && positiveId(observation.runAttempt) && validTimestamp(observation.observedAt)) {
    result.observation = { run_id: observation.runId, run_attempt: observation.runAttempt, observed_at: observation.observedAt, actions_event_file_sha256: result.evidence.actions_event_file_sha256, actions_run_url: `https://github.com/${CONTROL_CENTER}/actions/runs/${observation.runId}` };
  }
  if (!stages.has(stage) || !policyValid || !result.observation) return finish(result);

  const payload = event.client_payload;
  const suppliedId = payload.request_id;
  if (!requestId(suppliedId)) issue('missing_or_invalid_request_id', 'A bounded explicit root request_id is required; trace and run IDs are not substitutes.');
  if (obj(payload.event) && own(payload.event, 'request_id') && payload.event.request_id !== suppliedId) issue('conflicting_request_id', 'Wrapper and event request IDs must agree.');

  let normalized, content, metadata, identity;
  const policyDigest = digest(policy);
  if (stage === 'router') {
    if (own(payload, '_ccc_handoff') || (obj(payload.event) && own(payload.event, '_ccc_handoff'))) issue('reserved_handoff_metadata', 'Producer input cannot supply Control Center handoff metadata.');
    normalized = normalizeHandoff({ requestId: suppliedId, rawJson: JSON.stringify(payload), ingressEventType: 'route-event', routeDecision: ROUTE });
    result.issues.push(...normalized.issues.map(({ code, message }) => ({ code, message })));
    const p = normalized.provenance;
    if (!repoName(p.declared_source_repo) || !bounded(p.declared_source_workflow)) issue('invalid_producer_identity', 'Producer repository and workflow must be bounded declarations.');
    if (!requestId(suppliedId) || !repoName(p.declared_source_repo) || !bounded(p.declared_source_workflow) || !normalized.request) return finish(result);
    identity = { request_id: suppliedId, source_repo: p.declared_source_repo, source_workflow: p.declared_source_workflow };
    identity.key = identityKey(stage, identity);
    if (!allowedProducer(policy, sender, identity)) issue('sender_not_allowed', 'The GitHub sender is not admitted for this declared producer repository and workflow.');
    else result.provenance.sender_policy_admitted = true;
    const wrapper = normalized.request.body.client_payload;
    const wrapperFields = Object.fromEntries(Object.entries(wrapper).filter(([key]) => !['target', 'event', 'request_id'].includes(key)));
    content = { target: ROUTE.target, event: wrapper.event, wrapper_fields: wrapperFields };
    result.binding = bindingFor(stage, identity, result.evidence.client_payload_canonical_sha256, digest(content), sender, policyDigest);
    metadata = {
      contract_version: CONTRACT_VERSION,
      router_claim_key: identity.key,
      source_identity: { request_id: identity.request_id, source_repo: identity.source_repo, source_workflow: identity.source_workflow },
      origin_sender_id: sender,
      source_input_sha256: result.binding.source_input_sha256,
      normalized_content_sha256: result.binding.normalized_content_sha256,
      policy_sha256: policyDigest,
      router_fingerprint: result.binding.fingerprint,
      source_event_origin: normalized.evidence.source_event_origin,
      wrapper_fields: wrapperFields,
      router_observation: result.observation
    };
  } else {
    if (!policy.dispatcher_sender_ids.includes(sender)) issue('dispatcher_sender_not_allowed', 'The GitHub sender is not admitted to the Dispatcher; producer admission is separate.');
    else result.provenance.sender_policy_admitted = true;
    const m = payload._ccc_handoff;
    const fields = ['contract_version', 'router_claim_key', 'source_identity', 'origin_sender_id', 'source_input_sha256', 'normalized_content_sha256', 'policy_sha256', 'router_fingerprint', 'source_event_origin', 'wrapper_fields', 'router_observation'];
    if (!exactKeys(payload, ['target', 'event', 'request_id', '_ccc_handoff']) || !exactKeys(m, fields) || m.contract_version !== CONTRACT_VERSION ||
        !exactKeys(m.source_identity, ['request_id', 'source_repo', 'source_workflow']) || !repoName(m.source_identity?.source_repo) || !bounded(m.source_identity?.source_workflow) ||
        m.source_identity.request_id !== suppliedId || !requestId(suppliedId) || !positiveId(m.origin_sender_id) || !obj(m.wrapper_fields) ||
        !['producer_declared', 'legacy_profile_annotation'].includes(m.source_event_origin) || !observationValid(m.router_observation) ||
        !['router_claim_key', 'source_input_sha256', 'normalized_content_sha256', 'policy_sha256', 'router_fingerprint'].every(key => hex64(m[key]))) {
      issue('invalid_handoff_metadata', 'Dispatcher requires the exact versioned Router handoff and observation structure.');
      return finish(result);
    }
    if (['_ccc_handoff', 'target', 'event', 'request_id'].some(key => own(m.wrapper_fields, key)) || !obj(payload.event) || own(payload.event, '_ccc_handoff')) {
      issue('reserved_handoff_metadata', 'Preserved content cannot override transport control fields.'); return finish(result);
    }
    identity = { ...m.source_identity, key: identityKey(stage, m.source_identity) };
    const routerKey = identityKey('router', identity);
    if (m.router_claim_key !== routerKey || m.policy_sha256 !== policyDigest) issue('handoff_policy_or_identity_mismatch', 'Router identity and policy must match the current reviewed contract.');
    if (!allowedProducer(policy, m.origin_sender_id, identity)) issue('origin_sender_not_allowed', 'The declared Router origin is not admitted by the producer policy.');
    const reconstruction = { ...m.wrapper_fields, target: payload.target, request_id: suppliedId, event: payload.event };
    normalized = normalizeHandoff({ requestId: suppliedId, rawJson: JSON.stringify(reconstruction), ingressEventType: 'route-event', routeDecision: ROUTE });
    result.issues.push(...normalized.issues.map(({ code, message }) => ({ code, message })));
    if (!normalized.request || !same(normalized.event, payload.event)) { issue('normalized_event_changed', 'The received event must already equal the fully normalized Router event.'); return finish(result); }
    if (normalized.provenance.declared_source_repo !== identity.source_repo || normalized.provenance.declared_source_workflow !== identity.source_workflow) issue('producer_identity_mismatch', 'Event provenance and carried identity must agree.');
    content = { target: payload.target, event: payload.event, wrapper_fields: m.wrapper_fields };
    const contentDigest = digest(content);
    const routerBinding = bindingFor('router', identity, m.source_input_sha256, contentDigest, m.origin_sender_id, policyDigest);
    if (contentDigest !== m.normalized_content_sha256 || routerBinding.fingerprint !== m.router_fingerprint) issue('handoff_digest_mismatch', 'Carried content and Router binding hashes must match.');
    result.binding = bindingFor(stage, identity, m.source_input_sha256, contentDigest, sender, policyDigest, m.router_fingerprint);
    result.upstream = {
      identity: { ...m.source_identity, key: routerKey },
      binding: routerBinding,
      request_sha256: digest({ repository: CONTROL_CENTER, body: { event_type: 'engine_handoff', client_payload: payload } }),
      observation: m.router_observation
    };
    metadata = { ...clone(m), dispatcher_claim_key: identity.key, dispatcher_fingerprint: result.binding.fingerprint, dispatcher_sender_id: sender, dispatcher_observation: result.observation };
  }

  result.identity = identity;
  result.producer_outcome = normalized.producer_outcome;
  result.evidence.normalized_content_sha256 = result.binding.normalized_content_sha256;
  result.evidence.policy_sha256 = policyDigest;
  result.evidence.source_event_origin = metadata.source_event_origin;
  result.request = {
    repository: stage === 'router' ? CONTROL_CENTER : ENGINE_REPO,
    body: { event_type: stage === 'router' ? 'engine_handoff' : 'avot_execution', client_payload: { target: ROUTE.target, event: content.event, request_id: suppliedId, _ccc_handoff: metadata } }
  };
  limitRequest(result.request, issue);
  result.evidence.outbound_request_sha256 = digest(result.request);
  result.disposition = result.issues.length ? 'hold' : 'ready';
  return finish(result);
}
