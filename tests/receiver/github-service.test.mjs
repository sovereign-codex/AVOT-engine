import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubService } from '../../scripts/receiver/github-service.mjs';
import { CONTROL_CENTER, ENGINE_REPO } from '../../scripts/receiver/contract.mjs';
import { recordBytes, gitBlobSha } from '../../scripts/receiver/encoding.mjs';

const claimReadToken = 'fixture-CCC-read-token';
const receiptWriteToken = 'fixture-AVOT-write-token';
const claim = 'handoff-ledger/v1/dispatcher/' + 'a'.repeat(64) + '/claim.json';
const receipt = 'receiver-receipts/v1/' + 'b'.repeat(64) + '/receipt.json';
const record = { purpose: 'offline service test', nested: { preserve: [1, false, null] } };
const bytes = recordBytes(record);
const blobSha = gitBlobSha(bytes);
const jsonResponse = (status, value) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function harness(reply) {
  const calls = [];
  const service = createGithubService({ claimReadToken, receiptWriteToken, fetchImpl: async (url, init) => {
    calls.push({ url: String(url), init });
    if (reply instanceof Error) throw reply;
    return typeof reply === 'function' ? reply(url, init) : reply;
  } });
  return { calls, service };
}

function assertFixed(calls, method, repository, path, token) {
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://api.github.com');
  assert.equal(parsed.pathname, '/repos/' + repository + '/contents/' + path);
  assert.equal(init.method, method);
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer ' + token);
  assert.equal(url.includes(claimReadToken), false);
  assert.equal(url.includes(receiptWriteToken), false);
  if (method === 'GET') assert.equal(parsed.searchParams.get('ref'), 'main');
}

test('Receiver service exposes custody operations without a dispatch or execution method', () => {
  const { service, calls } = harness(jsonResponse(200, {}));
  assert.deepEqual(Object.keys(service).sort(), ['createReceipt', 'readClaim', 'readReceipt']);
  assert.equal(Object.isFrozen(service), true);
  assert.deepEqual(calls, []);
});

test('CCC claims and AVOT receipts are read from fixed main paths with separate credentials', async () => {
  for (const [operation, path, repository, token] of [
    ['readClaim', claim, CONTROL_CENTER, claimReadToken],
    ['readReceipt', receipt, ENGINE_REPO, receiptWriteToken]
  ]) {
    const content = bytes.toString('base64').match(/.{1,40}/g).join('\n') + '\n';
    const { service, calls } = harness(jsonResponse(200, { path, type: 'file', encoding: 'base64', sha: blobSha, content }));
    assert.deepEqual(await service[operation](path), { status: 200, blobSha, record });
    assertFixed(calls, 'GET', repository, path, token);
  }
});

test('AVOT receipt creation is one canonical create-only PUT with no overwrite SHA', async () => {
  const { service, calls } = harness(jsonResponse(201, { content: { sha: blobSha }, commit: { sha: 'c'.repeat(40) } }));
  const result = await service.createReceipt(receipt, record);
  assert.equal(result.status, 201);
  assert.equal(result.blobSha, blobSha);
  assert.equal(result.commitSha, 'c'.repeat(40));
  assertFixed(calls, 'PUT', ENGINE_REPO, receipt, receiptWriteToken);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.branch, 'main');
  assert.equal(Object.hasOwn(body, 'sha'), false);
  assert.deepEqual(Buffer.from(body.content, 'base64'), bytes);
});

test('non-success reads and non-created writes return status without guessing records or retrying', async () => {
  for (const status of [403, 404, 409, 422, 500]) {
    const read = harness(new Response('not a JSON record', { status }));
    assert.deepEqual(await read.service.readClaim(claim), { status, record: null, blobSha: null });
    assertFixed(read.calls, 'GET', CONTROL_CENTER, claim, claimReadToken);
    const write = harness(new Response('not a creation record', { status }));
    assert.deepEqual(await write.service.createReceipt(receipt, record), { status, blobSha: null });
    assertFixed(write.calls, 'PUT', ENGINE_REPO, receipt, receiptWriteToken);
  }
  const already = harness(new Response('not a creation response', { status: 200 }));
  assert.deepEqual(await already.service.createReceipt(receipt, record), { status: 200, blobSha: null });
  assert.equal(already.calls.length, 1);
});

