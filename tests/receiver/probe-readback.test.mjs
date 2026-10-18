import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { prepareHandoff, ledgerPath } from './fixtures/ccc-v1/contract.mjs';
import { executeHandoff } from './fixtures/ccc-v1/executor.mjs';
import { prepareReceiver, CONTROL_CENTER, ENGINE_REPO } from '../../scripts/receiver/contract.mjs';
import { executeReceiver } from '../../scripts/receiver/executor.mjs';
import { digest, recordBytes, gitBlobSha } from '../../scripts/receiver/encoding.mjs';
import { cccPolicy, receiverPolicy, receiverObservation, LedgerHarness, ready, assertUnverified, clone } from './helpers.mjs';
import { verifyReadbackBundle } from '../../review/handoff-receipt-probe-001/verify-readback.mjs';

const probeUrl = new URL('../../review/handoff-receipt-probe-001/route-event.json', import.meta.url);
const verifierUrl = new URL('../../review/handoff-receipt-probe-001/verify-readback.mjs', import.meta.url);
const probe = JSON.parse(await readFile(probeUrl, 'utf8'));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const RECORDS = ['router_claim', 'router_outcome', 'dispatcher_claim', 'dispatcher_outcome', 'receiver_receipt'];
const STAGES = ['router', 'dispatcher', 'receiver'];

function actionBytes(action, repository, senderId, payload) {
  // Actions files need not use the canonical serialization used for ledger files.
  return Buffer.from(JSON.stringify({ action, repository: { full_name: repository }, sender: { id: senderId }, client_payload: payload }, null, 2) + '\n');
}

function actionCapsule(bytes, observation) {
  return { bytes_base64: bytes.toString('base64'), sha256: sha256(bytes), observation: clone(observation) };
}

function recordCapsule(record, repository, path, commit) {
  const bytes = recordBytes(record);
  return { repository, path, commit_sha: commit, blob_sha: gitBlobSha(bytes), sha256: sha256(bytes), bytes_base64: bytes.toString('base64') };
}

async function buildProbeBundle(packet = probe) {
  const policy = cccPolicy();
  policy.producer_bindings = [{ sender_id: '101', source_repo: packet.client_payload.event.repo, source_workflow: packet.client_payload.event.workflow }];
  const avotPolicy = receiverPolicy(policy);
  const harness = new LedgerHarness();
  const routerObservation = { eventName: 'repository_dispatch', repository: CONTROL_CENTER, runId: '7001', runAttempt: '1', observedAt: '2026-10-18T06:11:00.000Z' };
  const dispatcherObservation = { ...routerObservation, runId: '8001', observedAt: '2026-10-18T06:12:00.000Z' };
  const receiverObs = receiverObservation({ observedAt: '2026-10-18T06:13:00.000Z' });
  const routerBytes = actionBytes(packet.event_type, CONTROL_CENTER, 101, packet.client_payload);
  const router = ready(prepareHandoff({ stage: 'router', eventBytes: routerBytes, observation: routerObservation, policy }));
  const routerResult = await executeHandoff(router, harness.cccService);
  assert.equal(routerResult.disposition, 'transport_accepted');
  const dispatcherBytes = actionBytes('engine_handoff', CONTROL_CENTER, 202, router.request.body.client_payload);
  const dispatcher = ready(prepareHandoff({ stage: 'dispatcher', eventBytes: dispatcherBytes, observation: dispatcherObservation, policy }));
  const dispatcherResult = await executeHandoff(dispatcher, harness.cccService);
  assert.equal(dispatcherResult.disposition, 'transport_accepted');
  const receiverBytes = actionBytes('avot_execution', ENGINE_REPO, 303, dispatcher.request.body.client_payload);
  const receiver = ready(prepareReceiver({ eventBytes: receiverBytes, observation: receiverObs, policy: avotPolicy }));
  const result = await executeReceiver(receiver, harness.receiverService);
  assert.equal(result.disposition, 'receipt_recorded');
  const records = {};
  for (const [stage, prepared, commit] of [['router', router, '1'.repeat(40)], ['dispatcher', dispatcher, '2'.repeat(40)]]) {
    for (const kind of ['claim', 'outcome']) {
      const path = ledgerPath(stage, prepared.identity.key, kind);
      records[`${stage}_${kind}`] = recordCapsule(harness.cccRecords.get(path).record, CONTROL_CENTER, path, commit);
    }
  }
  records.receiver_receipt = recordCapsule(result.receipt, ENGINE_REPO, result.persistence.path, '3'.repeat(40));
  return {
    bundle: {
      schema_version: 'handoff-receipt-readback-bundle/1',
      expected: {
        route_event: { repository: CONTROL_CENTER, body: clone(packet) },
        ccc_policy: clone(policy), receiver_policy: clone(avotPolicy),
        ccc_policy_sha256: digest(policy), receiver_policy_sha256: digest(avotPolicy), receiver_source_sha256: receiverObs.receiverSourceSha256,
        sender_ids: { router: '101', dispatcher: '202', receiver: '303' }
      },
      actions: { router: actionCapsule(routerBytes, routerObservation), dispatcher: actionCapsule(dispatcherBytes, dispatcherObservation), receiver: actionCapsule(receiverBytes, receiverObs) },
      records
    },
    harness, router, dispatcher, receiver, receipt: result.receipt
  };
}

