/**
 * Offline review tool, outside the receiver runtime source fingerprint.
 *
 * It verifies supplied bytes against independently supplied expectations.
 * It cannot authenticate a GitHub capture, a commit-to-blob relationship,
 * an Actions observation, or the authority of those expectations.
 * No executor, HTTP service, credentials, network, or write operation is used.
 *
 * This full-probe check requires both accepted CCC outcomes. The production
 * receiver deliberately admits from claims alone and does not wait for them.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareHandoff } from '../../tests/receiver/fixtures/ccc-v1/contract.mjs';
import {
  prepareReceiver, CONTROL_CENTER, ENGINE_REPO, RECEIVER_VERSION, CCC_VERSION,
  claimPath, receiptPath
} from '../../scripts/receiver/contract.mjs';
import {
  strictJson, canonical, digest, hashBytes, recordBytes, gitBlobSha, validTimestamp
} from '../../scripts/receiver/encoding.mjs';

const BUNDLE_VERSION = 'handoff-receipt-readback-bundle/1';
const REPORT_VERSION = 'handoff-receipt-readback-report/1';
const MAX_BUNDLE_BYTES = 2_000_000;
const MAX_ACTION_BYTES = 262_144;
const MAX_RECORD_BYTES = 1_000_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => canonical(a) === canonical(b);
const exact = (value, keys) => object(value) && same(Object.keys(value).sort(), [...keys].sort());
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const hex40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const senderId = value => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) &&
  Number.isSafeInteger(Number(value)) && String(Number(value)) === value;
const CCC_OBSERVATION_KEYS = ['eventName', 'repository', 'runId', 'runAttempt', 'observedAt'];
const RECEIVER_OBSERVATION_KEYS = [
  ...CCC_OBSERVATION_KEYS, 'ref', 'commitSha', 'workflowSha', 'checkoutSha',
  'workflowRef', 'receiverSourceSha256'
];
const RECORD_NAMES = [
  'router_claim', 'router_outcome', 'dispatcher_claim', 'dispatcher_outcome',
  'receiver_receipt'
];

class VerificationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function requireValue(condition, code, message) {
  if (!condition) throw new VerificationError(code, message);
}
function emptyReport() {
  return {
    schema_version: REPORT_VERSION,
    disposition: 'hold',
    issues: [],
    verification: null,
    execution: { status: 'unverified', completion_claim: false },
    external_capture: {
      verified: false,
      requirement: 'Independently verify the approved expectations, actual GitHub capture, commit-to-blob links, Actions files and observations, and executing code revisions. Offline consistency is not live receipt or workflow provenance.'
    }
  };
}
function decodedBytes(capture, maximum, label) {
  requireValue(typeof capture.bytes_base64 === 'string' && hex64(capture.sha256),
    'invalid_capture', label + ' requires encoded bytes and an independent SHA-256.');
  const encoded = capture.bytes_base64;
  requireValue(encoded.length <= 4 * Math.ceil(maximum / 3) &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded),
  'invalid_capture_encoding', label + ' must use bounded canonical base64.');
  const bytes = Buffer.from(encoded, 'base64');
  requireValue(bytes.length > 0 && bytes.length <= maximum && bytes.toString('base64') === encoded,
    'invalid_capture_encoding', label + ' must use bounded canonical base64.');
  requireValue(hashBytes(bytes) === capture.sha256,
    'capture_sha256_mismatch', label + ' does not match its supplied raw-byte SHA-256.');
  return bytes;
}
function parsedBytes(bytes, label) {
  try { return strictJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new VerificationError('invalid_capture_json', label + ' must be bounded strict UTF-8 JSON.'); }
}
function actionCapture(capture, stage, expectedSender) {
  requireValue(exact(capture, ['bytes_base64', 'sha256', 'observation']) &&
    exact(capture.observation, stage === 'receiver' ? RECEIVER_OBSERVATION_KEYS : CCC_OBSERVATION_KEYS),
  'invalid_actions_capture', stage + ' requires its exact saved Actions bytes and independent observation.');
  const bytes = decodedBytes(capture, MAX_ACTION_BYTES, stage + ' Actions file');
  const event = parsedBytes(bytes, stage + ' Actions file');
  requireValue(object(event) && Number.isSafeInteger(event.sender?.id) && event.sender.id > 0 &&
    String(event.sender.id) === expectedSender,
  'sender_mismatch', stage + ' Actions sender must match the independently approved principal.');
  return { bytes, event, observation: capture.observation, sha256: capture.sha256 };
}
function recordCapture(capture, repository, path, label) {
  requireValue(exact(capture, ['repository', 'path', 'commit_sha', 'blob_sha', 'sha256', 'bytes_base64']) &&
    capture.repository === repository && capture.path === path && hex40(capture.commit_sha) && hex40(capture.blob_sha),
  'record_location_mismatch', label + ' requires the expected repository, request path, and captured commit/blob identities.');
  const bytes = decodedBytes(capture, MAX_RECORD_BYTES, label);
  requireValue(gitBlobSha(bytes) === capture.blob_sha, 'record_blob_mismatch',
    label + ' does not match its captured Git blob identity.');
  const record = parsedBytes(bytes, label);
  requireValue(object(record) && recordBytes(record).equals(bytes), 'noncanonical_record',
    label + ' must contain exactly canonical record bytes plus one LF.');
  return {
    record,
    reference: {
      repository, path, commit_sha: capture.commit_sha,
      blob_sha: capture.blob_sha, sha256: capture.sha256
    }
  };
}
function expectedClaim(prepared) {
  return {
    schema_version: 'ccc-handoff-claim/1', contract_version: CCC_VERSION,
    stage: prepared.stage, identity: prepared.identity, binding: prepared.binding,
    outbound_request_sha256: prepared.evidence.outbound_request_sha256,
    observation: prepared.observation
  };
}
function verifyOutcome(captured, prepared, claim) {
  requireValue(validTimestamp(captured.record.observed_at), 'invalid_outcome_time',
    prepared.stage + ' outcome must retain a valid observation timestamp.');
  const expected = {
    schema_version: 'ccc-handoff-outcome/1', contract_version: CCC_VERSION,
    stage: prepared.stage, identity_key: prepared.identity.key,
    claim_blob_sha: claim.reference.blob_sha,
    outbound_request_sha256: prepared.evidence.outbound_request_sha256,
    claimant: { run_id: prepared.observation.run_id, run_attempt: prepared.observation.run_attempt },
    observed_at: captured.record.observed_at,
    transport: { status: 'accepted', http_status: 204 },
    execution: { status: 'unverified', completion_claim: false }
  };
  requireValue(same(captured.record, expected), 'outcome_mismatch',
    prepared.stage + ' outcome must exactly bind the claim and record accepted transport without completion.');
}
function expectedReceipt(prepared, router, dispatcher, claims) {
  const evidence = prepared.evidence, observation = prepared.observation;
  const reference = (stage, upstream) => ({
    repository: CONTROL_CENTER,
    path: claimPath(stage, upstream.identity.key),
    blob_sha: claims[stage].reference.blob_sha,
    request_sha256: upstream.evidence.outbound_request_sha256
  });
  const path = receiptPath(prepared.identity.key);
  return {
    schema_version: RECEIVER_VERSION, handoff_contract_version: CCC_VERSION,
    identity: prepared.identity, binding: prepared.binding, envelope: prepared.envelope,
    observation,
    evidence: {
      byte_boundary: 'exact_GITHUB_EVENT_PATH_bytes_not_original_producer_wire_bytes',
      actions_event_file_sha256: observation.actions_event_file_sha256,
      client_payload_canonical_sha256: evidence.client_payload_canonical_sha256,
      dispatch_request_sha256: evidence.dispatch_request_sha256,
      normalized_content_sha256: evidence.normalized_content_sha256,
      source_input_sha256: evidence.source_input_sha256,
      ccc_policy_sha256: evidence.ccc_policy_sha256,
      receiver_policy_sha256: evidence.receiver_policy_sha256,
      receiver_source_sha256: evidence.receiver_source_sha256
    },
    upstream_claims: { router: reference('router', router), dispatcher: reference('dispatcher', dispatcher) },
    receipt: {
      state: 'retained', repository: ENGINE_REPO, path,
      review_url: 'https://github.com/' + ENGINE_REPO + '/blob/main/' + path,
      event_artifact: {
        name: 'avot-receiver-' + observation.run_id + '-' + observation.run_attempt,
        file: 'actions-event.json', actions_run_url: observation.actions_run_url,
        standing: 'expected_workflow_upload_not_verified'
      }
    },
    provenance: {
      github_sender_id: prepared.binding.admitted_sender_id,
      sender_policy_admitted: true, upstream_claims_verified: true,
      producer_workflow_execution_verified: false, upstream_dispatch_execution_verified: false
    },
    execution: { status: 'unverified', completion_claim: false }
  };
}

/** Synchronous pure verification. Every authority/pin is supplied independently. */
export function verifyReadbackBundle(input) {
  const report = emptyReport();
  try {
    const serialized = JSON.stringify(input);
    requireValue(typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= MAX_BUNDLE_BYTES,
      'invalid_bundle', 'A bounded JSON readback bundle is required.');
    const bundle = strictJson(serialized);
    requireValue(exact(bundle, ['schema_version', 'expected', 'actions', 'records']) &&
      bundle.schema_version === BUNDLE_VERSION,
    'invalid_bundle', 'The exact supported readback bundle schema is required.');
    const expected = bundle.expected;
    requireValue(exact(expected, [
      'route_event', 'ccc_policy', 'receiver_policy', 'ccc_policy_sha256',
      'receiver_policy_sha256', 'receiver_source_sha256', 'sender_ids'
    ]) && exact(expected.route_event, ['repository', 'body']) &&
      expected.route_event.repository === CONTROL_CENTER &&
      exact(expected.route_event.body, ['event_type', 'client_payload']) &&
      expected.route_event.body.event_type === 'route-event' &&
      object(expected.route_event.body.client_payload),
    'invalid_expectations', 'The independently approved route-event and both complete policies are required.');
    requireValue(exact(expected.sender_ids, ['router', 'dispatcher', 'receiver']) &&
      Object.values(expected.sender_ids).every(senderId),
    'invalid_expected_senders', 'All three observed sender roles require explicit safe numeric GitHub IDs.');
    requireValue(hex64(expected.ccc_policy_sha256) && hex64(expected.receiver_policy_sha256) &&
      hex64(expected.receiver_source_sha256) &&
      digest(expected.ccc_policy) === expected.ccc_policy_sha256 &&
      digest(expected.receiver_policy) === expected.receiver_policy_sha256 &&
      expected.receiver_policy?.upstream_policy_sha256 === expected.ccc_policy_sha256 &&
      expected.receiver_policy?.receiver_source_sha256 === expected.receiver_source_sha256,
    'policy_or_source_pin_mismatch', 'Independent CCC policy, receiver policy, and receiver source pins must agree exactly.');
    requireValue(exact(bundle.actions, ['router', 'dispatcher', 'receiver']) &&
      exact(bundle.records, RECORD_NAMES),
    'incomplete_bundle', 'All three Actions files and both CCC claim/outcome pairs plus the receipt are required.');

    const actions = {};
    for (const stage of ['router', 'dispatcher', 'receiver']) {
      actions[stage] = actionCapture(bundle.actions[stage], stage, expected.sender_ids[stage]);
    }
    requireValue(same(actions.router.event.client_payload, expected.route_event.body.client_payload),
      'approved_request_mismatch', 'The observed Router payload must equal the independently approved route-event payload.');
    const prepareCcc = stage => prepareHandoff({
      stage, eventBytes: actions[stage].bytes, observation: actions[stage].observation,
      policy: expected.ccc_policy
    });
    const router = prepareCcc('router');
    requireValue(router.disposition === 'ready', 'router_preparation_held',
      'The exact observed Router event must pass the pinned CCC preparation and approved policy.');
    requireValue(same(actions.dispatcher.event.client_payload, router.request.body.client_payload),
      'router_dispatch_chain_mismatch', 'The observed Dispatcher payload must equal the complete reconstructed Router output.');
    const dispatcher = prepareCcc('dispatcher');
    requireValue(dispatcher.disposition === 'ready', 'dispatcher_preparation_held',
      'The exact observed Dispatcher event must pass the pinned CCC preparation and approved policy.');
    requireValue(same(actions.receiver.event.client_payload, dispatcher.request.body.client_payload),
      'dispatcher_receiver_chain_mismatch', 'The observed Receiver payload must equal the complete reconstructed Dispatcher output.');
    const receiver = prepareReceiver({
      eventBytes: actions.receiver.bytes, observation: actions.receiver.observation,
      policy: expected.receiver_policy
    });
    requireValue(receiver.disposition === 'ready', 'receiver_preparation_held',
      'The exact observed Receiver event must pass sender, policy, context, and runtime source admission.');

    const claims = {}, outcomes = {};
    for (const prepared of [router, dispatcher]) {
      const stage = prepared.stage, path = claimPath(stage, prepared.identity.key);
      claims[stage] = recordCapture(bundle.records[stage + '_claim'], CONTROL_CENTER, path, stage + ' claim');
      requireValue(same(claims[stage].record, expectedClaim(prepared)), 'claim_mismatch',
        stage + ' claim must exactly match the reconstructed request, binding, and independent Actions observation.');
      outcomes[stage] = recordCapture(bundle.records[stage + '_outcome'], CONTROL_CENTER,
        path.replace(/claim\.json$/, 'outcome.json'), stage + ' outcome');
      verifyOutcome(outcomes[stage], prepared, claims[stage]);
    }
    const receipt = recordCapture(bundle.records.receiver_receipt, ENGINE_REPO,
      receiptPath(receiver.identity.key), 'receiver receipt');
    requireValue(same(receipt.record, expectedReceipt(receiver, router, dispatcher, claims)),
      'receipt_mismatch', 'The entire receipt must match the reconstructed chain and independent Receiver observation without a completion claim.');

    report.disposition = 'offline_bundle_verified';
    report.verification = {
      identity: receiver.identity,
      source_input_sha256: router.binding.source_input_sha256,
      normalized_content_sha256: receiver.binding.normalized_content_sha256,
      router_request_sha256: router.evidence.outbound_request_sha256,
      dispatcher_request_sha256: dispatcher.evidence.outbound_request_sha256,
      ccc_policy_sha256: expected.ccc_policy_sha256,
      receiver_policy_sha256: expected.receiver_policy_sha256,
      receiver_source_sha256: expected.receiver_source_sha256,
      sender_ids: expected.sender_ids,
      actions_event_file_sha256: Object.fromEntries(
        ['router', 'dispatcher', 'receiver'].map(stage => [stage, actions[stage].sha256])
      ),
      records: {
        router_claim: claims.router.reference, router_outcome: outcomes.router.reference,
        dispatcher_claim: claims.dispatcher.reference, dispatcher_outcome: outcomes.dispatcher.reference,
        receiver_receipt: receipt.reference
      },
      recorded_transport: {
        router: { status: 'accepted', http_status: 204 },
        dispatcher: { status: 'accepted', http_status: 204 }
      }
    };
  } catch (error) {
    report.issues.push(error instanceof VerificationError
      ? { code: error.code, message: error.message }
      : { code: 'invalid_bundle', message: 'The supplied bundle is not supported bounded JSON evidence.' });
  }
  return report;
}

const main = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (main) {
  let report;
  try {
    const [suppliedPath, ...extra] = process.argv.slice(2);
    requireValue(extra.length === 0, 'invalid_arguments', 'Supply at most one read-only bundle JSON path.');
    const path = suppliedPath === undefined
      ? fileURLToPath(new URL('./readback-bundle.json', import.meta.url)) : resolve(suppliedPath);
    const bytes = await readFile(path);
    requireValue(bytes.length <= MAX_BUNDLE_BYTES, 'invalid_bundle', 'The bundle exceeds its byte limit.');
    report = verifyReadbackBundle(parsedBytes(bytes, 'readback bundle'));
  } catch (error) {
    report = emptyReport();
    report.issues.push(error instanceof VerificationError
      ? { code: error.code, message: error.message }
      : { code: 'bundle_unavailable', message: 'The read-only bundle JSON file could not be read.' });
  }
  process.stdout.write(recordBytes(report));
  if (report.disposition !== 'offline_bundle_verified') process.exitCode = 1;
}
