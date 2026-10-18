import test from 'node:test';
import assert from 'node:assert/strict';
import { executeReceiver } from '../../scripts/receiver/executor.mjs';
import { receiptPath } from '../../scripts/receiver/contract.mjs';
import { gitBlobSha, recordBytes } from '../../scripts/receiver/encoding.mjs';
import { buildChain, prepare, ready, receiverObservation, receiverPolicy, producerPayload, LedgerHarness, clone, assertUnverified } from './helpers.mjs';

test('same request is duplicate after a new Receiver run and main commit with unchanged runtime code', async () => {
  const chain = await buildChain();
  const first = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
  const originalRecord = clone(first.receipt);
  const secondPrepared = ready(prepare(chain, { obs: receiverObservation({
    runId: '9002', runAttempt: '2', observedAt: '2026-10-18T08:00:00.000Z',
    commitSha: 'b'.repeat(40), checkoutSha: 'b'.repeat(40), workflowSha: 'b'.repeat(40)
  }) }));
  const second = await executeReceiver(secondPrepared, chain.harness.receiverService);
  assert.equal(second.disposition, 'duplicate');
  assert.equal(second.persistence.status, 'existing');
  assert.deepEqual(second.receipt, originalRecord);
  assert.notDeepEqual(second.observation, second.receipt.observation);
  assert.equal(chain.harness.receipts.size, 1);
  assertUnverified(second); assertUnverified(second.receipt);
});

test('concurrent Receiver runs produce one receipt and the loser verifies the existing receipt', async () => {
  const harness = new LedgerHarness({ raceReceipts: 2 });
  const chain = await buildChain({ harness });
  const a = ready(prepare(chain));
  const b = ready(prepare(chain, { obs: receiverObservation({ runId: '9002' }) }));
  const results = await Promise.all([executeReceiver(a, harness.receiverService), executeReceiver(b, harness.receiverService)]);
  assert.deepEqual(results.map(result => result.disposition).sort(), ['duplicate', 'receipt_recorded']);
  assert.equal(harness.receipts.size, 1);
  assert.deepEqual(results[0].receipt, results[1].receipt);
  results.forEach(assertUnverified);
});

test('an existing caller identity with changed admitted sender binding is a collision without overwrite', async () => {
  const chain = await buildChain();
  const policy = receiverPolicy(chain.cccPolicy); policy.allowed_dispatch_sender_ids = ['303', '304'];
  const first = await executeReceiver(ready(prepare(chain, { policy, senderId: 303 })), chain.harness.receiverService);
  assert.equal(first.disposition, 'receipt_recorded');
  const before = clone([...chain.harness.receipts.entries()]);
  const second = await executeReceiver(ready(prepare(chain, { policy, senderId: 304 })), chain.harness.receiverService);
  assert.equal(second.disposition, 'identity_collision');
  assert.deepEqual([...chain.harness.receipts.entries()], before);
  assertUnverified(second);
});

test('missing either Router or Dispatcher claim holds before any receipt mutation', async () => {
  for (const stage of ['router', 'dispatcher']) {
    const chain = await buildChain();
    for (const path of chain.harness.cccRecords.keys()) if (path.includes('/' + stage + '/') && path.endsWith('/claim.json')) chain.harness.cccRecords.delete(path);
    const result = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
    assert.equal(result.disposition, 'hold');
    assert.equal(chain.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 0);
    assert.equal(chain.harness.receipts.size, 0);
    assertUnverified(result);
  }
});

test('claim blob integrity, exact request hash, version, and binding are all checked independently', async () => {
  for (const stage of ['router', 'dispatcher']) {
    for (const mutate of [
      stored => { stored.blobSha = '0'.repeat(40); },
      stored => { stored.record.outbound_request_sha256 = '0'.repeat(64); stored.blobSha = gitBlobSha(recordBytes(stored.record)); },
      stored => { stored.record.contract_version = 'ccc-handoff/999'; stored.blobSha = gitBlobSha(recordBytes(stored.record)); },
      stored => { stored.record.binding.fingerprint = '0'.repeat(64); stored.blobSha = gitBlobSha(recordBytes(stored.record)); }
    ]) {
      const chain = await buildChain();
      const path = [...chain.harness.cccRecords.keys()].find(path => path.includes('/' + stage + '/') && path.endsWith('/claim.json'));
      mutate(chain.harness.cccRecords.get(path));
      const result = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
      assert.equal(result.disposition, 'hold');
      assert.equal(chain.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 0);
      assertUnverified(result);
    }
  }
});

test('internally plausible upstream observation edits still fail exact persisted claim verification', async () => {
  for (const stage of ['router', 'dispatcher']) {
    const chain = await buildChain();
    const envelope = clone(chain.envelope);
    const obs = envelope._ccc_handoff[stage + '_observation'];
    obs.run_id = '9999';
    obs.actions_run_url = 'https://github.com/sovereign-codex/Codex-control-center/actions/runs/9999';
    const prepared = ready(prepare(chain, { envelope }));
    const result = await executeReceiver(prepared, chain.harness.receiverService);
    assert.equal(result.disposition, 'hold');
    assert.equal(chain.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 0);
  }
});

test('unavailable or malformed claim reads hold with no receipt mutation', async () => {
  for (const reply of [null, { status: 403, record: null, blobSha: null }, { status: 200, record: {}, blobSha: 'a'.repeat(40) }, new Error('fixture: unavailable')]) {
    const chain = await buildChain();
    chain.harness.receiverService.readClaim = async path => {
      chain.harness.receiverCalls.push({ kind: 'readClaim', path });
      if (reply instanceof Error) throw reply;
      return clone(reply);
    };
    const result = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
    assert.equal(result.disposition, 'hold');
    assert.equal(chain.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 0);
  }
});

