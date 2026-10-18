import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  prepareReceiver, RECEIVER_SOURCE_PATHS, receiverSourceFingerprint,
  identityKey, receiptPath, claimPath, ENGINE_REPO
} from '../../scripts/receiver/contract.mjs';
import { strictJson } from '../../scripts/receiver/encoding.mjs';
import { executeReceiver } from '../../scripts/receiver/executor.mjs';
import {
  buildChain, prepare, ready, receiverPolicy, receiverObservation, receiverEvent,
  LedgerHarness, clone, FIXTURE_SOURCE_SHA256
} from './helpers.mjs';

test('disabled policy, empty sender scope, and missing or mismatched pins make zero service calls', async () => {
  const chain = await buildChain();
  for (const mutate of [
    policy => { policy.enabled = false; },
    policy => { policy.allowed_dispatch_sender_ids = []; },
    policy => { policy.upstream_policy_sha256 = null; },
    policy => { policy.upstream_policy_sha256 = '0'.repeat(64); },
    policy => { policy.receiver_source_sha256 = null; },
    policy => { policy.receiver_source_sha256 = '0'.repeat(64); }
  ]) {
    const policy = receiverPolicy(chain.cccPolicy); mutate(policy);
    const prepared = prepare(chain, { policy });
    assert.equal(prepared.disposition, 'hold');
    const harness = new LedgerHarness();
    const result = await executeReceiver(prepared, harness.receiverService);
    assert.equal(result.disposition, 'hold');
    assert.deepEqual(harness.receiverCalls, []);
  }
});

test('observed Receiver sender requires separate admission rather than trusting carried sender fields', async () => {
  const chain = await buildChain();
  for (const senderId of [101, 202, 999]) {
    const prepared = prepare(chain, { senderId });
    assert.equal(prepared.disposition, 'hold');
    const harness = new LedgerHarness(); await executeReceiver(prepared, harness.receiverService);
    assert.deepEqual(harness.receiverCalls, []);
  }
  ready(prepare(chain, { senderId: 303 }));
});

test('Receiver source fingerprint covers exactly the fixed runtime files in deterministic order', () => {
  const expectedPaths = [
    '.github/workflows/avot-engine-receiver.yml',
    'scripts/receiver/contract.mjs', 'scripts/receiver/encoding.mjs',
    'scripts/receiver/executor.mjs', 'scripts/receiver/github-service.mjs', 'scripts/receiver/run.mjs'
  ].sort();
  assert.deepEqual([...RECEIVER_SOURCE_PATHS].sort(), expectedPaths);
  const entries = expectedPaths.map((path, index) => ({ path, sha256: String(index + 1).repeat(64) }));
  const expected = createHash('sha256').update(JSON.stringify({ files: entries, schema_version: 'avot-receiver-source/1' })).digest('hex');
  assert.equal(receiverSourceFingerprint(entries), expected);
  assert.equal(receiverSourceFingerprint([...entries].reverse()), expected);
  const changed = clone(entries); changed[2].sha256 = 'f'.repeat(64);
  assert.notEqual(receiverSourceFingerprint(changed), expected);
  for (const invalid of [
    entries.slice(1), [...entries, entries[0]],
    entries.map((entry, index) => index === 0 ? { ...entry, path: 'config/avot-receiver.json' } : entry),
    entries.map((entry, index) => index === 0 ? { ...entry, sha256: 'not-a-hash' } : entry)
  ]) assert.throws(() => receiverSourceFingerprint(invalid));
});

test('matching main commit, checkout, workflow, and source identities are mandatory', async () => {
  const chain = await buildChain();
  for (const override of [
    { ref: 'refs/heads/review-branch' }, { commitSha: 'b'.repeat(40) },
    { checkoutSha: 'b'.repeat(40) }, { workflowSha: 'b'.repeat(40) },
    { workflowRef: ENGINE_REPO + '/.github/workflows/other.yml@refs/heads/main' },
    { receiverSourceSha256: '0'.repeat(64) }, { receiverSourceSha256: null },
    { eventName: 'pull_request' }, { repository: 'org/elsewhere' },
    { runId: '' }, { runAttempt: '0' }, { observedAt: '2026-02-30T00:00:00Z' }
  ]) {
    const prepared = prepare(chain, { obs: receiverObservation(override) });
    assert.equal(prepared.disposition, 'hold', JSON.stringify(override));
    const harness = new LedgerHarness(); await executeReceiver(prepared, harness.receiverService);
    assert.deepEqual(harness.receiverCalls, []);
  }
});

