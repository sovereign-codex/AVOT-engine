import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { executeReceiver } from '../../scripts/receiver/executor.mjs';
import { recordBytes, gitBlobSha } from '../../scripts/receiver/encoding.mjs';
import { buildChain, prepare, ready, assertUnverified, producerPayload, clone } from './helpers.mjs';

test('portable CCC interoperability fixtures retain exactly the three pinned production modules', async () => {
  const base = new URL('./fixtures/ccc-v1/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('MANIFEST.json', base), 'utf8'));
  assert.equal(manifest.source_repository, 'sovereign-codex/Codex-control-center');
  assert.equal(manifest.source_commit, '08e79156f540e3f869ad0dc2e6209f6e79f52164');
  assert.equal(manifest.source_pull_request, 22);
  assert.deepEqual(manifest.files.map(file => file.fixture_path).sort(), ['contract.mjs', 'executor.mjs', 'normalization.mjs']);
  assert.deepEqual((await readdir(base)).sort(), ['MANIFEST.json', 'contract.mjs', 'executor.mjs', 'normalization.mjs']);
  for (const file of manifest.files) {
    assert.equal(file.source_path, 'scripts/handoff/' + file.fixture_path);
    const bytes = await readFile(new URL(file.fixture_path, base));
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex'), file.git_blob_sha);
  }
});

test('real pinned Router and Dispatcher modules produce an envelope the production Receiver records whole', async () => {
  const chain = await buildChain();
  const prepared = ready(prepare(chain));
  const result = await executeReceiver(prepared, chain.harness.receiverService);
  assert.equal(result.disposition, 'receipt_recorded', JSON.stringify(result.issues));
  assert.equal(result.persistence.status, 'recorded');
  assert.match(result.persistence.path, /^receiver-receipts\/v1\/[a-f0-9]{64}\/receipt\.json$/);
  assert.equal(result.persistence.blob_sha, gitBlobSha(recordBytes(result.receipt)));
  assert.equal(result.persistence.commit_sha, 'c'.repeat(40));
  assert.deepEqual(result.receipt.envelope, chain.envelope);
  assert.deepEqual(result.envelope, chain.envelope);
  assertUnverified(result); assertUnverified(result.receipt);
  assert.equal(chain.harness.cccCalls.filter(call => call.kind === 'dispatch').length, 2);
  assert.equal(chain.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 1);
  assert.deepEqual(chain.harness.receiverCalls.filter(call => call.kind === 'readClaim').map(call => call.path).sort(), [
    'handoff-ledger/v1/dispatcher/' + chain.dispatcher.identity.key + '/claim.json',
    'handoff-ledger/v1/router/' + chain.router.identity.key + '/claim.json'
  ].sort());
});

test('producer, Router caller, and final Receiver sender are distinct principals', async () => {
  const chain = await buildChain();
  assert.equal(chain.envelope._ccc_handoff.origin_sender_id, '101');
  assert.equal(chain.envelope._ccc_handoff.dispatcher_sender_id, '202');
  const prepared = ready(prepare(chain, { senderId: 303 }));
  const result = await executeReceiver(prepared, chain.harness.receiverService);
  assert.equal(result.disposition, 'receipt_recorded');
  assertUnverified(result);
});

test('both rich producer fields and preserved wrapper extensions survive to the durable receipt', async () => {
  const payload = producerPayload();
  payload.event.status = 'completed';
  payload.event.payload = JSON.parse('{"__proto__":{"polluted":true},"text":"literal data","large_number_string":"9007199254740993"}');
  payload.event.payload.text = "'; echo never-execute; #\n::error::literal $(id) " + String.fromCharCode(96) + 'uname' + String.fromCharCode(96);
  payload.extra_wrapper = { extension: [1, 'keep', { nested: true }] };
  const chain = await buildChain({ payload });
  const result = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
  assert.equal(result.disposition, 'receipt_recorded');
  assert.deepEqual(result.receipt.envelope, chain.envelope);
  for (const field of ['payload', 'governance', 'runtime_packet', 'extension', 'status', 'timestamp', 'trace_id']) {
    assert.deepEqual(result.receipt.envelope.event[field], payload.event[field]);
  }
  assert.deepEqual(result.receipt.envelope._ccc_handoff.wrapper_fields.extra_wrapper, payload.extra_wrapper);
  assert.equal(Object.hasOwn(result.receipt.envelope.event.payload, '__proto__'), true);
  assert.equal({}.polluted, undefined);
  assertUnverified(result.receipt);
});

test('Receiver admission requires both exact claims but does not wait for either transport outcome', async () => {
  const chain = await buildChain();
  for (const path of chain.harness.cccRecords.keys()) if (path.endsWith('/outcome.json')) chain.harness.cccRecords.delete(path);
  const result = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
  assert.equal(result.disposition, 'receipt_recorded');
  assert.ok(chain.harness.receiverCalls.filter(call => call.kind === 'readClaim').every(call => call.path.endsWith('/claim.json')));
  assertUnverified(result);
});

test('direct legacy producer events can pass the actual CCC normalization chain without content loss', async () => {
  const wrapped = producerPayload();
  const direct = { ...clone(wrapped.event), request_id: wrapped.request_id, target: wrapped.target };
  const chain = await buildChain({ payload: direct });
  const result = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
  assert.equal(result.disposition, 'receipt_recorded');
  assert.deepEqual(result.receipt.envelope.event.payload, direct.payload);
  assert.equal(result.receipt.envelope.event.trace_id, direct.trace_id);
  assert.equal(result.receipt.envelope.event.timestamp, direct.timestamp);
  assertUnverified(result);
});
