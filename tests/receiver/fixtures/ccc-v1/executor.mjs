/** Create-only claim -> one dispatch attempt -> create-only outcome. No retries. */
import { CONTRACT_VERSION, CONTROL_CENTER, ROUTE, canonical, digest, recordBytes, gitBlobSha, identityKey, ledgerPath, isPreparedHandoff } from './contract.mjs';
import { validTimestamp } from './normalization.mjs';

const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => canonical(a) === canonical(b);
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hex40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positiveId = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);
const exact = (value, keys) => obj(value) && same(Object.keys(value).sort(), [...keys].sort());
const bindingKeys = ['contract_version', 'stage', 'source_repo', 'source_workflow', 'request_id', 'source_input_sha256', 'normalized_content_sha256', 'route', 'admitted_sender_id', 'policy_sha256', 'upstream_router_fingerprint', 'fingerprint'];
const observationKeys = ['run_id', 'run_attempt', 'observed_at', 'actions_event_file_sha256', 'actions_run_url'];

function validObservation(value) {
  return exact(value, observationKeys) && positiveId(value.run_id) && positiveId(value.run_attempt) && validTimestamp(value.observed_at) && hex64(value.actions_event_file_sha256) && value.actions_run_url === `https://github.com/${CONTROL_CENTER}/actions/runs/${value.run_id}`;
}

function validClaim(response, stage, key) {
  try {
    if (response?.status !== 200 || !hex40(response.blobSha)) return false;
    const c = response.record;
    if (!exact(c, ['schema_version', 'contract_version', 'stage', 'identity', 'binding', 'outbound_request_sha256', 'observation']) || c.schema_version !== 'ccc-handoff-claim/1' || c.contract_version !== CONTRACT_VERSION || c.stage !== stage || !validObservation(c.observation)) return false;
    if (!exact(c.identity, ['key', 'request_id', 'source_repo', 'source_workflow']) || c.identity.key !== key || identityKey(stage, c.identity) !== key || !hex64(c.outbound_request_sha256)) return false;
    const b = c.binding;
    if (!exact(b, bindingKeys) || b.contract_version !== c.contract_version || b.stage !== stage || b.source_repo !== c.identity.source_repo.toLowerCase() || b.source_workflow !== c.identity.source_workflow || b.request_id !== c.identity.request_id || !positiveId(b.admitted_sender_id) || !same(b.route, ROUTE)) return false;
    if (!['source_input_sha256', 'normalized_content_sha256', 'policy_sha256', 'fingerprint'].every(k => hex64(b[k]))) return false;
    if (stage === 'router' ? b.upstream_router_fingerprint !== null : !hex64(b.upstream_router_fingerprint)) return false;
    const { fingerprint, ...data } = b;
    return fingerprint === digest(data) && gitBlobSha(recordBytes(c)) === response.blobSha;
  } catch { return false; }
}

function validTransport(value) {
  if (!exact(value, ['status', 'http_status'])) return false;
  if (value.status === 'accepted') return value.http_status === 204;
  if (value.status === 'rejected') return Number.isInteger(value.http_status) && value.http_status >= 100 && value.http_status <= 599 && value.http_status !== 204;
  return value.status === 'uncertain' && value.http_status === null;
}

function validOutcome(response, claimResponse) {
  try {
    if (response?.status !== 200 || !hex40(response.blobSha)) return false;
    const o = response.record, c = claimResponse.record;
    return exact(o, ['schema_version', 'contract_version', 'stage', 'identity_key', 'claim_blob_sha', 'outbound_request_sha256', 'claimant', 'observed_at', 'transport', 'execution']) &&
      o.schema_version === 'ccc-handoff-outcome/1' && o.contract_version === c.contract_version && o.stage === c.stage &&
      o.identity_key === c.identity.key && o.claim_blob_sha === claimResponse.blobSha && o.outbound_request_sha256 === c.outbound_request_sha256 &&
      same(o.claimant, { run_id: c.observation.run_id, run_attempt: c.observation.run_attempt }) && validTimestamp(o.observed_at) && validTransport(o.transport) &&
      same(o.execution, { status: 'unverified', completion_claim: false }) && gitBlobSha(recordBytes(o)) === response.blobSha;
  } catch { return false; }
}

function emptyResult() {
  return { contract_version: CONTRACT_VERSION, stage: null, disposition: 'hold', issues: [], identity: null, binding: null, request: null, evidence: {}, observation: null, execution: { status: 'unverified', completion_claim: false } };
}