test('wrong or malformed 201 responses cannot prove receipt creation', async () => {
  for (const value of [{ content: { sha: '0'.repeat(40) } }, { content: {} }, {}, null]) {
    const { service, calls } = harness(jsonResponse(201, value));
    await assert.rejects(() => service.createReceipt(receipt, record));
    assert.equal(calls.length, 1);
  }
});

test('successful reads require exact path, blob, strict UTF-8 JSON, and canonical bytes', async () => {
  const noncanonical = Buffer.from(JSON.stringify(record, null, 2) + '\n');
  const duplicates = Buffer.from('{"key":1,"key":2}\n');
  const invalidUtf8 = Buffer.from([0xff, 0xfe]);
  const base = { path: claim, type: 'file', encoding: 'base64', sha: blobSha, content: bytes.toString('base64') };
  for (const value of [
    { ...base, path: receipt }, { ...base, sha: '0'.repeat(40) },
    { ...base, encoding: 'utf-8' }, { ...base, content: '!invalid!' },
    { ...base, content: noncanonical.toString('base64'), sha: gitBlobSha(noncanonical) },
    { ...base, content: duplicates.toString('base64'), sha: gitBlobSha(duplicates) },
    { ...base, content: invalidUtf8.toString('base64'), sha: gitBlobSha(invalidUtf8) }
  ]) {
    const { service, calls } = harness(jsonResponse(200, value));
    await assert.rejects(() => service.readClaim(claim));
    assert.equal(calls.length, 1);
  }
});

test('claim and receipt APIs cannot select outcomes, other files, repos, branches, or arbitrary URLs', async () => {
  for (const invalid of [
    '../config/avot-receiver.json', claim.replace('/claim.json', '/outcome.json'),
    claim.replace('/dispatcher/', '/receiver/'), claim + '?ref=other',
    claim.replace('a'.repeat(64), 'A'.repeat(64)), 'https://example.invalid/' + claim
  ]) {
    const { service, calls } = harness(jsonResponse(200, {}));
    await assert.rejects(() => service.readClaim(invalid));
    assert.deepEqual(calls, []);
  }
  for (const invalid of [claim, '../receipt.json', receipt + '?ref=other', receipt.replace('/receipt.json', '/other.json')]) {
    const { service, calls } = harness(jsonResponse(200, {}));
    await assert.rejects(() => service.readReceipt(invalid));
    await assert.rejects(() => service.createReceipt(invalid, record));
    assert.deepEqual(calls, []);
  }
});

test('fetch exceptions and redirects are rejected without retries or credential leakage', async () => {
  for (const operation of ['readClaim', 'readReceipt', 'createReceipt']) {
    const { service, calls } = harness(new Error('fixture raw error ' + claimReadToken + ' ' + receiptWriteToken));
    await assert.rejects(() => operation === 'createReceipt' ? service.createReceipt(receipt, record) : service[operation](operation === 'readClaim' ? claim : receipt), error => {
      assert.equal(String(error).includes(claimReadToken), false);
      assert.equal(String(error).includes(receiptWriteToken), false);
      assert.equal(String(error.cause).includes(claimReadToken), false);
      return true;
    });
    assert.equal(calls.length, 1);
  }
  const redirected = harness(new Response(null, { status: 302, headers: { Location: 'https://example.invalid' } }));
  await assert.rejects(() => redirected.service.readClaim(claim));
  assert.equal(redirected.calls.length, 1);
  assert.equal(redirected.calls[0].init.redirect, 'error');
});

test('streamed response bound cancels oversized content without accepting a record', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2_000_001)); },
    cancel() { cancelled = true; }
  });
  const { service, calls } = harness(new Response(stream, { status: 200 }));
  await assert.rejects(() => service.readClaim(claim));
  assert.equal(cancelled, true);
  assert.equal(calls.length, 1);
});

test('invalid or oversized receipt data fails before a fetch', async () => {
  const cyclic = {}; cyclic.self = cyclic;
  for (const invalid of [null, [], cyclic, { value: 1n }, { value: 'x'.repeat(1_000_001) }]) {
    const { service, calls } = harness(jsonResponse(201, {}));
    await assert.rejects(() => service.createReceipt(receipt, invalid));
    assert.deepEqual(calls, []);
  }
});