test('run, attempt, main commit, formatting, and observation time do not alter the receipt identity or binding', async () => {
  const chain = await buildChain();
  const first = ready(prepare(chain));
  const updatedObservation = receiverObservation({
    runId: '9002', runAttempt: '3', observedAt: '2026-10-18T07:00:00.000Z',
    commitSha: 'b'.repeat(40), workflowSha: 'b'.repeat(40), checkoutSha: 'b'.repeat(40)
  });
  const second = ready(prepare(chain, { obs: updatedObservation, bytes: Buffer.from(JSON.stringify(receiverEvent(chain.envelope), null, 2) + '\n') }));
  assert.equal(first.identity.key, second.identity.key);
  assert.equal(first.binding.fingerprint, second.binding.fingerprint);
  assert.notDeepEqual(first.observation, second.observation);
  assert.notDeepEqual(first.evidence, second.evidence);
  assert.equal(first.envelope._ccc_handoff.dispatcher_observation.run_id, second.envelope._ccc_handoff.dispatcher_observation.run_id);
});

test('identity namespace is stable while different admitted Receiver senders bind differently', async () => {
  const chain = await buildChain();
  const policy = receiverPolicy(chain.cccPolicy); policy.allowed_dispatch_sender_ids = ['303', '304'];
  const first = ready(prepare(chain, { policy, senderId: 303 }));
  const second = ready(prepare(chain, { policy, senderId: 304 }));
  assert.equal(first.identity.key, second.identity.key);
  assert.notEqual(first.binding.fingerprint, second.binding.fingerprint);
  assert.equal(identityKey({ request_id: 'req-1', source_repo: 'ORG/Producer', source_workflow: 'workflow' }), identityKey({ request_id: 'req-1', source_repo: 'org/producer', source_workflow: 'workflow' }));
  assert.notEqual(identityKey({ request_id: 'req-1', source_repo: 'org/producer', source_workflow: 'workflow' }), identityKey({ request_id: 'req-2', source_repo: 'org/producer', source_workflow: 'workflow' }));
});

test('caller identity cannot be absent, padded, replaced by trace identity, or contradicted inside event', async () => {
  const chain = await buildChain();
  for (const mutate of [
    envelope => { delete envelope.request_id; },
    envelope => { envelope.request_id = ''; },
    envelope => { envelope.request_id = ' padded'; },
    envelope => { envelope.request_id = '../path'; },
    envelope => { envelope.request_id = 'a'.repeat(129); },
    envelope => { envelope.event.request_id = 'contradiction'; },
    envelope => { envelope._ccc_handoff.source_identity.request_id = 'contradiction'; }
  ]) {
    const envelope = clone(chain.envelope); mutate(envelope);
    assert.equal(prepare(chain, { envelope }).disposition, 'hold');
  }
});

test('unknown contract versions, malformed metadata, and extra control keys are held', async () => {
  const chain = await buildChain();
  for (const mutate of [
    envelope => { envelope._ccc_handoff.contract_version = 'ccc-handoff/999'; },
    envelope => { envelope._ccc_handoff = null; },
    envelope => { envelope._ccc_handoff = []; },
    envelope => { delete envelope._ccc_handoff; },
    envelope => { envelope._ccc_handoff.unreviewed = true; },
    envelope => { envelope.target = 'another-target'; },
    envelope => { envelope.extra_control = 'unreviewed'; },
    envelope => { envelope.event._ccc_handoff = {}; }
  ]) {
    const envelope = clone(chain.envelope); mutate(envelope);
    assert.equal(prepare(chain, { envelope }).disposition, 'hold');
  }
});

test('changed producer fields or preserved wrapper content cannot retain the old content binding', async () => {
  const chain = await buildChain();
  for (const mutate of [
    envelope => { envelope.event.payload.message = 'changed'; },
    envelope => { envelope.event.governance.execution_authorized = true; },
    envelope => { envelope.event.runtime_packet.packet_id = 'changed'; },
    envelope => { envelope.event.timestamp = '2026-10-18T06:00:00Z'; },
    envelope => { envelope.event.source_repo = 'org/contradiction'; },
    envelope => { envelope.event.destination = { repo: 'sovereign-codex/Tyme-Lab' }; },
    envelope => { envelope._ccc_handoff.wrapper_fields.wrapper_note.preserve = false; }
  ]) {
    const envelope = clone(chain.envelope); mutate(envelope);
    assert.equal(prepare(chain, { envelope }).disposition, 'hold');
  }
});

test('wrong outer action, repository, sender representation, or event shape yields structured holds', async () => {
  const chain = await buildChain();
  for (const event of [
    receiverEvent(chain.envelope, { overrides: { action: 'avot_result' } }),
    receiverEvent(chain.envelope, { overrides: { repository: { full_name: 'org/elsewhere' } } }),
    receiverEvent(chain.envelope, { overrides: { sender: { id: '303' } } }),
    receiverEvent(chain.envelope, { overrides: { sender: { id: -1 } } }),
    receiverEvent(chain.envelope, { overrides: { client_payload: [] } }), null, []
  ]) {
    let prepared;
    assert.doesNotThrow(() => { prepared = prepareReceiver({ eventBytes: Buffer.from(JSON.stringify(event)), observation: receiverObservation(), policy: receiverPolicy(chain.cccPolicy) }); });
    assert.equal(prepared.disposition, 'hold');
  }
});