const fixture = await buildProbeBundle();
const fresh = () => clone(fixture.bundle);
function decoded(capsule) { return JSON.parse(Buffer.from(capsule.bytes_base64, 'base64').toString('utf8')); }
function replaceBytes(capsule, bytes) {
  capsule.bytes_base64 = bytes.toString('base64'); capsule.sha256 = sha256(bytes);
  if (Object.hasOwn(capsule, 'blob_sha')) capsule.blob_sha = gitBlobSha(bytes);
}
function changeRecord(bundle, name, change) {
  const record = decoded(bundle.records[name]); change(record); replaceBytes(bundle.records[name], recordBytes(record));
}
function verified(bundle) {
  const result = verifyReadbackBundle(bundle);
  assert.equal(result.schema_version, 'handoff-receipt-readback-report/1');
  assert.equal(result.disposition, 'offline_bundle_verified', JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  assert.ok(result.verification);
  assertUnverified(result);
  assert.equal(result.external_capture.verified, false);
  assert.equal(typeof result.external_capture.requirement, 'string');
  return result;
}
function held(bundle, context = '') {
  const result = verifyReadbackBundle(bundle);
  assert.equal(result.disposition, 'hold', context);
  assert.ok(result.issues.length > 0, context);
  assert.equal(result.verification, null, context);
  assertUnverified(result);
  assert.equal(result.external_capture.verified, false);
  return result;
}

test('probe readback accepts the checked-in packet through real pinned CCC and AVOT modules, with capture still unverified', () => {
  verified(fresh());
  assert.equal(fixture.router.evidence.source_event_origin, 'producer_declared');
  assert.equal(fixture.router.binding.source_input_sha256, 'a0e307083d71272faea2978a936ebf384dc5ee758c8c847265dd94d4dea9fed7');
  assert.equal(fixture.router.binding.normalized_content_sha256, '28353ca150c2dbaf618cd09a4f5295e163231926ff85fac84b37780ed4eec0f8');
  assert.equal(fixture.receiver.identity.key, '12e8944d71b706b96f42e777784ddc01829cbdbe2df8d681a085a6fe8ced6a19');
  for (const field of ['payload', 'governance', 'runtime_packet', 'probe_extension', 'trace_id', 'timestamp']) {
    assert.deepEqual(fixture.receipt.envelope.event[field], probe.client_payload.event[field]);
  }
  assert.deepEqual(fixture.receipt.envelope._ccc_handoff.wrapper_fields.probe_note, probe.client_payload.probe_note);
  assert.equal(fixture.harness.cccCalls.filter(call => call.kind === 'dispatch').length, 2);
  assert.equal(fixture.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 1);
});

test('probe readback pins producer, Router caller, and Receiver caller as three distinct principals', () => {
  assert.equal(fixture.receipt.envelope._ccc_handoff.origin_sender_id, '101');
  assert.equal(fixture.receipt.envelope._ccc_handoff.dispatcher_sender_id, '202');
  assert.equal(fixture.receipt.provenance.github_sender_id, '303');
  for (const stage of STAGES) {
    const bundle = fresh(); bundle.expected.sender_ids[stage] = stage === 'router' ? '202' : '101'; held(bundle, stage);
  }
});

test('a completely coherent saved chain for another request cannot override the independently approved request', async () => {
  const alternate = clone(probe); alternate.client_payload.request_id += '-other';
  const other = await buildProbeBundle(alternate);
  verified(other.bundle);
  other.bundle.expected = clone(fixture.bundle.expected);
  held(other.bundle);
});

test('a completely coherent chain with changed content cannot override the independently approved payload', async () => {
  const alternate = clone(probe); alternate.client_payload.event.payload.test_vector.message = 'same request identity, different content';
  const other = await buildProbeBundle(alternate);
  verified(other.bundle);
  other.bundle.expected = clone(fixture.bundle.expected);
  held(other.bundle);
});

test('request and policy/source expectations are required outside the receipt', () => {
  for (const field of ['route_event', 'ccc_policy', 'receiver_policy', 'ccc_policy_sha256', 'receiver_policy_sha256', 'receiver_source_sha256', 'sender_ids']) {
    const bundle = fresh(); delete bundle.expected[field]; held(bundle, field);
  }
  for (const field of ['ccc_policy_sha256', 'receiver_policy_sha256', 'receiver_source_sha256']) {
    const bundle = fresh(); bundle.expected[field] = '0'.repeat(64); held(bundle, field);
  }
  const noExpected = fresh(); delete noExpected.expected; held(noExpected);
});

test('independent policy snapshots must match their pins and authorize admission', () => {
  for (const name of ['ccc_policy', 'receiver_policy']) {
    const changed = fresh(); changed.expected[name].enabled = false;
    held(changed, name + ' digest mismatch');
    changed.expected[name + '_sha256'] = digest(changed.expected[name]);
    held(changed, name + ' disabled with a matching digest');
  }
});

test('content, governance, runtime, and wrapper tampering fails even after recalculating receipt byte and blob hashes', () => {
  const changes = [
    record => { record.envelope.event.payload.test_vector.message = 'changed café'; },
    record => { record.envelope.event.governance.execution_authorized = true; },
    record => { record.envelope.event.runtime_packet.execution_state = 'completed'; },
    record => { record.envelope._ccc_handoff.wrapper_fields.probe_note.preserve_wrapper_extension = false; }
  ];
  for (const change of changes) { const bundle = fresh(); changeRecord(bundle, 'receiver_receipt', change); held(bundle); }
});

test('each complete CCC claim is checked for identity, request, and observation integrity', () => {
  const changes = [
    claim => { claim.identity.request_id = 'forged-request'; },
    claim => { claim.outbound_request_sha256 = '0'.repeat(64); },
    claim => { claim.observation.run_id = '98765'; },
    claim => { claim.binding.admitted_sender_id = '999'; }
  ];
  for (const name of ['router_claim', 'dispatcher_claim']) {
    for (const change of changes) { const bundle = fresh(); changeRecord(bundle, name, change); held(bundle, name); }
  }
});

test('both CCC outcomes must link to the actual claim and show accepted HTTP 204 without completion', () => {
  const changes = [
    outcome => { outcome.transport = { status: 'rejected', http_status: 403 }; },
    outcome => { outcome.transport = { status: 'uncertain', http_status: null }; },
    outcome => { outcome.transport = { status: 'accepted', http_status: 200 }; },
    outcome => { outcome.claim_blob_sha = '0'.repeat(40); },
    outcome => { outcome.claimant.run_attempt = '2'; },
    outcome => { outcome.outbound_request_sha256 = '0'.repeat(64); },
    outcome => { outcome.observed_at = 'not-a-time'; },
    outcome => { outcome.execution = { status: 'completed', completion_claim: true }; }
  ];
  for (const name of ['router_outcome', 'dispatcher_outcome']) {
    for (const change of changes) { const bundle = fresh(); changeRecord(bundle, name, change); held(bundle, name); }
  }
});

test('all three saved Actions events and all five saved records are mandatory', () => {
  for (const name of STAGES) { const bundle = fresh(); delete bundle.actions[name]; held(bundle, name); }
  for (const name of RECORDS) { const bundle = fresh(); delete bundle.records[name]; held(bundle, name); }
  for (const value of [null, undefined, [], {}, { schema_version: 'handoff-receipt-readback-bundle/2' }]) held(value);
});

test('repository and path bindings reject valid-looking substitutions for claims, outcomes, and receipt', () => {
  for (const name of RECORDS) {
    const repository = fresh(); repository.records[name].repository = name === 'receiver_receipt' ? CONTROL_CENTER : ENGINE_REPO; held(repository, name);
    const path = fresh(); path.records[name].path = path.records[name].path.replace(/[0-9a-f]{64}/, '0'.repeat(64)); held(path, name);
  }
  const swapped = fresh(); [swapped.records.router_claim, swapped.records.dispatcher_claim] = [swapped.records.dispatcher_claim, swapped.records.router_claim]; held(swapped);
  const inner = fresh(); changeRecord(inner, 'receiver_receipt', record => { record.receipt.path = record.receipt.path.replace(/[0-9a-f]{64}/, '0'.repeat(64)); }); held(inner);
});

test('independent saved-byte SHA256, Git blob identities, and commit identity syntax are checked', () => {
  for (const name of RECORDS) {
    for (const [field, value] of [['sha256', '0'.repeat(64)], ['blob_sha', '0'.repeat(40)], ['commit_sha', '../main']]) {
      const bundle = fresh(); bundle.records[name][field] = value; held(bundle, name + '/' + field);
    }
  }
  for (const name of STAGES) { const bundle = fresh(); bundle.actions[name].sha256 = '0'.repeat(64); held(bundle, name); }
});

test('receipt execution, workflow provenance, and artifact-upload claims cannot be promoted', () => {
  const changes = [
    record => { record.execution = { status: 'completed', completion_claim: true }; },
    record => { record.provenance.producer_workflow_execution_verified = true; },
    record => { record.provenance.upstream_dispatch_execution_verified = true; },
    record => { record.receipt.event_artifact.standing = 'verified_upload'; }
  ];
  for (const change of changes) { const bundle = fresh(); changeRecord(bundle, 'receiver_receipt', change); held(bundle); }
});

test('the exact saved Actions bytes are checked even when changed whitespace preserves the parsed payload', () => {
  for (const name of STAGES) {
    const bundle = fresh(); replaceBytes(bundle.actions[name], Buffer.from(JSON.stringify(decoded(bundle.actions[name])))); held(bundle, name);
  }
});

test('saved observations and actual outer senders must agree with records and independent expectations', () => {
  for (const name of STAGES) {
    const changedRun = fresh(); changedRun.actions[name].observation.runId = '98765'; held(changedRun, name);
    const changedSender = fresh(); const event = decoded(changedSender.actions[name]); event.sender.id = 999;
    replaceBytes(changedSender.actions[name], Buffer.from(JSON.stringify(event))); held(changedSender, name);
  }
  for (const field of ['commitSha', 'workflowSha', 'checkoutSha', 'receiverSourceSha256']) {
    const bundle = fresh(); bundle.actions.receiver.observation[field] = '0'.repeat(field === 'receiverSourceSha256' ? 64 : 40); held(bundle, field);
  }
});

test('duplicate decoded JSON keys inside saved events and records are rejected after honest byte rehashing', () => {
  for (const name of STAGES) {
    const bundle = fresh(); const bytes = Buffer.from(bundle.actions[name].bytes_base64, 'base64');
    replaceBytes(bundle.actions[name], Buffer.from('{"acti\\u006fn":"duplicate",' + bytes.toString('utf8').slice(1))); held(bundle, name);
  }
  for (const name of RECORDS) {
    const bundle = fresh(); const bytes = Buffer.from(bundle.records[name].bytes_base64, 'base64');
    replaceBytes(bundle.records[name], Buffer.from('{"schema_version":"duplicate",' + bytes.toString('utf8').slice(1))); held(bundle, name);
  }
});

test('record serialization, base64, and UTF-8 must remain exact and valid', () => {
  const pretty = fresh(); replaceBytes(pretty.records.receiver_receipt, Buffer.from(JSON.stringify(decoded(pretty.records.receiver_receipt), null, 2) + '\n')); held(pretty);
  const invalidBase64 = fresh(); invalidBase64.records.router_claim.bytes_base64 += '!'; held(invalidBase64);
  const badUtf8Event = fresh(); replaceBytes(badUtf8Event.actions.receiver, Buffer.from([0xc3, 0x28])); held(badUtf8Event);
  const badUtf8Record = fresh(); replaceBytes(badUtf8Record.records.receiver_receipt, Buffer.from([0xc3, 0x28])); held(badUtf8Record);
});

test('oversized and deeply nested offline inputs hold without leaking a thrown parser error', () => {
  const event = fresh(); replaceBytes(event.actions.router, Buffer.alloc(262_145, 0x20)); held(event);
  const record = fresh(); replaceBytes(record.records.receiver_receipt, Buffer.alloc(1_000_001, 0x20)); held(record);
  const total = fresh(); total.expected.route_event.body.client_payload.probe_note.large = 'x'.repeat(2_000_001); held(total);
  const nested = fresh(); replaceBytes(nested.actions.receiver, Buffer.from('['.repeat(2_800) + '0' + ']'.repeat(2_800))); held(nested);
});

test('verification uses neither network transports nor the already-completed injected ledger services', t => {
  let networkCalls = 0, mutatorCalls = 0;
  const forbiddenNetwork = () => { networkCalls += 1; throw new Error('offline only'); };
  t.mock.method(globalThis, 'fetch', forbiddenNetwork);
  t.mock.method(http, 'request', forbiddenNetwork); t.mock.method(http, 'get', forbiddenNetwork);
  t.mock.method(https, 'request', forbiddenNetwork); t.mock.method(https, 'get', forbiddenNetwork);
  for (const [service, methods] of [[fixture.harness.cccService, ['createRecord', 'readRecord', 'dispatch']], [fixture.harness.receiverService, ['readClaim', 'readReceipt', 'createReceipt']]]) {
    for (const method of methods) t.mock.method(service, method, () => { mutatorCalls += 1; throw new Error('verifier must not use services'); });
  }
  const before = [fixture.harness.cccCalls.length, fixture.harness.receiverCalls.length];
  verified(fresh());
  const invalid = fresh(); delete invalid.records.receiver_receipt; held(invalid);
  assert.equal(networkCalls, 0); assert.equal(mutatorCalls, 0);
  assert.deepEqual([fixture.harness.cccCalls.length, fixture.harness.receiverCalls.length], before);
});

test('read-only CLI verifies an explicit saved bundle and rejects missing, duplicate-key, and oversized outer JSON', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'handoff-probe-readback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'readback-bundle.json');
  const run = async path => {
    const stdoutPath = join(directory, 'stdout.json'), stderrPath = join(directory, 'stderr.txt');
    const [stdout, stderr] = await Promise.all([open(stdoutPath, 'w'), open(stderrPath, 'w')]);
    let result;
    try {
      // File-backed descriptors retain the actual subprocess output in hosts
      // where pipe-backed child-process capture is unavailable.
      result = spawnSync(process.execPath, [fileURLToPath(verifierUrl), path], { env: { PATH: process.env.PATH }, stdio: ['ignore', stdout.fd, stderr.fd], timeout: 10_000 });
    } finally { await Promise.all([stdout.close(), stderr.close()]); }
    assert.equal(result.error, undefined);
    return { ...result, stdout: await readFile(stdoutPath, 'utf8'), stderr: await readFile(stderrPath, 'utf8') };
  };
  await writeFile(file, JSON.stringify(fresh()));
  const accepted = await run(file); assert.equal(accepted.status, 0, accepted.stderr); assert.equal(JSON.parse(accepted.stdout).disposition, 'offline_bundle_verified');
  assertUnverified(JSON.parse(accepted.stdout)); assert.equal(JSON.parse(accepted.stdout).external_capture.verified, false);
  const missing = await run(join(directory, 'missing.json')); assert.equal(missing.status, 1); assert.equal(JSON.parse(missing.stdout).disposition, 'hold');
  await writeFile(file, '{"schema_version":"duplicate",' + JSON.stringify(fresh()).slice(1));
  const duplicate = await run(file); assert.equal(duplicate.status, 1); assert.equal(JSON.parse(duplicate.stdout).disposition, 'hold');
  await writeFile(file, ' '.repeat(2_000_001));
  const oversized = await run(file); assert.equal(oversized.status, 1); assert.equal(JSON.parse(oversized.stdout).disposition, 'hold');
});
