/** Verify both upstream claims, then create one complete receipt. No execution or dispatch. */
import { strictJson, canonical, digest, recordBytes, gitBlobSha } from './encoding.mjs';
import { RECEIVER_VERSION, CCC_VERSION, ENGINE_REPO, CONTROL_CENTER, claimPath, receiptPath, envelopeDetails, receiverBinding, validReceiverObservation, isPreparedReceiver } from './contract.mjs';

const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => canonical(a) === canonical(b);
const clone = value => JSON.parse(JSON.stringify(value));
const hex40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const positiveId = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);

function expectedClaim(stage, data) {
  return { schema_version: 'ccc-handoff-claim/1', contract_version: CCC_VERSION, stage, identity: data.identity, binding: data.binding, outbound_request_sha256: data.request_sha256, observation: data.observation };
}
function claimReference(stage, data) {
  return { repository: CONTROL_CENTER, path: claimPath(stage, data.identity.key), blob_sha: gitBlobSha(recordBytes(expectedClaim(stage, data))), request_sha256: data.request_sha256 };
}
function validClaim(response, stage, expected) {
  try {
    const record = expectedClaim(stage, expected);
    return response?.status === 200 && response.blobSha === gitBlobSha(recordBytes(record)) && same(response.record, record);
  } catch { return false; }
}

function buildReceipt(envelope, observation, binding) {
  const details = envelopeDetails(envelope);
  const path = receiptPath(details.identity.key);
  return {
    schema_version: RECEIVER_VERSION, handoff_contract_version: CCC_VERSION,
    identity: details.identity, binding, envelope: clone(envelope), observation: clone(observation),
    evidence: {
      byte_boundary: 'exact_GITHUB_EVENT_PATH_bytes_not_original_producer_wire_bytes',
      actions_event_file_sha256: observation.actions_event_file_sha256,
      client_payload_canonical_sha256: details.client_payload_canonical_sha256,
      dispatch_request_sha256: details.dispatch_request_sha256,
      normalized_content_sha256: details.normalized_content_sha256,
      source_input_sha256: details.source_input_sha256, ccc_policy_sha256: details.ccc_policy_sha256,
      receiver_policy_sha256: binding.receiver_policy_sha256, receiver_source_sha256: observation.receiver_source_sha256
    },
    upstream_claims: { router: claimReference('router', details.router), dispatcher: claimReference('dispatcher', details.dispatcher) },
    receipt: {
      state: 'retained', repository: ENGINE_REPO, path,
      review_url: `https://github.com/${ENGINE_REPO}/blob/main/${path}`,
      event_artifact: { name: `avot-receiver-${observation.run_id}-${observation.run_attempt}`, file: 'actions-event.json', actions_run_url: observation.actions_run_url, standing: 'expected_workflow_upload_not_verified' }
    },
    provenance: {
      github_sender_id: binding.admitted_sender_id, sender_policy_admitted: true,
      upstream_claims_verified: true, producer_workflow_execution_verified: false,
      upstream_dispatch_execution_verified: false
    },
    execution: { status: 'unverified', completion_claim: false }
  };
}

function validReceipt(response, expectedPath) {
  try {
    if (response?.status !== 200 || !hex40(response.blobSha) || !obj(response.record)) return false;
    const record = response.record;
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized, 'utf8') > 1_000_000) return false;
    strictJson(serialized);
    if (!validReceiverObservation(record.observation) || !obj(record.binding) || !hex64(record.binding.receiver_policy_sha256) || !positiveId(record.binding.admitted_sender_id)) return false;
    const details = envelopeDetails(record.envelope);
    if (receiptPath(details.identity.key) !== expectedPath || record.receipt?.path !== expectedPath) return false;
    const expectedBinding = receiverBinding(details, record.binding.admitted_sender_id, record.binding.receiver_policy_sha256, record.observation.receiver_source_sha256);
    const expected = buildReceipt(record.envelope, record.observation, expectedBinding);
    return same(record, expected) && gitBlobSha(recordBytes(expected)) === response.blobSha;
  } catch { return false; }
}

export async function executeReceiver(prepared, service) {
  const branded = isPreparedReceiver(prepared);
  const result = branded ? clone(prepared) : {
    contract_version: RECEIVER_VERSION, disposition: 'hold', issues: [], identity: null, binding: null,
    evidence: {}, observation: null, execution: { status: 'unverified', completion_claim: false }
  };
  result.receipt = null;
  result.persistence = { status: 'not_attempted', path: null, blob_sha: null, commit_sha: null, custody: 'repository_writers_must_preserve_receipts' };
  const issue = (code, message) => result.issues.push({ code, message });
  if (!branded) { issue('unprepared_input', 'Retention requires the current unchanged preparation result.'); return result; }
  if (prepared.disposition !== 'ready') return result;
  if (!service || !['readClaim', 'readReceipt', 'createReceipt'].every(k => typeof service[k] === 'function')) {
    result.disposition = 'hold'; issue('invalid_service', 'The complete bounded claim-read and receipt service is required.'); return result;
  }
  const record = buildReceipt(prepared.envelope, prepared.observation, prepared.binding);
  // Validate the final nesting/size before even the upstream read boundary.
  try { strictJson(JSON.stringify(record)); if (recordBytes(record).byteLength > 1_000_000) throw new Error('Receipt size limit.'); }
  catch { result.disposition = 'hold'; issue('receipt_json_limit', 'The complete receipt must fit the strict JSON and byte limits.'); return result; }
  for (const stage of ['router', 'dispatcher']) {
    let response;
    try { response = await service.readClaim(claimPath(stage, prepared.upstream[stage].identity.key)); }
    catch { response = null; }
    if (!validClaim(response, stage, prepared.upstream[stage])) {
      result.disposition = 'hold'; issue(`${stage}_claim_unverified`, 'The complete received handoff must match both persisted CCC admission records.'); return result;
    }
  }
  result.evidence.upstream_admission = { verified: true, ...clone(record.upstream_claims), upstream_dispatch_execution_verified: false, outcomes: 'not_required_for_admission_not_read' };
  const path = receiptPath(prepared.identity.key), expectedSha = gitBlobSha(recordBytes(record));
  result.persistence.path = path;
  let saved;
  try { saved = await service.createReceipt(path, clone(record)); }
  catch { saved = null; }
  if (saved?.status === 201 && saved.blobSha === expectedSha) {
    result.disposition = 'receipt_recorded';
    result.receipt = record;
    result.persistence = { ...result.persistence, status: 'recorded', blob_sha: expectedSha, commit_sha: hex40(saved.commitSha) ? saved.commitSha : null };
    return result;
  }
  // A failed/ambiguous create can establish existing retention through one
  // verified readback. It can never authorize another mutation or execution.
  let previous;
  try { previous = await service.readReceipt(path); }
  catch { previous = null; }
  if (!validReceipt(previous, path)) {
    result.disposition = 'receipt_uncertain'; result.persistence.status = 'unverified';
    issue('receipt_unverified', 'No complete retained receipt was verified; the create is never retried automatically.'); return result;
  }
  result.persistence = { ...result.persistence, status: 'existing', blob_sha: previous.blobSha, commit_sha: null };
  if (!same(previous.record.identity, prepared.identity) || !same(previous.record.binding, prepared.binding)) {
    result.disposition = 'identity_collision';
    issue('identity_collision', 'This request identity already names a different retained binding; its receipt is preserved.'); return result;
  }
  result.disposition = 'duplicate';
  result.receipt = clone(previous.record);
  return result;
}