export async function executeHandoff(prepared, service) {
  const result = isPreparedHandoff(prepared) ? clone(prepared) : emptyResult();
  result.transport = { status: 'not_attempted', http_status: null };
  result.persistence = {
    claim: { status: 'not_attempted', blob_sha: null, commit_sha: null },
    outcome: { status: 'not_attempted', blob_sha: null, commit_sha: null },
    custody: 'repository_writers_must_preserve_claims'
  };
  const issue = (code, message) => result.issues.push({ code, message });
  if (!isPreparedHandoff(prepared)) {
    issue('unprepared_input', 'Execution requires the unchanged result of current preparation.');
    return result;
  }
  if (prepared.disposition !== 'ready') return result;
  if (!service || !['createRecord', 'readRecord', 'dispatch'].every(k => typeof service[k] === 'function')) {
    result.disposition = 'hold'; issue('invalid_service', 'A complete reviewed transport service is required.'); return result;
  }
  const { stage, identity, binding, observation } = prepared;

  // An incoming metadata object is not evidence of Router admission by itself.
  // Read a fixed CCC claim path, then bind it to the complete actual request.
  if (stage === 'dispatcher') {
    let upstream;
    try { upstream = await service.readRecord(ledgerPath('router', prepared.upstream.identity.key)); }
    catch { upstream = null; }
    const expected = prepared.upstream;
    if (!validClaim(upstream, 'router', expected.identity.key) || !same(upstream.record.identity, expected.identity) ||
        !same(upstream.record.binding, expected.binding) || upstream.record.outbound_request_sha256 !== expected.request_sha256 ||
        !same(upstream.record.observation, expected.observation)) {
      result.disposition = 'hold'; issue('router_claim_unverified', 'The incoming request does not match a verified persisted Router admission.'); return result;
    }
    result.evidence.router_admission = {
      verified: true, claim_blob_sha: upstream.blobSha, request_sha256: expected.request_sha256,
      router_dispatch_execution_verified: false, router_outcome: 'not_required_for_admission_not_read'
    };
  }

  const claim = {
    schema_version: 'ccc-handoff-claim/1', contract_version: CONTRACT_VERSION, stage,
    identity, binding,
    outbound_request_sha256: prepared.evidence.outbound_request_sha256,
    observation
  };
  const claimSha = gitBlobSha(recordBytes(claim));
  const claimPath = ledgerPath(stage, identity.key);
  let created;
  try { created = await service.createRecord(claimPath, clone(claim)); }
  catch { created = null; }

  // Only a verified new write permits this invocation to attempt transport.
  // Never turn 200, 409, 422, malformed 201, or a timeout into permission.
  if (created?.status !== 201 || created.blobSha !== claimSha) {
    result.disposition = 'hold';
    result.persistence.claim.status = 'not_acquired';
    let previous;
    try { previous = await service.readRecord(claimPath); }
    catch { previous = null; }
    if (!validClaim(previous, stage, identity.key)) {
      issue('claim_not_acquired', 'No verified new claim was acquired; missing, malformed or ambiguous state holds without dispatch.');
      return result;
    }
    result.persistence.claim = { status: 'existing', blob_sha: previous.blobSha, commit_sha: null };
    // The semantic binding intentionally excludes this retry's new Actions
    // observation and therefore its delivery-specific outbound request hash.
    if (!same(previous.record.identity, identity) || !same(previous.record.binding, binding)) {
      result.disposition = 'identity_collision';
      issue('identity_collision', 'This caller identity is already bound to different admitted content, route, sender or policy.');
      return result;
    }
    result.disposition = 'duplicate';
    result.prior_claim = { observation: clone(previous.record.observation), outbound_request_sha256: previous.record.outbound_request_sha256 };
    let outcome;
    try { outcome = await service.readRecord(ledgerPath(stage, identity.key, 'outcome')); }
    catch { outcome = null; }
    if (validOutcome(outcome, previous)) {
      result.prior_outcome = { status: 'recorded', blob_sha: outcome.blobSha, outcome: clone(outcome.record) };
    } else {
      result.prior_outcome = { status: outcome?.status === 404 ? 'missing' : 'unverified', outcome: null };
      issue('prior_outcome_unknown', 'The claim remains reserved without a verified outcome; a duplicate cannot resume or retry it.');
    }
    return result;
  }

  result.persistence.claim = { status: 'recorded', blob_sha: claimSha, commit_sha: hex40(created.commitSha) ? created.commitSha : null };
  let response;
  try { response = await service.dispatch(clone(prepared.request)); }
  catch { response = null; }
  if (!Number.isInteger(response?.status) || response.status < 100 || response.status > 599) {
    result.disposition = 'transport_uncertain';
    result.transport = { status: 'uncertain', http_status: null };
    issue('transport_uncertain', 'The single transport attempt has no reliable HTTP outcome; it is never retried automatically.');
  } else if (response.status === 204) {
    result.disposition = 'transport_accepted';
    result.transport = { status: 'accepted', http_status: 204 };
  } else {
    result.disposition = 'transport_rejected';
    result.transport = { status: 'rejected', http_status: response.status };
  }

  const outcome = {
    schema_version: 'ccc-handoff-outcome/1', contract_version: CONTRACT_VERSION, stage,
    identity_key: identity.key, claim_blob_sha: claimSha,
    outbound_request_sha256: claim.outbound_request_sha256,
    claimant: { run_id: observation.run_id, run_attempt: observation.run_attempt },
    observed_at: new Date().toISOString(), transport: clone(result.transport),
    execution: { status: 'unverified', completion_claim: false }
  };
  let saved;
  try { saved = await service.createRecord(ledgerPath(stage, identity.key, 'outcome'), clone(outcome)); }
  catch { saved = null; }
  const outcomeSha = gitBlobSha(recordBytes(outcome));
  if (saved?.status === 201 && saved.blobSha === outcomeSha) {
    result.persistence.outcome = { status: 'recorded', blob_sha: outcomeSha, commit_sha: hex40(saved.commitSha) ? saved.commitSha : null };
  } else {
    result.persistence.outcome.status = 'failed';
    issue('outcome_persistence_failed', 'The observed transport result is retained locally, but its create-only outcome write was not verified.');
  }
  return result;
}