test('strict event limits hold malformed, duplicate-key, lossy-number, oversized, and deeply nested data', async () => {
  const chain = await buildChain();
  const valid = JSON.stringify(receiverEvent(chain.envelope));
  const deep = '{"child":'.repeat(2800) + '0' + '}'.repeat(2800);
  const cases = [
    Buffer.from('{'), Buffer.from([0xff, 0xfe]), Buffer.from('null'),
    Buffer.from(valid.replace('"avot_execution"', '"avot_execution","action":"avot_execution"')),
    Buffer.from(valid.replace('"id":303', '"id":9007199254740993')),
    Buffer.from(valid.replace('"preserve all content"', deep)),
    Buffer.from(' '.repeat(262145) + valid)
  ];
  for (const bytes of cases) {
    let prepared;
    assert.doesNotThrow(() => { prepared = prepare(chain, { bytes }); });
    assert.equal(prepared.disposition, 'hold');
    const harness = new LedgerHarness(); await executeReceiver(prepared, harness.receiverService);
    assert.deepEqual(harness.receiverCalls, []);
  }
  assert.doesNotThrow(() => strictJson('['.repeat(64) + '0' + ']'.repeat(64)));
  assert.throws(() => strictJson('['.repeat(65) + '0' + ']'.repeat(65)));
});

test('malformed policies cannot bypass exact schema and strict JSON requirements', async () => {
  const chain = await buildChain();
  const base = receiverPolicy(chain.cccPolicy);
  const circular = clone(base); circular.loop = circular;
  const big = clone(base); big.value = 1n;
  const unknown = clone(base); unknown.allow_all = true;
  for (const policy of [undefined, null, [], 'policy', circular, big, unknown, { ...base, enabled: 'true' }, { ...base, ledger_branch: 'other' }, { ...base, allowed_dispatch_sender_ids: ['not-an-id'] }]) {
    let prepared;
    assert.doesNotThrow(() => { prepared = prepareReceiver({ eventBytes: Buffer.from(JSON.stringify(receiverEvent(chain.envelope))), observation: receiverObservation(), policy }); });
    assert.equal(prepared.disposition, 'hold');
    const harness = new LedgerHarness(); await executeReceiver(prepared, harness.receiverService);
    assert.deepEqual(harness.receiverCalls, []);
  }
});

test('receipt and claim paths are deterministic hashes with no producer-controlled path fragments', () => {
  const identity = { request_id: 'req-1', source_repo: 'org/producer', source_workflow: 'workflow' };
  const key = identityKey(identity);
  assert.equal(receiptPath(key), 'receiver-receipts/v1/' + key + '/receipt.json');
  assert.equal(claimPath('router', key), 'handoff-ledger/v1/router/' + key + '/claim.json');
  assert.equal(claimPath('dispatcher', key), 'handoff-ledger/v1/dispatcher/' + key + '/claim.json');
  for (const invalid of ['../path', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(64) + '?ref=other']) assert.throws(() => receiptPath(invalid));
  assert.throws(() => claimPath('unreviewed', key));
  assert.throws(() => identityKey({ ...identity, request_id: '../path' }));
});

test('prepared envelopes are immutable and execution rejects fabricated or cloned ready objects', async () => {
  const chain = await buildChain();
  const prepared = ready(prepare(chain));
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(Object.isFrozen(prepared.envelope.event.payload), true);
  assert.throws(() => { prepared.envelope.event.payload.message = 'changed'; }, TypeError);
  for (const fabricated of [clone(prepared), { disposition: 'ready' }, null]) {
    const harness = new LedgerHarness();
    const result = await executeReceiver(fabricated, harness.receiverService);
    assert.equal(result.disposition, 'hold');
    assert.deepEqual(harness.receiverCalls, []);
  }
});

test('malformed run identity values return structured holds before URL construction or service access', async () => {
  const chain = await buildChain();
  for (const runId of [{ toString: null }, Symbol('fixture-run'), null, 9001, ['9001']]) {
    let prepared;
    assert.doesNotThrow(() => { prepared = prepare(chain, { obs: receiverObservation({ runId }) }); });
    assert.equal(prepared.disposition, 'hold');
    const harness = new LedgerHarness();
    const result = await executeReceiver(prepared, harness.receiverService);
    assert.equal(result.disposition, 'hold');
    assert.deepEqual(harness.receiverCalls, []);
  }
});