test('non-created receipt responses with no verified readback are uncertain and never retried', async () => {
  for (const status of [200, 403, 409, 422, 500]) {
    const harness = new LedgerHarness({ receiptReply: { status, blobSha: null } });
    const chain = await buildChain({ harness });
    const result = await executeReceiver(ready(prepare(chain)), harness.receiverService);
    assert.equal(result.disposition, 'receipt_uncertain', String(status));
    assert.equal(result.persistence.status, 'unverified');
    assert.equal(result.receipt, null);
    assert.equal(harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 1);
    assert.equal(harness.receiverCalls.filter(call => call.kind === 'readReceipt').length, 1);
    assertUnverified(result);
  }
});

test('wrong or missing 201 blob identity grants no new-record claim but valid readback can prove duplicate', async () => {
  for (const blobSha of [null, '0'.repeat(40)]) {
    const harness = new LedgerHarness({ receiptReply: { status: 201, blobSha } });
    const chain = await buildChain({ harness });
    const result = await executeReceiver(ready(prepare(chain)), harness.receiverService);
    assert.equal(result.disposition, 'duplicate');
    assert.equal(result.persistence.status, 'existing');
    assert.equal(result.persistence.blob_sha, gitBlobSha(recordBytes(result.receipt)));
    assert.equal(harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 1);
    assert.equal(harness.receiverCalls.filter(call => call.kind === 'readReceipt').length, 1);
    assertUnverified(result);
  }
});

test('a lost create response after commit is resolved by one verified readback without another write', async () => {
  const chain = await buildChain();
  const create = chain.harness.receiverService.createReceipt;
  chain.harness.receiverService.createReceipt = async (path, record) => {
    await create(path, record);
    throw new Error('fixture: response lost after atomic creation');
  };
  const result = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
  assert.equal(result.disposition, 'duplicate');
  assert.equal(result.persistence.status, 'existing');
  assert.equal(chain.harness.receipts.size, 1);
  assert.equal(chain.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 1);
  assert.equal(chain.harness.receiverCalls.filter(call => call.kind === 'readReceipt').length, 1);
  assertUnverified(result);
});

test('unresolved write and readback ambiguity remains uncertain with no receipt or completion claim', async () => {
  const harness = new LedgerHarness({ receiptReply: new Error('fixture: write timeout'), readReceiptReply: new Error('fixture: read timeout') });
  const chain = await buildChain({ harness });
  const result = await executeReceiver(ready(prepare(chain)), harness.receiverService);
  assert.equal(result.disposition, 'receipt_uncertain');
  assert.equal(result.persistence.status, 'unverified');
  assert.equal(result.receipt, null);
  assert.equal(harness.receiverCalls.filter(call => call.kind === 'createReceipt').length, 1);
  assert.equal(harness.receiverCalls.filter(call => call.kind === 'readReceipt').length, 1);
  assertUnverified(result);
});

test('corrupted existing receipts cannot be promoted to verified duplicate or completion', async () => {
  for (const mutate of [
    stored => { stored.blobSha = '0'.repeat(40); },
    stored => { stored.record.execution = { status: 'completed', completion_claim: true }; stored.blobSha = gitBlobSha(recordBytes(stored.record)); },
    stored => { stored.record.envelope.event.payload.message = 'altered'; stored.blobSha = gitBlobSha(recordBytes(stored.record)); },
    stored => { stored.record.binding.fingerprint = '0'.repeat(64); stored.blobSha = gitBlobSha(recordBytes(stored.record)); }
  ]) {
    const chain = await buildChain();
    const first = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
    assert.equal(first.disposition, 'receipt_recorded');
    mutate(chain.harness.receipts.values().next().value);
    const result = await executeReceiver(ready(prepare(chain)), chain.harness.receiverService);
    assert.equal(result.disposition, 'receipt_uncertain');
    assert.equal(result.persistence.status, 'unverified');
    assert.equal(result.receipt, null);
    assertUnverified(result);
  }
});

test('a valid receipt for another request at this request path is uncertain rather than an identity collision', async () => {
  const chainA = await buildChain();
  const preparedA = ready(prepare(chainA));
  const chainB = await buildChain({ harness: chainA.harness, payload: producerPayload({ request_id: 'portable-request-002' }) });
  const resultB = await executeReceiver(ready(prepare(chainB)), chainB.harness.receiverService);
  assert.equal(resultB.disposition, 'receipt_recorded');
  const expectedPathA = receiptPath(preparedA.identity.key);
  assert.notEqual(expectedPathA, resultB.persistence.path);
  // The complete B receipt and its valid blob identity are deliberately
  // returned at A's path. Its own request and content remain internally valid.
  const storedB = clone(chainA.harness.receipts.get(resultB.persistence.path));
  chainA.harness.receipts.set(expectedPathA, storedB);
  const beforeCreates = chainA.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length;
  const beforeReads = chainA.harness.receiverCalls.filter(call => call.kind === 'readReceipt').length;
  const resultA = await executeReceiver(preparedA, chainA.harness.receiverService);
  assert.equal(resultA.disposition, 'receipt_uncertain');
  assert.equal(resultA.persistence.status, 'unverified');
  assert.equal(resultA.receipt, null);
  assert.equal(chainA.harness.receiverCalls.filter(call => call.kind === 'createReceipt').length - beforeCreates, 1);
  assert.equal(chainA.harness.receiverCalls.filter(call => call.kind === 'readReceipt').length - beforeReads, 1);
  assert.deepEqual(chainA.harness.receipts.get(expectedPathA), storedB);
  assertUnverified(resultA);
});
